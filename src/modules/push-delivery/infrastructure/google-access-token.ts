/**
 * Google OAuth2 access tokens from a service account, WITHOUT a dependency
 * (Issue #466, ADR-0074).
 *
 * `google-auth-library` and `firebase-admin` both do this, and both would be a
 * new runtime dependency in a repo that ships with two. The precedent for
 * refusing is already written down: `src/lib/auth/jwt-verify.ts` does
 * dependency-free JWT VERIFICATION through `crypto.subtle` rather than adding
 * `jose`. This is the same size of problem in the other direction — a JWT
 * bearer assertion (RFC 7523) is a header, a claim set, and one RS256
 * signature.
 *
 * The flow, in full:
 *
 *   1. build `{alg:"RS256",typ:"JWT"}` . `{iss,scope,aud,exp,iat}`;
 *   2. sign it with the service account's PKCS#8 private key via
 *      `crypto.subtle` — never a hand-rolled RSA implementation;
 *   3. POST it to the credential's own `token_uri` as
 *      `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`;
 *   4. cache the returned access token until shortly before it expires.
 *
 * ## The cache, and why it is keyed the way it is
 *
 * Google's access tokens last an hour. Minting one per notification would add
 * an RSA signature and a full HTTPS round-trip to every send, and would hit the
 * token endpoint's own rate limits on any real volume.
 *
 * The cache is keyed by `clientEmail` — the identity the token speaks as —
 * rather than by "the configured credential". Those are the same thing today
 * (credentials are per-deployment, ADR-0074), and if they ever stop being the
 * same thing, keying by identity is the version that stays correct instead of
 * handing one project's token to another.
 *
 * It is per-PROCESS, in memory. Deliberately: an access token is a live bearer
 * credential, and putting it in Redis or Postgres would persist a credential at
 * rest to save an HTTP call per hour per process. `awcms_bff_clients`'s schema
 * comment makes the same trade in the same direction.
 */
import { log } from "../../../lib/logging/logger";
import {
  FCM_OAUTH_SCOPE,
  type FcmServiceAccount
} from "../domain/fcm-credentials";
import type { PushHttpClient } from "./push-http-client";

const MODULE_KEY = "push_delivery";

/** How long an assertion is valid. Google allows up to an hour; short is fine — it is used once, immediately. */
const ASSERTION_LIFETIME_SECONDS = 300;

/**
 * Refresh this long before the token actually expires. Covers clock skew
 * between us and Google plus the round-trip itself, so a token is never used in
 * the window where it is technically alive here and already dead there — a
 * failure that would surface as an intermittent 401 on a fraction of sends.
 */
const REFRESH_MARGIN_MS = 60_000;

type CachedToken = { accessToken: string; expiresAtMs: number };

const tokenCache = new Map<string, CachedToken>();

/** Test seam. Never called in production — the cache is per-process and short-lived by design. */
export function clearGoogleAccessTokenCache(): void {
  tokenCache.clear();
}

function base64Url(bytes: Uint8Array | ArrayBuffer): string {
  return Buffer.from(bytes as ArrayBuffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * PEM → DER. `crypto.subtle.importKey("pkcs8", …)` takes the raw DER bytes, so
 * the armour and every newline have to come off first. Guarded by
 * `parseFcmCredentialsBase64`, which has already rejected a PKCS#1 block with a
 * message that names the difference — without that, this produces DER that
 * imports as `DataError` with nothing pointing at the cause.
 */
function pemToPkcs8Der(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  return Uint8Array.from(Buffer.from(body, "base64")).buffer;
}

export type MintAccessTokenOptions = {
  http: PushHttpClient;
  timeoutMs: number;
  now?: Date;
};

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string; retryable: boolean };

async function signAssertion(
  credential: FcmServiceAccount,
  nowSeconds: number
): Promise<string> {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: credential.clientEmail,
    scope: FCM_OAUTH_SCOPE,
    aud: credential.tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_LIFETIME_SECONDS
  });
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Der(credential.privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64Url(signature)}`;
}

/**
 * Returns a usable access token, from cache when one is still comfortably
 * valid.
 *
 * `retryable` on failure distinguishes "Google said no" from "the call did not
 * land": a rejected assertion (`invalid_grant` — wrong key, wrong clock, wrong
 * account) will be rejected identically on every retry, and retrying it burns
 * every queued notification's budget against a condition only an operator can
 * fix.
 */
export async function getGoogleAccessToken(
  credential: FcmServiceAccount,
  options: MintAccessTokenOptions
): Promise<AccessTokenResult> {
  const now = options.now ?? new Date();
  const cached = tokenCache.get(credential.clientEmail);

  if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > now.getTime()) {
    return { ok: true, accessToken: cached.accessToken };
  }

  let assertion: string;

  try {
    assertion = await signAssertion(
      credential,
      Math.floor(now.getTime() / 1000)
    );
  } catch (error) {
    // An import/sign failure is a malformed key: the same key will fail the
    // same way next minute.
    return {
      ok: false,
      error: `could not sign the service-account assertion: ${(error as Error).name}`,
      retryable: false
    };
  }

  const response = await options.http(credential.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString(),
    timeoutMs: options.timeoutMs
  });

  if (!response.ok) {
    return { ok: false, error: response.reason, retryable: true };
  }

  if (response.status !== 200) {
    // The body can name the reason (`invalid_grant`, `invalid_scope`) and never
    // contains the key, so it is safe to surface — but only 4xx is treated as
    // permanent. A 5xx from Google's token endpoint is an outage.
    const retryable = response.status >= 500 || response.status === 429;

    log("error", "push.fcm.token_request_failed", {
      moduleKey: MODULE_KEY,
      httpStatus: response.status,
      retryable
    });

    return {
      ok: false,
      error: `token endpoint returned ${response.status}: ${response.body.slice(0, 200)}`,
      retryable
    };
  }

  let payload: { access_token?: unknown; expires_in?: unknown };

  try {
    payload = JSON.parse(response.body) as typeof payload;
  } catch {
    return {
      ok: false,
      error: "token endpoint returned a non-JSON body",
      retryable: true
    };
  }

  if (typeof payload.access_token !== "string" || payload.access_token === "") {
    return {
      ok: false,
      error: "token endpoint returned no access_token",
      retryable: true
    };
  }

  // Missing/odd `expires_in` falls back to a conservative 30 minutes rather
  // than to Google's documented hour: caching a token LONGER than it lives
  // produces 401s that look like a credential problem.
  const expiresInSeconds =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : 1800;

  tokenCache.set(credential.clientEmail, {
    accessToken: payload.access_token,
    expiresAtMs: now.getTime() + expiresInSeconds * 1000
  });

  return { ok: true, accessToken: payload.access_token };
}

/** Drops the cached token for one identity — called when FCM answers 401, so the next attempt mints a fresh one instead of replaying a token Google has already rejected. */
export function invalidateGoogleAccessToken(clientEmail: string): void {
  tokenCache.delete(clientEmail);
}
