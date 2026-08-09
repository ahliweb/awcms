/**
 * Issue #466 (epic #463, ADR-0074) — the FCM HTTP v1 adapter, with no network.
 *
 * The load-bearing test here is the FIRST one. Everything else in this adapter
 * is branching on a status code, which is easy to get right and easy to test.
 * The part that could be subtly, silently wrong is the dependency-free RS256
 * service-account assertion: a JWT that Google rejects looks exactly like a
 * credential problem, and "add `google-auth-library`" is the conclusion anyone
 * would reach after an hour of that.
 *
 * So the assertion is not merely produced — it is VERIFIED, with the matching
 * public key, through `crypto.subtle`. A real RSA key pair is generated in the
 * test, exported to the same PKCS#8 PEM shape Google issues, fed through the
 * real parser, and the resulting JWT's signature is checked. If the framing,
 * the base64url, or the algorithm were wrong, that verification fails.
 *
 * The second thing worth stating: `UNREGISTERED` must NOT trip the circuit
 * breaker. A queue routinely carries thousands of dead tokens, and if those
 * counted as provider failures, one batch of stale registrations would stop
 * delivery to every healthy device — with the symptom pointing at FCM.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import {
  buildFcmSendUrl,
  parseFcmCredentialsBase64,
  type FcmServiceAccount
} from "../src/modules/push-delivery/domain/fcm-credentials";
import { mapFcmResponse } from "../src/modules/push-delivery/domain/fcm-error-mapping";
import { PUSH_CIRCUIT_BREAKER_KEY } from "../src/modules/push-delivery/domain/push-config";
import { createFcmPushProvider } from "../src/modules/push-delivery/infrastructure/fcm-provider";
import { clearGoogleAccessTokenCache } from "../src/modules/push-delivery/infrastructure/google-access-token";
import { resolvePushProvider } from "../src/modules/push-delivery/infrastructure/push-provider-resolver";
import type {
  PushHttpClient,
  PushHttpRequest
} from "../src/modules/push-delivery/infrastructure/push-http-client";
import type { PushTarget } from "../src/modules/push-delivery/domain/push-provider-contract";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const TARGET: PushTarget = {
  transport: "fcm",
  endpoint: "device-registration-token",
  endpointMasked: "device-…token"
};

type Call = { url: string; request: PushHttpRequest };

/** Generates a real RSA key pair and returns it in the exact shape a Google credential carries. */
async function makeCredentialMaterial(): Promise<{
  base64: string;
  publicKey: CryptoKey;
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );

  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const body = Buffer.from(pkcs8)
    .toString("base64")
    .replace(/(.{64})/g, "$1\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;

  const json = JSON.stringify({
    type: "service_account",
    project_id: "awcms-test",
    client_email: "push@awcms-test.iam.gserviceaccount.com",
    private_key: pem,
    token_uri: TOKEN_URI
  });

  return {
    base64: Buffer.from(json, "utf8").toString("base64"),
    publicKey: pair.publicKey
  };
}

function scriptedHttp(
  responses: (
    { ok: true; status: number; body: string } | { ok: false; reason: string }
  )[],
  calls: Call[]
): PushHttpClient {
  let index = 0;

  return async (url, request) => {
    calls.push({ url, request });

    const response = responses[Math.min(index, responses.length - 1)]!;
    index += 1;

    return response;
  };
}

const TOKEN_OK = {
  ok: true as const,
  status: 200,
  body: JSON.stringify({ access_token: "ya29.fake", expires_in: 3600 })
};

const SEND_OK = {
  ok: true as const,
  status: 200,
  body: JSON.stringify({ name: "projects/awcms-test/messages/1" })
};

function fcmError(status: number, errorCode?: string) {
  return {
    ok: true as const,
    status,
    body: JSON.stringify({
      error: {
        code: status,
        status: "ERROR",
        ...(errorCode
          ? {
              details: [
                {
                  "@type":
                    "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                  errorCode
                }
              ]
            }
          : {})
      }
    })
  };
}

