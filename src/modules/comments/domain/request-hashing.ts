/**
 * Opaque one-way hashing of abuse-correlation request signals (client IP, user
 * agent, reporter email) for the `comments` module (ADR-0041, ported from
 * awcms-micro Issue #271). These are NEVER stored raw — only as a
 * salted-by-tenant sha256, so a row can be correlated for abuse without ever
 * revealing the original value. Pure — no I/O.
 *
 * The tenant salt is what stops the same IP hashing identically across tenants:
 * without it, one tenant's moderator could correlate a visitor's activity on
 * another tenant's site by comparing hashes.
 */
import { createHash } from "node:crypto";

/** sha256(tenantId + ":" + value). Returns `null` for a null/empty value. */
export function hashRequestSignal(
  tenantId: string,
  value: string | null | undefined
): string | null {
  if (!value) return null;
  return createHash("sha256").update(`${tenantId}:${value}`).digest("hex");
}
