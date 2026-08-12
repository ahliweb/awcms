import { createHash, randomBytes } from "node:crypto";

/**
 * The delegated-access redemption code (ADR-0090, Gelombang 8 PR 8.2 of #423).
 *
 * ```
 * awcmsd_<43 chars base64url secret>
 * ```
 *
 * Minted when a customer APPROVES delegated access for a partner, handed to the
 * partner out of band, and redeemed exactly once for a real
 * `awcms_tenant_users` row in the customer's tenant. It is the short-lived
 * hashed artefact ADR-0050 established: what crosses the boundary between two
 * organisations is a code, never a live credential and never a read.
 *
 * ## What it is NOT
 *
 * It is not a bearer. Holding one authenticates nothing and authorizes nothing;
 * redeeming one requires the holder to ALSO prove they are a principal, because
 * the membership it prints has to belong to a human the audit trail can name.
 *
 * That is also why the hash carries its own namespace. A human who pastes this
 * code into an `Authorization` header — and someone will — must not have it
 * looked up as a session token. `dg-sha256:` is the discriminator that survives
 * hashing, so the authorization chokepoint can refuse it from the hash alone,
 * with no database round trip, exactly as it refuses `pt-sha256:` (ADR-0088)
 * and routes `mc-sha256:` (ADR-0049).
 */
export const DELEGATED_ACCESS_CODE_PREFIX = "awcmsd_";

/** Namespace tag on the stored hash — the kind discriminator that survives hashing. */
export const DELEGATED_ACCESS_HASH_PREFIX = "dg-sha256:";

export function generateDelegatedAccessCode(): string {
  return `${DELEGATED_ACCESS_CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isDelegatedAccessCode(value: string): boolean {
  return value.startsWith(DELEGATED_ACCESS_CODE_PREFIX);
}

export function hashDelegatedAccessCode(code: string): string {
  return `${DELEGATED_ACCESS_HASH_PREFIX}${createHash("sha256")
    .update(code)
    .digest("hex")}`;
}

export function isDelegatedAccessCodeHash(value: string): boolean {
  return value.startsWith(DELEGATED_ACCESS_HASH_PREFIX);
}