afterEach(() => {
  clearGoogleAccessTokenCache();
  resetProviderCircuitBreakersForTests();
});

describe("the service-account assertion is a real, verifiable RS256 JWT", () => {
  test("Google's public key would accept it — signature, framing, and claims", async () => {
    const { base64, publicKey } = await makeCredentialMaterial();
    const parsed = parseFcmCredentialsBase64(base64);

    expect(parsed.ok).toBe(true);
    const credential = (parsed as { ok: true; credential: FcmServiceAccount })
      .credential;

    const calls: Call[] = [];
    const provider = createFcmPushProvider({
      credential,
      timeoutMs: 5000,
      http: scriptedHttp([TOKEN_OK, SEND_OK], calls),
      now: () => new Date("2026-08-10T00:00:00.000Z")
    });

    const result = await provider.send(TARGET, { title: "t", body: "b" });
    expect(result.ok).toBe(true);

    // First call is the token mint, at the credential's OWN token_uri.
    expect(calls[0]!.url).toBe(TOKEN_URI);

    const form = new URLSearchParams(calls[0]!.request.body);
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer"
    );

    const assertion = form.get("assertion")!;
    const [headerB64, claimsB64, signatureB64] = assertion.split(".");

    const decode = (segment: string) =>
      Buffer.from(
        segment.replace(/-/g, "+").replace(/_/g, "/") +
          "=".repeat((4 - (segment.length % 4)) % 4),
        "base64"
      );

    expect(JSON.parse(decode(headerB64!).toString("utf8"))).toEqual({
      alg: "RS256",
      typ: "JWT"
    });

    const claims = JSON.parse(decode(claimsB64!).toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(claims.iss).toBe(credential.clientEmail);
    expect(claims.aud).toBe(TOKEN_URI);
    expect(claims.scope).toBe(
      "https://www.googleapis.com/auth/firebase.messaging"
    );
    // Bounded lifetime — an assertion good for a day is a bearer grant left lying around.
    expect((claims.exp as number) - (claims.iat as number)).toBe(300);

    // THE assertion this file exists for.
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decode(signatureB64!),
      new TextEncoder().encode(`${headerB64}.${claimsB64}`)
    );

    expect(verified).toBe(true);
  });

  test("the send URL names the project from the CREDENTIAL, not from configuration", async () => {
    const { base64 } = await makeCredentialMaterial();
    const parsed = parseFcmCredentialsBase64(base64) as {
      ok: true;
      credential: FcmServiceAccount;
    };

    // Two sources for "which project" is how a deployment ends up authenticated
    // as one project and addressing another.
    expect(buildFcmSendUrl(parsed.credential)).toBe(
      "https://fcm.googleapis.com/v1/projects/awcms-test/messages:send"
    );
  });

  test("the access token is CACHED — a second send does not re-mint", async () => {
    const { base64 } = await makeCredentialMaterial();
    const credential = (
      parseFcmCredentialsBase64(base64) as {
        ok: true;
        credential: FcmServiceAccount;
      }
    ).credential;

    const calls: Call[] = [];
    const provider = createFcmPushProvider({
      credential,
      timeoutMs: 5000,
      http: scriptedHttp([TOKEN_OK, SEND_OK, SEND_OK], calls)
    });

    await provider.send(TARGET, { title: "a", body: "b" });
    await provider.send(TARGET, { title: "c", body: "d" });

    // token, send, send — not token, send, token, send.
    expect(calls.map((call) => call.url)).toEqual([
      TOKEN_URI,
      buildFcmSendUrl(credential),
      buildFcmSendUrl(credential)
    ]);
  });
});

