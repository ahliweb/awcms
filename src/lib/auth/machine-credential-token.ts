import { createHash, randomBytes } from "node:crypto";

/**
 * Machine credential token format (ADR-0049 §4).
 *
 * ```
 * awcmsm_<32 hex chars = tenant uuid without dashes>_<43 chars base64url secret>
 * ```
 *
 * ## Why the token carries its tenant
 *
 * A build then needs exactly ONE environment variable. It also closes the first
 * contract defect ADR-0047 verified against staging: a caller that never sends
 * a tenant header cannot send the WRONG one. The tenant id is not secret — it
 * travels in a plaintext header today — so embedding it reveals nothing new.
 *
 * ## Why a non-secret prefix
 *
 * `awcmsm_` is a discriminator, checked BEFORE any query: a bearer is known to
 * be a machine token or a session token without a database round trip, so the
 * request still costs exactly one lookup and neither kind can ever be searched
 * in the other's namespace.
 *
 * Only the SHA-256 of the FULL token is ever persisted — the same one-way
 * function sessions use, in a namespace tagged `mc-sha256:` so the guard
 * chokepoint can dispatch on the HASH alone (see `hashSessionToken`).
 */
export const MACHINE_CREDENTIAL_TOKEN_PREFIX = "awcmsm_";

/** Namespace tag on the stored hash — the kind discriminator that survives hashing. */
export const MACHINE_CREDENTIAL_HASH_PREFIX = "mc-sha256:";

/** 32 random bytes, base64url — identical entropy to a session token. */
const SECRET_BYTES = 32;

const TOKEN_PATTERN = /^awcmsm_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedMachineCredentialToken = {
  /** Canonical dashed uuid, ready to use as `tenant_id`. */
  tenantId: string;
};

/**
 * Whether `token` LOOKS like a machine credential token. Prefix-only, so an
 * otherwise malformed machine token is still routed to the machine path and
 * refused there — never silently retried as a session token, which would make
 * "malformed machine token" indistinguishable from "unknown session".
 */
export function isMachineCredentialToken(token: string): boolean {
  return token.startsWith(MACHINE_CREDENTIAL_TOKEN_PREFIX);
}

/**
 * Strict parse. Returns `null` for anything that is not exactly the documented
 * shape — including a well-formed prefix with a malformed body.
 */
export function parseMachineCredentialToken(
  token: string
): ParsedMachineCredentialToken | null {
  const match = TOKEN_PATTERN.exec(token);
  const hex = match?.[1];

  if (!hex) return null;

  const tenantId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");

  return { tenantId };
}

/**
 * Mints a token for `tenantId`. The plaintext returned here is the only copy
 * that will ever exist — the caller shows it once and stores only the hash.
 */
export function generateMachineCredentialToken(tenantId: string): string {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error("Machine credential token requires a uuid tenant id.");
  }

  const secret = randomBytes(SECRET_BYTES).toString("base64url");

  return `${MACHINE_CREDENTIAL_TOKEN_PREFIX}${tenantId.replaceAll("-", "").toLowerCase()}_${secret}`;
}

export function hashMachineCredentialToken(token: string): string {
  return `${MACHINE_CREDENTIAL_HASH_PREFIX}${createHash("sha256").update(token).digest("hex")}`;
}

/**
 * Whether a stored/derived hash belongs to the machine-credential namespace.
 * This is what lets `authorizeInTransaction` route a request to the right table
 * when all it has is the hash.
 */
export function isMachineCredentialHash(tokenHash: string): boolean {
  return tokenHash.startsWith(MACHINE_CREDENTIAL_HASH_PREFIX);
}
