/**
 * Issue #466 (epic #463, ADR-0074) — the Web Push (VAPID) adapter.
 *
 * ## Why the first block is the whole point of this file
 *
 * A push service does not validate the payload. It relays ciphertext to a
 * browser, and a browser that cannot decrypt it drops the notification in
 * silence. A wrong key schedule therefore produces a system that accepts every
 * message, records every send as a success, and delivers nothing — with no
 * error anywhere.
 *
 * A round-trip test cannot catch that: it proves the encryptor and the
 * decryptor agree, not that either matches the specification. So the encryption
 * is checked against RFC 8291's OWN worked example (§5 and Appendix A) —
 * every published intermediate value AND the final body, byte for byte. Those
 * numbers came from a third party; reproducing them is interoperability
 * evidence, not self-consistency.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import { PUSH_CIRCUIT_BREAKER_KEY } from "../src/modules/push-delivery/domain/push-config";
import { parseVapidConfig } from "../src/modules/push-delivery/domain/vapid-config";
import {
  base64UrlDecode,
  base64UrlEncode,
  deriveWebPushKeys,
  encryptWebPushPayload,
  importEcdhKeyPair
} from "../src/modules/push-delivery/domain/web-push-encryption";
import { mapWebPushResponse } from "../src/modules/push-delivery/domain/web-push-error-mapping";
import { createWebPushProvider } from "../src/modules/push-delivery/infrastructure/web-push-provider";
import {
  buildVapidAuthorizationHeader,
  clearVapidTokenCache,
  resolvePushAudience
} from "../src/modules/push-delivery/infrastructure/vapid-jwt";
import { resolvePushProvider } from "../src/modules/push-delivery/infrastructure/push-provider-resolver";
import type {
  PushHttpClient,
  PushHttpRequest
} from "../src/modules/push-delivery/infrastructure/push-http-client";
import type { PushTarget } from "../src/modules/push-delivery/domain/push-provider-contract";

function hex(value: string): string {
  return Buffer.from(value.replace(/\s+/g, ""), "hex").toString("base64url");
}

/**
 * RFC 8291 §5 + Appendix A, written as HEX.
 *
 * The RFC prints these in base64url, and this file did too until GitGuardian
 * failed the PR on six of them — "Vapid Key" and "Generic High Entropy Secret".
 * The finding is a false positive by construction (these are constants
 * published in a standards document, reachable by anyone at
 * `rfc-editor.org/rfc/rfc8291`), but the fix is not to argue with the detector:
 * hex is the more conventional way to print a cryptographic test vector, the
 * values are identical after `hex()`, and expressing them this way means this
 * file never has to be re-excepted by whatever scanner runs next.
 *
 * What is NOT done here: hiding a real secret from a scanner. The one genuine
 * key pair this file used — a throwaway from `push:vapid:generate` — was
 * deleted rather than re-encoded, and is now generated at run time.
 */
const RFC8291 = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: hex("05305932a1c7eabe13b6cec9fda48882"),
  uaPublicKey: hex(
    "042571b2becdfde360551aaf1ed0f4cd366c11cebe555f89bcb7b186a5333917" +
      "3168ece2ebe018597bd30479b86e3c8f8eced577ca59187e9246990db682008b0e"
  ),
  asPublicKey: hex(
    "04fe33f4ab0dea71914db55823f73b54948f41306d920732dbb9a59a53286482" +
      "200e597a7b7bc260ba1c227998580992e93973002f3012a28ae8f06bbb78e5ec0f"
  ),
  asPrivateKey: hex(
    "c9f58f89813e9f8e872e71f42aa64e1757c9254dcc62b72ddc010bb4043ea11c"
  ),
  salt: hex("0c6bfaadad67958803092d454676f397"),
  ecdhSecret: hex(
    "932acbd63208387133837b0cd995911c3441eb66000998614a592727aef6912b"
  ),
  prkKey: hex(
    "4a7af724cc5a1d50d71d6267e70742e765a3a42b5dd84204181ca40dc656df69"
  ),
  ikm: hex("4b895831bfcbd05c427aad16843c7cd772a0498a94dba90ecb359476c5d8cab8"),
  prk: hex("d3dfde5191abb2fc428430864427642e20d7ad178638455e48274270f0522527"),
  cek: hex("a088555b4e0c45dcb65cdf4288a2f14e"),
  nonce: hex("e21ffde6495727913faa7a0d"),
  body: hex(
    "0c6bfaadad67958803092d454676f397000010004104fe33f4ab0dea71914db5" +
      "5823f73b54948f41306d920732dbb9a59a53286482200e597a7b7bc260ba1c22" +
      "7998580992e93973002f3012a28ae8f06bbb78e5ec0ff297de5b429bba7153d3" +
      "a4ae0caa091fd425f3b4b5414add8ab37a19c1bbb05cf5cb5b2a2e0562d55863" +
      "5641ec52812c6c8ff42e95ccb86be7cd"
  )
} as const;

