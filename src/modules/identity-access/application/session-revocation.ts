/**
 * Bulk session revocation (Wave 2 delta auth, adapted from awcms-micro Issue
 * #496) — `logout.ts`'s single-session `revoked_at` update, widened to every
 * still-live session of ONE identity within ONE tenant.
 *
 * Called after a completed password reset so a session stolen before the reset
 * cannot outlive the credential change. This is the whole reason a reset is a
 * security event and not just a profile edit: without it, an attacker who
 * already holds a session keeps it after the legitimate owner "recovers" the
 * account.
 *
 * It also covers the MFA step-up state, without naming it: `mfa-session-assurance.ts`
 * treats a row with a non-null `revoked_at` as gone (`if (row.revoked_at) return null`),
 * so an `aal2` session that was stepped up before the reset stops being an
 * `aal2` session at the same instant.
 *
 * `AND revoked_at IS NULL` keeps the FIRST revocation instant on rows that were
 * already revoked, rather than restamping them with the reset's clock.
 */
export async function revokeAllSessionsForIdentity(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  now: Date
): Promise<void> {
  await tx`
    UPDATE awcms_sessions
    SET revoked_at = ${now}
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId}
      AND revoked_at IS NULL
  `;
}
