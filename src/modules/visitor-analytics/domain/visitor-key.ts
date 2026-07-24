/**
 * Anonymous visitor key + salted hashing helpers (ported from awcms-micro
 * epic #617-#624). Pure — no cookie/request I/O here; the ingest endpoint
 * reads/writes the actual cookie and calls `resolveVisitorKey` with whatever
 * raw value it found (or `undefined`).
 *
 * All three hash functions here are HMAC-SHA256 keyed by
 * `VISITOR_ANALYTICS_HASH_SALT` (`resolveVisitorAnalyticsConfig().hashSalt`),
 * not plain SHA256 — unlike `profile-identity/domain/identifier.ts`'s
 * `hashIdentifier` (deliberately unsalted), a deployment salt here prevents
 * an external party from correlating these hashes against a precomputed
 * table of `sha256(ip)`/`sha256(userAgent)` values computed for some *other*
 * deployment or purpose — IP addresses and user-agents are far lower-entropy
 * and more universally observable than the identifiers `hashIdentifier`
 * hashes. These remain lookup/dedup hashes, not credential storage:
 * enumeration risk is mitigated by RLS on the tables that store them
 * (migration 050), not by hash cost, so a fast keyed hash (not
 * bcrypt/argon2) is correct here too.
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

function hmacSha256(value: string, salt: string): string {
  return `sha256:${createHmac("sha256", salt).update(value).digest("hex")}`;
}

export function hashVisitorKey(visitorKey: string, salt: string): string {
  return hmacSha256(visitorKey, salt);
}

export function hashIpAddress(ipAddress: string, salt: string): string {
  return hmacSha256(ipAddress, salt);
}

export function hashUserAgent(userAgent: string, salt: string): string {
  return hmacSha256(userAgent, salt);
}