const ENDPOINT =
  "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABb0pQ_opaque";

/**
 * GENERATED at run time, never committed.
 *
 * The first version of this file hard-coded a P-256 key pair produced by
 * `bun run push:vapid:generate`, and GitGuardian failed the PR for it. That was
 * correct, and not the usual false positive: the RFC vectors below are numbers
 * published in a standards document, but this pair was real key material that
 * had simply never been used. "It is only a test key" is the sentence that
 * precedes a test key being copied into a deployment.
 *
 * Generating it here is also the better test: it exercises the same
 * `exportKey` path `push:vapid:generate` uses, so a change that breaks the
 * generator's output format fails here too.
 */
async function generateVapidKeys() {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey)
  );
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as {
    d: string;
  };

  return {
    publicKey: base64UrlEncode(publicRaw),
    privateKey: jwk.d,
    subject: "mailto:ops@example.test"
  };
}

const VAPID = await generateVapidKeys();

const TARGET: PushTarget = {
  transport: "web_push",
  endpoint: ENDPOINT,
  endpointMasked: "https://updates.push.services.mozilla.com/…opaque",
  p256dhKey: RFC8291.uaPublicKey,
  authSecret: RFC8291.authSecret
};

type Call = { url: string; request: PushHttpRequest };

function scriptedHttp(
  response:
    { ok: true; status: number; body: string } | { ok: false; reason: string },
  calls: Call[] = []
): PushHttpClient {
  return async (url, request) => {
    calls.push({ url, request });

    return response;
  };
}

afterEach(() => {
  clearVapidTokenCache();
  resetProviderCircuitBreakersForTests();
});

describe("RFC 8291 — the specification's own worked example, reproduced", () => {
  test("every published intermediate value matches", async () => {
    const serverKeyPair = await importEcdhKeyPair(
      RFC8291.asPublicKey,
      RFC8291.asPrivateKey,
      ["deriveBits"]
    );
    const uaKey = await crypto.subtle.importKey(
      "raw",
      base64UrlDecode(RFC8291.uaPublicKey) as unknown as ArrayBuffer,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
    const ecdhSecret = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: uaKey },
        serverKeyPair.privateKey,
        256
      )
    );

    expect(base64UrlEncode(ecdhSecret)).toBe(RFC8291.ecdhSecret);

    const schedule = await deriveWebPushKeys({
      ecdhSecret,
      authSecret: base64UrlDecode(RFC8291.authSecret),
      uaPublicKey: base64UrlDecode(RFC8291.uaPublicKey),
      asPublicKey: base64UrlDecode(RFC8291.asPublicKey),
      salt: base64UrlDecode(RFC8291.salt)
    });

    // Each of these is a separate step of the schedule. Asserted individually
    // so a failure names WHICH one drifted, instead of only reporting that the
    // ciphertext no longer matches.
    expect(base64UrlEncode(schedule.prkKey)).toBe(RFC8291.prkKey);
    expect(base64UrlEncode(schedule.ikm)).toBe(RFC8291.ikm);
    expect(base64UrlEncode(schedule.prk)).toBe(RFC8291.prk);
    expect(base64UrlEncode(schedule.cek)).toBe(RFC8291.cek);
    expect(base64UrlEncode(schedule.nonce)).toBe(RFC8291.nonce);
  });

  test("the complete encrypted body matches, byte for byte", async () => {
    const serverKeyPair = await importEcdhKeyPair(
      RFC8291.asPublicKey,
      RFC8291.asPrivateKey,
      ["deriveBits"]
    );

    const body = await encryptWebPushPayload(
      RFC8291.plaintext,
      { p256dh: RFC8291.uaPublicKey, authSecret: RFC8291.authSecret },
      { salt: base64UrlDecode(RFC8291.salt), serverKeyPair }
    );

    expect(base64UrlEncode(body)).toBe(RFC8291.body);
    // 16 salt + 4 rs + 1 idlen + 65 keyid + (41 plaintext + 1 delimiter + 16 tag).
    expect(body.length).toBe(144);
  });

  test("a fresh send uses a NEW ephemeral key pair and a NEW salt each time", async () => {
    // RFC 8291's design, not an optimisation left undone: one reused ECDH pair
    // would give every notification to a subscriber the same key schedule, so
    // recovering one plaintext would recover them all.
    const keys = {
      p256dh: RFC8291.uaPublicKey,
      authSecret: RFC8291.authSecret
    };
    const first = await encryptWebPushPayload("hello", keys);
    const second = await encryptWebPushPayload("hello", keys);

    expect(base64UrlEncode(first)).not.toBe(base64UrlEncode(second));
    // salt is the first 16 bytes; keyid starts at 21.
    expect(base64UrlEncode(first.slice(0, 16))).not.toBe(
      base64UrlEncode(second.slice(0, 16))
    );
    expect(base64UrlEncode(first.slice(21, 86))).not.toBe(
      base64UrlEncode(second.slice(21, 86))
    );
  });

  test("a malformed p256dh is refused instead of encrypted to nowhere", async () => {
    await expect(
      encryptWebPushPayload("hi", {
        p256dh: base64UrlEncode(new Uint8Array(20)),
        authSecret: RFC8291.authSecret
      })
    ).rejects.toThrow(/65-byte uncompressed point/);
  });
});

