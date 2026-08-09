/**
 * VAPID (RFC 8292) application-server authentication (Issue #466, ADR-0074).
 *
 * One ES256 JWT per push service origin, plus the server's public key, sent as:
 *
 *   Authorization: vapid t=<jwt>, k=<base64url uncompressed public point>
 *
 * Dependency-free through `crypto.subtle`, the same refusal
 * `src/lib/auth/jwt-verify.ts` and the FCM adapter already make. `web-push`
 * would bring this plus an HTTP client plus its own encryption — a dependency
 * for three files' worth of standard primitives.
 *
 * ## `aud` is the ORIGIN, and getting it wrong is a silent 401
 *
 * RFC 8292 §2 requires `aud` to be the origin of the push RESOURCE — scheme and
 * host of the endpoint, no path. A subscription endpoint is
 * `https://updates.push.services.mozilla.com/wpush/v2/<opaque>`; the audience is
 * `https://updates.push.services.mozilla.com`. Signing the whole endpoint is
 * the mistake this function exists to make impossible, so the caller passes an
 * endpoint and never an audience.
 *
 * ## The token is cached per origin
 *
 * A JWT is valid for hours and every subscription on one push service shares an
 * audience, so a batch of 500 Firefox subscribers needs ONE signature rather
 * than 500. Cached in memory only — like the Google access token, it is a live
 * bearer credential and persisting it to save a signature would be the wrong
 * trade.
 */
import {
  base64UrlEncode,
  importEcdhKeyPair
} from "../domain/web-push-encryption";

/**
 * 12 hours. RFC 8292 §2 caps `exp` at 24h from issuance; half of that leaves
 * room for a push service whose clock runs behind ours without ever needing to
 * be tuned.
 */
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

/** Re-sign this long before expiry, so a token is never presented in the window where it is alive here and expired there. */
const REFRESH_MARGIN_MS = 5 * 60_000;

type CachedVapidToken = { token: string; expiresAtMs: number };

const tokenCache = new Map<string, CachedVapidToken>();

/** Test seam. */
export function clearVapidTokenCache(): void {
  tokenCache.clear();
}

export type VapidKeyMaterial = {
  /** base64url, 65-byte uncompressed P-256 point. Also sent verbatim as the `k=` parameter. */
  publicKey: string;
  /** base64url, 32-byte P-256 scalar. */
  privateKey: string;
  /** `mailto:` or `https:` contact, per RFC 8292 §2.1 — how a push service reaches the operator about abuse. */
  subject: string;
};

/**
 * Throws on a malformed endpoint rather than returning a fallback: an audience
 * derived from a URL we could not parse would be signed into a token and
 * rejected by the push service as a 401, which reads like a key problem.
 */
export function resolvePushAudience(endpoint: string): string {
  return new URL(endpoint).origin;
}

export async function buildVapidAuthorizationHeader(
  endpoint: string,
  keys: VapidKeyMaterial,
  now: Date = new Date()
): Promise<string> {
  const audience = resolvePushAudience(endpoint);
  const cached = tokenCache.get(audience);

  if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > now.getTime()) {
    return `vapid t=${cached.token}, k=${keys.publicKey}`;
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const expSeconds = nowSeconds + TOKEN_LIFETIME_SECONDS;

  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  );
  const claims = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({ aud: audience, exp: expSeconds, sub: keys.subject })
    )
  );
  const signingInput = `${header}.${claims}`;

  const keyPair = await importEcdhKeyPair(keys.publicKey, keys.privateKey, [
    "sign"
  ]);

  // ES256 signatures are raw r||s (64 bytes), which is what `crypto.subtle`
  // produces for ECDSA — NOT the DER form some libraries emit. A DER signature
  // here is accepted by nothing and diagnosed by no one.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(signingInput)
    )
  );

  const token = `${signingInput}.${base64UrlEncode(signature)}`;

  tokenCache.set(audience, {
    token,
    expiresAtMs: expSeconds * 1000
  });

  return `vapid t=${token}, k=${keys.publicKey}`;
}
