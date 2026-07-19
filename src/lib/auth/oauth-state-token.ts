/**
 * OAuth `state`, OIDC `nonce`, and PKCE (`code_verifier`/`code_challenge`)
 * generation + hashing for the OIDC Authorization Code flow (Issue #185, epic
 * ERP-readiness enterprise auth #177). Ported/adapted from awcms-mini
 * `src/lib/auth/oauth-state-token.ts` (Issue #590), with PKCE ADDED (mini's
 * generic flow shipped without it) and the header rename `X-AWCMS-Mini-*` ->
 * `X-AWCMS-*`.
 *
 * `state` IS a bearer credential (its possession, embedded in the callback URL,
 * is what correlates the redirect back to the request that started it), so it
 * is hashed at rest exactly like a session/challenge token. The `nonce` and the
 * PKCE `code_verifier` are NOT bearer credentials on their own (see
 * `sql/025`'s comment) and are stored plaintext.
 *
 * `hashOAuthState` uses a fast hash (sha256) deliberately: `state` is a 256-bit
 * CSPRNG value, not a user-chosen low-entropy secret, so a slow adaptive hash
 * (argon2/bcrypt) would only cost every callback verification for no benefit —
 * offline brute-forcing a 256-bit random value is infeasible regardless of hash
 * speed. (CodeQL's `js/insufficient-password-hash` has been observed to flag
 * this exact shape as a false positive — the same accepted class as
 * `session-token.ts`'s `hashSessionToken`.)
 */
import { createHash, randomBytes } from "node:crypto";

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOAuthState(state: string): string {
  return `sha256:${createHash("sha256").update(state).digest("hex")}`;
}

/** The OIDC `nonce` — plaintext at rest (not a bearer credential; see file header). */
export function generateOidcNonce(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * A PKCE `code_verifier` (RFC 7636 §4.1) — a high-entropy 43-character
 * base64url string (32 random bytes). Stored server-side, single-use, only ever
 * replayed to the provider's own token endpoint alongside the client secret.
 */
export function generatePkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The S256 `code_challenge` for a verifier (RFC 7636 §4.2):
 * base64url(sha256(code_verifier)). Only the S256 method is used — the plain
 * method offers no binding and is never emitted.
 */
export function computePkceChallengeS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The IdP's redirect back to `callback.ts` is a plain top-level browser
 * navigation — there is no way to attach the usual `X-AWCMS-Tenant-ID` header,
 * so the tenant id travels inside the `state` param itself as a
 * `${tenantId}.${rawToken}` prefix. Safe because a tenant id is not a secret,
 * and the token portion (the actual CSRF/replay defense, always ≥32 random
 * bytes) is unchanged and still hashed at rest as if it travelled alone. The
 * tenant is bound to the state at `start` and re-derived here at `callback`, so
 * a callback can never be pointed at a different tenant than the one that
 * started the flow.
 */
export function buildOAuthStateParam(
  tenantId: string,
  rawToken: string
): string {
  return `${tenantId}.${rawToken}`;
}

export function parseOAuthStateParam(
  stateParam: string
): { tenantId: string; token: string } | null {
  const separatorIndex = stateParam.indexOf(".");

  if (separatorIndex === -1) {
    return null;
  }

  const tenantId = stateParam.slice(0, separatorIndex);
  const token = stateParam.slice(separatorIndex + 1);

  if (!UUID_PATTERN.test(tenantId) || token.length === 0) {
    return null;
  }

  return { tenantId, token };
}

/**
 * Validates a post-login `returnTo` target so the redirect after a successful
 * SSO login can never become an open redirect (issue's own security note).
 * Only a same-origin ABSOLUTE PATH is accepted: it must start with a single
 * `/`, must not start with `//` (protocol-relative → another origin), and must
 * not contain a scheme or backslash. Anything else falls back to `null` (the
 * caller then uses its safe default, `/admin`).
 */
export function sanitizeReturnTo(
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  // Reject any control character (CR/LF/TAB/NUL/DEL/etc.) as defense-in-depth
  // against header/response splitting -- a `Location: ${returnTo}` must never
  // carry a `\r\n`. (Bun's Response already throws on a CRLF header, but the
  // value should never reach that point.)
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return null;
  }

  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return null;
  }

  if (raw.includes("\\") || /^\/*[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return null;
  }

  return raw;
}
