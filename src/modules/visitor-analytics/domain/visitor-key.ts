/**
 * Anonymous visitor key + salted hashing helpers (ported from awcms-micro
 * epic #617-#624). Pure — no cookie/request I/O here; the ingest endpoint
 * reads/writes the actual cookie and calls `resolveVisitorKey` with whatever
 * raw value it found (or `undefined`).
 *
 * All three hash functions here are HMAC-SHA256 keyed by
 * `VISITOR_ANALYTICS_HASH_SALT` (`resolveVisitorAnalyticsConfig().hashSalt`)
 * AND bound to the tenant id, not plain SHA256 — unlike
 * `profile-identity/domain/identifier.ts`'s `hashIdentifier` (deliberately
 * unsalted). Two independent properties fall out of this construction:
 *
 *  - cross-DEPLOYMENT rainbow-table resistance: the deployment salt prevents
 *    an external party from correlating these hashes against a precomputed
 *    table of `sha256(ip)`/`sha256(userAgent)` values computed for some *other*
 *    deployment or purpose — IP addresses and user-agents are far lower-entropy
 *    and more universally observable than the identifiers `hashIdentifier`
 *    hashes.
 *  - cross-TENANT unlinkability (privacy-by-design): the tenant id is folded
 *    into the HMAC (`update(tenantId)` + a `\0` domain separator, so a
 *    value/tenant boundary can never be ambiguous), so the SAME browser/IP/
 *    user-agent yields DIFFERENT hashes for different tenants sharing one
 *    origin. Without this, identical hashes across tenants would let anyone who
 *    can read the raw hash columns of two tenants correlate a visitor between
 *    them at the storage layer. Cheap to require now while no data exists.
 *
 * These remain lookup/dedup hashes, not credential storage: enumeration risk is
 * mitigated by RLS on the tables that store them (migration 050), not by hash
 * cost, so a fast keyed hash (not bcrypt/argon2) is correct here too.
 */
import { createHmac, randomUUID } from "node:crypto";

const VISITOR_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh, cryptographically random anonymous visitor key (cookie value). */
export function generateVisitorKey(): string {
  return randomUUID();
}

/** True only for a value shaped like something `generateVisitorKey` produced. */
export function isValidVisitorKey(
  value: string | undefined | null
): value is string {
  return typeof value === "string" && VISITOR_KEY_PATTERN.test(value);
}

/**
 * Reuses `existingValue` if it looks like a real visitor key, otherwise
 * mints a new one — never trusts an arbitrary client-supplied string (e.g. a
 * forged non-UUID cookie value) as-is.
 */
export function resolveVisitorKey(
  existingValue: string | undefined | null
): string {
  return isValidVisitorKey(existingValue)
    ? existingValue
    : generateVisitorKey();
}

/**
 * HMAC-SHA256 keyed by the deployment `salt` and bound to `tenantId`. The
 * tenant id is fed FIRST, followed by a `\0` domain separator, so the boundary
 * between the tenant id and the hashed value is unambiguous (e.g. tenant `"ab"`
 * + value `"c"` can never collide with tenant `"a"` + value `"bc"`).
 */
function hmacSha256(value: string, salt: string, tenantId: string): string {
  return `sha256:${createHmac("sha256", salt)
    .update(tenantId)
    .update("\0")
    .update(value)
    .digest("hex")}`;
}

export function hashVisitorKey(
  visitorKey: string,
  salt: string,
  tenantId: string
): string {
  return hmacSha256(visitorKey, salt, tenantId);
}

export function hashIpAddress(
  ipAddress: string,
  salt: string,
  tenantId: string
): string {
  return hmacSha256(ipAddress, salt, tenantId);
}

export function hashUserAgent(
  userAgent: string,
  salt: string,
  tenantId: string
): string {
  return hmacSha256(userAgent, salt, tenantId);
}