describe("credential parsing refuses the shapes that fail LATER", () => {
  test("raw JSON (not base64) is named as the usual cause", () => {
    const result = parseFcmCredentialsBase64(
      '{"project_id":"x","client_email":"y","private_key":"z","token_uri":"https://t"}'
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("un-encoded");
  });

  test("PKCS#1 is rejected by NAME, not by an opaque import failure", () => {
    // `crypto.subtle.importKey("pkcs8", …)` would throw `DataError` on this,
    // at the first send, with nothing pointing at the cause.
    const json = JSON.stringify({
      project_id: "p",
      client_email: "e",
      private_key:
        "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----",
      token_uri: TOKEN_URI
    });
    const result = parseFcmCredentialsBase64(
      Buffer.from(json).toString("base64")
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("PKCS#1");
  });

  test("an http token_uri is refused — a signed assertion is a bearer grant", () => {
    const json = JSON.stringify({
      project_id: "p",
      client_email: "e",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
      token_uri: "http://oauth2.googleapis.com/token"
    });
    const result = parseFcmCredentialsBase64(
      Buffer.from(json).toString("base64")
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("https");
  });

  test("a missing field is reported by NAME and the key value never appears", () => {
    const json = JSON.stringify({
      project_id: "p",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----"
    });
    const result = parseFcmCredentialsBase64(
      Buffer.from(json).toString("base64")
    );

    expect(result.ok).toBe(false);
    const reason = result.ok === false ? result.reason : "";
    expect(reason).toContain("client_email");
    expect(reason).toContain("token_uri");
    expect(reason).not.toContain("SECRET");
  });
});

describe("FCM responses map to the RIGHT of three outcomes", () => {
  test("UNREGISTERED is subscription_gone, not a failure to retry", () => {
    expect(mapFcmResponse(404, fcmError(404, "UNREGISTERED").body).kind).toBe(
      "subscription_gone"
    );
    // FCM overloads statuses: the CODE wins over the status.
    expect(mapFcmResponse(400, fcmError(400, "UNREGISTERED").body).kind).toBe(
      "subscription_gone"
    );
  });

  test.each([
    ["INVALID_ARGUMENT", 400],
    ["SENDER_ID_MISMATCH", 403],
    ["THIRD_PARTY_AUTH_ERROR", 401]
  ])("%s is permanent and does not trip the breaker", (code, status) => {
    const outcome = mapFcmResponse(status, fcmError(status, code).body);

    expect(outcome.kind).toBe("failure");
    expect(outcome.kind === "failure" && outcome.retryable).toBe(false);
    expect(outcome.kind === "failure" && outcome.tripsBreaker).toBe(false);
  });

  test.each([
    ["QUOTA_EXCEEDED", 429],
    ["UNAVAILABLE", 503],
    ["INTERNAL", 500]
  ])("%s is retryable AND counts toward the breaker", (code, status) => {
    const outcome = mapFcmResponse(status, fcmError(status, code).body);

    expect(outcome.kind === "failure" && outcome.retryable).toBe(true);
    expect(outcome.kind === "failure" && outcome.tripsBreaker).toBe(true);
  });

  test("a 401 is its own outcome — the token is refreshable, the message is not lost", () => {
    expect(mapFcmResponse(401, "{}").kind).toBe("unauthorized");
  });

  test("an unparseable body still lands somewhere sensible", () => {
    // A proxy returning HTML must not crash the mapper.
    expect(mapFcmResponse(502, "<html>bad gateway</html>").kind).toBe(
      "failure"
    );
    expect(mapFcmResponse(418, "not json").kind).toBe("failure");
  });
});

describe("the circuit breaker measures the SERVICE, not the tokens", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  test("a batch of dead tokens leaves the breaker closed", async () => {
    const { base64 } = await makeCredentialMaterial();
    const credential = (
      parseFcmCredentialsBase64(base64) as {
        ok: true;
        credential: FcmServiceAccount;
      }
    ).credential;

    const provider = createFcmPushProvider({
      credential,
      timeoutMs: 5000,
      http: scriptedHttp([TOKEN_OK, fcmError(404, "UNREGISTERED")], []),
      now: () => now
    });

    // The default provider threshold is 5 consecutive failures.
    for (let i = 0; i < 10; i += 1) {
      const result = await provider.send(TARGET, { title: "t", body: "b" });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.subscriptionGone).toBe(true);
    }

    expect(
      getProviderCircuitBreaker(PUSH_CIRCUIT_BREAKER_KEY).getState(now)
    ).toBe("closed");
  });

  test("a real outage DOES open it", async () => {
    const { base64 } = await makeCredentialMaterial();
    const credential = (
      parseFcmCredentialsBase64(base64) as {
        ok: true;
        credential: FcmServiceAccount;
      }
    ).credential;

    const provider = createFcmPushProvider({
      credential,
      timeoutMs: 5000,
      http: scriptedHttp([TOKEN_OK, fcmError(503, "UNAVAILABLE")], []),
      now: () => now
    });

    for (let i = 0; i < 5; i += 1) {
      await provider.send(TARGET, { title: "t", body: "b" });
    }

    expect(
      getProviderCircuitBreaker(PUSH_CIRCUIT_BREAKER_KEY).getState(now)
    ).toBe("open");
  });
});

describe("a 401 is refreshed exactly ONCE", () => {
  test("an expired token costs one extra call, not the rest of the batch", async () => {
    const { base64 } = await makeCredentialMaterial();
    const credential = (
      parseFcmCredentialsBase64(base64) as {
        ok: true;
        credential: FcmServiceAccount;
      }
    ).credential;

    const calls: Call[] = [];
    let step = 0;
    const http: PushHttpClient = async (url, request) => {
      calls.push({ url, request });
      step += 1;

      // token → send(401) → token → send(200)
      if (step === 1 || step === 3) return TOKEN_OK;
      if (step === 2) return { ok: true, status: 401, body: "{}" };

      return SEND_OK;
    };

    const provider = createFcmPushProvider({
      credential,
      timeoutMs: 5000,
      http
    });
    const result = await provider.send(TARGET, { title: "t", body: "b" });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(4);
  });

  test("a FRESH token refused too is permanent — it is a credential problem, not expiry", async () => {
    const { base64 } = await makeCredentialMaterial();
    const credential = (
      parseFcmCredentialsBase64(base64) as {
        ok: true;
        credential: FcmServiceAccount;
      }
    ).credential;

    let step = 0;
    const http: PushHttpClient = async () => {
      step += 1;

      if (step === 1 || step === 3) return TOKEN_OK;

      return { ok: true, status: 401, body: "{}" };
    };

    const provider = createFcmPushProvider({
      credential,
      timeoutMs: 5000,
      http
    });
    const result = await provider.send(TARGET, { title: "t", body: "b" });

    expect(result.ok).toBe(false);
    // Not retryable: looping on a wrong credential would burn every message.
    expect(result.ok === false && result.retryable).toBe(false);
  });
});

describe("resolution degrades rather than throwing", () => {
  test("PUSH_PROVIDER=fcm without a credential fails NON-retryably", async () => {
    const provider = resolvePushProvider({
      PUSH_PROVIDER: "fcm"
    } as NodeJS.ProcessEnv);
    const result = await provider.send(TARGET, { title: "t", body: "b" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.retryable).toBe(false);
  });

  test("a malformed credential names the field, never the key", async () => {
    const json = JSON.stringify({
      project_id: "p",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----"
    });
    const provider = resolvePushProvider({
      PUSH_PROVIDER: "fcm",
      PUSH_FCM_CREDENTIALS_BASE64: Buffer.from(json).toString("base64")
    } as NodeJS.ProcessEnv);
    const result = await provider.send(TARGET, { title: "t", body: "b" });

    expect(result.ok).toBe(false);
    const error = result.ok === false ? result.error : "";
    expect(error).toContain("client_email");
    expect(error).not.toContain("SECRET");
  });

  test("`fcm` speaks only `fcm` — a web_push row must not be handed to it", async () => {
    const { base64 } = await makeCredentialMaterial();
    const provider = resolvePushProvider({
      PUSH_PROVIDER: "fcm",
      PUSH_FCM_CREDENTIALS_BASE64: base64
    } as NodeJS.ProcessEnv);

    // The dispatcher checks this before calling, so a mismatch is a
    // configuration error caught with a clear message rather than a wire error.
    expect([...provider.supportedTransports]).toEqual(["fcm"]);
  });
});
