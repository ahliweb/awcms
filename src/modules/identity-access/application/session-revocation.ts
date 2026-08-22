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
 * ## It covers ONE tenant, and that used to be the whole guarantee
 *
 * Finding A5. This paragraph previously read as though a reset ended every
 * session; the `WHERE tenant_id = …` above says otherwise, and it has to —
 * `awcms_sessions` is FORCE RLS and this transaction is scoped to one tenant.
 * Meanwhile the credential it is reacting to is replaced for the whole PRINCIPAL
 * (ADR-0086). So recovering from tenant A changed the password everywhere and
 * revoked nothing in tenant B, where the stolen cookie actually was.
 *
 * What closes that is NOT this function widening. It is
 * `session-credential-epoch.ts`: the credential change bumps
 * `awcms_principals.credential_epoch`, every session carries the epoch it was
 * minted under, and a session behind its principal is refused by every reader
 * in every tenant at once — with no writer ever crossing a tenant boundary.
 *
 * This function still matters and is not redundant. The epoch answers "is this
 * credential still current"; `revoked_at` answers "was this session ended", and
 * the admin/self-service revocation surfaces, session-fixation rotation on
 * step-up, and the delegated-grant sweep all need the second question. Only the
 * reset needs both.
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