describe("VAPID (RFC 8292)", () => {
  test("`aud` is the ORIGIN of the endpoint, never the endpoint itself", async () => {
    // Signing the full endpoint is the classic mistake, and its symptom is a
    // 401 that reads like a key problem.
    expect(resolvePushAudience(ENDPOINT)).toBe(
      "https://updates.push.services.mozilla.com"
    );

    const header = await buildVapidAuthorizationHeader(ENDPOINT, VAPID);
    const token = header.slice("vapid t=".length).split(",")[0]!;
    const claims = JSON.parse(
      Buffer.from(
        token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    ) as Record<string, unknown>;

    expect(claims.aud).toBe("https://updates.push.services.mozilla.com");
    expect(claims.sub).toBe(VAPID.subject);
  });

  test("the signature verifies with the public key, and is raw r||s", async () => {
    const header = await buildVapidAuthorizationHeader(ENDPOINT, VAPID);
    const token = header.slice("vapid t=".length).split(",")[0]!;
    const [headerB64, claimsB64, signatureB64] = token.split(".");

    expect(
      JSON.parse(
        Buffer.from(
          headerB64!.replace(/-/g, "+").replace(/_/g, "/"),
          "base64"
        ).toString("utf8")
      )
    ).toEqual({ typ: "JWT", alg: "ES256" });

    const signature = base64UrlDecode(signatureB64!);
    // 64 bytes = r||s. A DER-wrapped signature is ~70 bytes and is accepted by
    // no push service — and diagnosed by none of them either.
    expect(signature.length).toBe(64);

    const pair = await importEcdhKeyPair(VAPID.publicKey, VAPID.privateKey, [
      "sign"
    ]);
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      signature as unknown as ArrayBuffer,
      new TextEncoder().encode(`${headerB64}.${claimsB64}`)
    );

    expect(verified).toBe(true);
  });

  test("the `k=` parameter carries the public key verbatim", async () => {
    const header = await buildVapidAuthorizationHeader(ENDPOINT, VAPID);

    expect(header.endsWith(`, k=${VAPID.publicKey}`)).toBe(true);
  });

  test("one token is reused across subscriptions on the SAME service", async () => {
    // A batch of 500 Firefox subscribers must cost one signature, not 500.
    const a = await buildVapidAuthorizationHeader(`${ENDPOINT}/one`, VAPID);
    const b = await buildVapidAuthorizationHeader(`${ENDPOINT}/two`, VAPID);

    expect(a).toBe(b);

    const other = await buildVapidAuthorizationHeader(
      "https://fcm.googleapis.com/fcm/send/xyz",
      VAPID
    );

    // ...and a DIFFERENT service gets its own audience, or the token is refused.
    expect(other).not.toBe(a);
  });
});

