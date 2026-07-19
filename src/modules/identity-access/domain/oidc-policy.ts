/**
 * Pure OIDC decision logic (Issue #185, epic ERP-readiness enterprise auth
 * #177) — "pure decision, DB/network does the fetching", same shape as
 * `mfa-policy.ts`. Nothing here makes a network call or reads `process.env`;
 * callers pass already-resolved config/claims. Ported/adapted from awcms-mini
 * `domain/google-oidc-policy.ts` (Issue #590), with `azp` (authorized-party)
 * validation ADDED per issue #185's fail-closed claim requirements.
 */

export type OAuthRequestSnapshot = {
  expiresAt: Date;
  consumedAt: Date | null;
};

export type OAuthRequestDenyReason = "not_found" | "already_used" | "expired";

export type OAuthRequestEvaluation =
  { outcome: "valid" } | { outcome: "invalid"; reason: OAuthRequestDenyReason };

/** The single-use, TTL-bounded evaluation of an in-flight OAuth request row. */
export function evaluateOAuthRequest(
  row: OAuthRequestSnapshot | null,
  now: Date
): OAuthRequestEvaluation {
  if (!row) {
    return { outcome: "invalid", reason: "not_found" };
  }

  if (row.consumedAt !== null) {
    return { outcome: "invalid", reason: "already_used" };
  }

  if (row.expiresAt.getTime() <= now.getTime()) {
    return { outcome: "invalid", reason: "expired" };
  }

  return { outcome: "valid" };
}

export type IdTokenClaims = {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  nonce?: unknown;
  sub?: unknown;
};

export type IdTokenValidationOptions = {
  expectedIssuer: string;
  expectedAudience: string;
  expectedNonce: string;
  /** Seconds; Unix time, matching the JWT `exp`/`iat` claims' own unit. */
  nowSec: number;
  /** Allowed clock skew (seconds) for `exp`/`iat`. Small and bounded. */
  clockSkewSec?: number;
};

export type IdTokenDenyReason =
  | "missing_subject"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "azp_mismatch"
  | "expired"
  | "issued_in_future"
  | "nonce_mismatch";

export type IdTokenValidation =
  | { outcome: "valid"; subject: string; issuer: string }
  | { outcome: "invalid"; reason: IdTokenDenyReason };

const DEFAULT_CLOCK_SKEW_SEC = 60;

/**
 * Validates the claims of an ALREADY signature-verified ID token (signature is
 * `jwt-verify.ts`'s job). Fail-closed on every claim the issue requires:
 * issuer, audience, authorized party (`azp`), expiry, nonce — plus an immutable
 * non-empty `sub` (the external-identity key; never email) and an `iat` sanity
 * bound. Per OIDC Core §3.1.3.7: when `aud` contains multiple values, `azp`
 * MUST be present and equal the client id; when present at all, `azp` must equal
 * the client id.
 */
export function validateIdTokenClaims(
  claims: IdTokenClaims,
  options: IdTokenValidationOptions
): IdTokenValidation {
  const skew = options.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;

  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    return { outcome: "invalid", reason: "missing_subject" };
  }

  if (typeof claims.iss !== "string" || claims.iss !== options.expectedIssuer) {
    return { outcome: "invalid", reason: "issuer_mismatch" };
  }

  const audiences =
    typeof claims.aud === "string"
      ? [claims.aud]
      : Array.isArray(claims.aud) &&
          claims.aud.every((entry) => typeof entry === "string")
        ? (claims.aud as string[])
        : null;

  if (!audiences || !audiences.includes(options.expectedAudience)) {
    return { outcome: "invalid", reason: "audience_mismatch" };
  }

  // `azp` is REQUIRED when there is more than one audience, and whenever
  // present must equal the client id (OIDC Core §3.1.3.7).
  const hasAzp = claims.azp !== undefined && claims.azp !== null;

  if (audiences.length > 1 && !hasAzp) {
    return { outcome: "invalid", reason: "azp_mismatch" };
  }

  if (hasAzp && claims.azp !== options.expectedAudience) {
    return { outcome: "invalid", reason: "azp_mismatch" };
  }

  if (typeof claims.exp !== "number" || claims.exp <= options.nowSec - skew) {
    return { outcome: "invalid", reason: "expired" };
  }

  if (
    claims.iat !== undefined &&
    (typeof claims.iat !== "number" || claims.iat > options.nowSec + skew)
  ) {
    return { outcome: "invalid", reason: "issued_in_future" };
  }

  if (claims.nonce !== options.expectedNonce) {
    return { outcome: "invalid", reason: "nonce_mismatch" };
  }

  return { outcome: "valid", subject: claims.sub, issuer: claims.iss };
}

/**
 * Auto-linking-by-email guardrail. Fail-closed by construction: an empty
 * `allowedDomains` list means auto-linking is NEVER allowed, not "allow any
 * domain".
 */
export function isEmailDomainAllowed(
  email: string,
  allowedDomains: readonly string[]
): boolean {
  if (allowedDomains.length === 0) {
    return false;
  }

  const atIndex = email.lastIndexOf("@");

  if (atIndex === -1) {
    return false;
  }

  const domain = email.slice(atIndex + 1).toLowerCase();

  return allowedDomains.includes(domain);
}