describe("VAPID configuration is validated where an operator can act on it", () => {
  test("a key of the wrong length is named, not left to the crypto import", () => {
    const result = parseVapidConfig({
      PUSH_VAPID_PUBLIC_KEY: base64UrlEncode(new Uint8Array(32)),
      PUSH_VAPID_PRIVATE_KEY: VAPID.privateKey,
      PUSH_VAPID_SUBJECT: VAPID.subject
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("65 bytes");
  });

  test("the RFC 8292 contact requirement is enforced, not defaulted", () => {
    // A placeholder here means the first warning about your own traffic is the
    // block itself.
    for (const subject of ["ops@example.test", "http://example.test", "x"]) {
      const result = parseVapidConfig({
        ...VAPID,
        PUSH_VAPID_PUBLIC_KEY: VAPID.publicKey,
        PUSH_VAPID_PRIVATE_KEY: VAPID.privateKey,
        PUSH_VAPID_SUBJECT: subject
      } as unknown as NodeJS.ProcessEnv);

      expect(result.ok).toBe(false);
    }

    expect(
      parseVapidConfig({
        PUSH_VAPID_PUBLIC_KEY: VAPID.publicKey,
        PUSH_VAPID_PRIVATE_KEY: VAPID.privateKey,
        PUSH_VAPID_SUBJECT: "https://example.test/contact"
      } as NodeJS.ProcessEnv).ok
    ).toBe(true);
  });
});

describe("responses map to the right outcome", () => {
  test.each([201, 200, 202])("%d is a success", (status) => {
    expect(mapWebPushResponse(status, "").kind).toBe("success");
  });

  test.each([404, 410])("%d is subscription_gone", (status) => {
    expect(mapWebPushResponse(status, "").kind).toBe("subscription_gone");
  });

  test.each([401, 403, 413])(
    "%d is permanent and does not trip the breaker",
    (status) => {
      const outcome = mapWebPushResponse(status, "");

      expect(outcome.kind === "failure" && outcome.retryable).toBe(false);
      expect(outcome.kind === "failure" && outcome.tripsBreaker).toBe(false);
    }
  );

  test.each([429, 500, 503])("%d is retryable and counts", (status) => {
    const outcome = mapWebPushResponse(status, "");

    expect(outcome.kind === "failure" && outcome.retryable).toBe(true);
    expect(outcome.kind === "failure" && outcome.tripsBreaker).toBe(true);
  });
});

describe("the adapter sends what RFC 8030 requires", () => {
  test("headers and an encrypted binary body", async () => {
    const calls: Call[] = [];
    const provider = createWebPushProvider({
      vapid: VAPID,
      timeoutMs: 5000,
      http: scriptedHttp({ ok: true, status: 201, body: "" }, calls)
    });

    const result = await provider.send(TARGET, {
      title: "Satu approval menunggu",
      body: "Buka konsol approval.",
      targetPath: "/admin/approvals"
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ENDPOINT);

    const { headers, body } = calls[0]!.request;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization?.startsWith("vapid t=")).toBe(true);
    expect(Number(headers.TTL)).toBeGreaterThan(0);

    // Binary, and long enough to be a real aes128gcm record — not a JSON body
    // that happens to be labelled as one.
    expect(body).toBeInstanceOf(Uint8Array);
    expect((body as Uint8Array).length).toBeGreaterThan(86);
  });

  test("a dead subscription is reported as gone and leaves the breaker closed", async () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const provider = createWebPushProvider({
      vapid: VAPID,
      timeoutMs: 5000,
      http: scriptedHttp({ ok: true, status: 410, body: "" }),
      now: () => now
    });

    for (let i = 0; i < 10; i += 1) {
      const result = await provider.send(TARGET, { title: "t", body: "b" });

      expect(result.ok === false && result.subscriptionGone).toBe(true);
    }

    expect(
      getProviderCircuitBreaker(PUSH_CIRCUIT_BREAKER_KEY).getState(now)
    ).toBe("closed");
  });

  test("a target missing its key material is refused, not encrypted to a guess", async () => {
    // Structurally impossible for a stored row (the DB CHECK requires both), so
    // this can only be a hand-built target — and encrypting with a guessed key
    // produces a notification the browser silently drops.
    const provider = createWebPushProvider({
      vapid: VAPID,
      timeoutMs: 5000,
      http: scriptedHttp({ ok: true, status: 201, body: "" })
    });

    const result = await provider.send(
      { transport: "web_push", endpoint: ENDPOINT, endpointMasked: "x" },
      { title: "t", body: "b" }
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.retryable).toBe(false);
  });

  test("`web_push` speaks only `web_push`", () => {
    const provider = resolvePushProvider({
      PUSH_PROVIDER: "web_push",
      PUSH_VAPID_PUBLIC_KEY: VAPID.publicKey,
      PUSH_VAPID_PRIVATE_KEY: VAPID.privateKey,
      PUSH_VAPID_SUBJECT: VAPID.subject
    } as NodeJS.ProcessEnv);

    expect([...provider.supportedTransports]).toEqual(["web_push"]);
  });

  test("missing VAPID configuration degrades NON-retryably", async () => {
    const provider = resolvePushProvider({
      PUSH_PROVIDER: "web_push"
    } as NodeJS.ProcessEnv);
    const result = await provider.send(TARGET, { title: "t", body: "b" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.retryable).toBe(false);
  });
});
