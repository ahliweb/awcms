/**
 * The one place a role grant is written (ADR-0078, Gelombang 3 PR 3.2 of #423).
 *
 * Every path that used to `INSERT INTO awcms_access_assignments` now calls
 * `grantRolePolicy`, and every path that removed a grant calls
 * `revokeRoleGrants`. `fetchGrantedPermissionKeys` reads both tables, so a
 * subject granted through here is indistinguishable from one granted through the
 * old table — which is what lets the two coexist while PR 3.3 moves the
 * remaining rows across.
 *
 * ## NOT a dual write
 *
 * ADR-0078 chose a third table precisely so expand/migrate/contract needs no
 * dual write. A new grant lands in ONE table: `awcms_access_policies`. Legacy
 * rows stay where they are and keep working through the union until the backfill
 * moves them. Writing both would reintroduce the failure this design avoids —
 * two writes that can succeed apart, leaving a subject holding a role according
 * to one table and not the other, with no way to tell which is right.
 *
 * ## Removal has to look in both places
 *
 * `revokeRoleGrants` deletes the legacy row AND revokes any active policy,
 * because for as long as the backfill has not run, a grant may live in either.
 * A remover that only knew about the new table would report success while the
 * role survived — the most dangerous shape available here, since it fails toward
 * ACCESS RETAINED and nothing observes it.
 */

/** `scope_type` for a grant that is not confined to any business scope. */
const TENANT_WIDE_SCOPE_TYPE = "tenant";

export type GrantRolePolicyInput = {
  tenantUserId: string;
  roleId: string;
  /** `null` for bootstrap, where no session exists yet to attribute it to. */
  grantedByTenantUserId: string | null;
  reason?: string;
};

/**
 * Grants a role, tenant-wide, and records the `granted` lifecycle event.
 *
 * `scope_id` carries the tenant id, the convention `access-control.ts` documents
 * for `TENANT_WIDE_SCOPE_TYPE` ("conventionally the tenant id, but coverage does
 * not depend on it"). Every grant written today is tenant-wide: narrower scopes
 * become writable when PR 3.4 teaches evaluation to qualify them, and shipping a
 * writer for a scope the evaluator still ignores would hand out grants that look
 * narrow and are not.
 *
 * Lets a unique violation propagate rather than translating it. The caller knows
 * whether "already granted" is a `409` or an idempotent success, and — because
 * the violation has already aborted the transaction — it must not write anything
 * further before returning.
 */
export async function grantRolePolicy(
  tx: Bun.SQL,
  tenantId: string,
  input: GrantRolePolicyInput
): Promise<{ id: string }> {
  const rows = (await tx`
    INSERT INTO awcms_access_policies
      (tenant_id, subject_type, tenant_user_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id, reason)
    VALUES
      (${tenantId}, 'tenant_user', ${input.tenantUserId}, ${input.roleId},
       ${TENANT_WIDE_SCOPE_TYPE}, ${tenantId},
       ${input.grantedByTenantUserId}, ${input.reason ?? null})
    RETURNING id
  `) as { id: string }[];

  const policyId = rows[0]!.id;

  await tx`
    INSERT INTO awcms_access_policy_events
      (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
    VALUES (${tenantId}, ${policyId}, 'granted', ${input.grantedByTenantUserId}, ${input.reason ?? null})
  `;

  return { id: policyId };
}

/**
 * Whether the subject already holds this role through EITHER table.
 *
 * The pre-check `assignRole` used to get for free from a unique index, which now
 * only covers one of the two places a live grant can be. Without this, assigning
 * a role somebody already holds through a legacy row would report success and
 * mint a second, redundant grant.
 */
export async function subjectHoldsRole(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  roleId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1
    FROM awcms_access_assignments
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND role_id = ${roleId}
    UNION ALL
    SELECT 1
    FROM awcms_access_policies
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND role_id = ${roleId}
      AND status = 'active'
    LIMIT 1
  `) as unknown[];

  return rows.length > 0;
}

/**
 * Removes a role grant from wherever it lives, and reports whether anything was
 * actually removed.
 *
 * The legacy row is DELETEd (it has no lifecycle to transition to) while a
 * policy is transitioned to `revoked` with its timestamp — the partial unique
 * index is on active rows only, so a revoked policy does not block re-granting
 * the same role later, which is the ordinary case rather than an edge one.
 */
export async function revokeRoleGrants(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  roleId: string,
  actorTenantUserId: string | null,
  now: Date,
  reason?: string
): Promise<boolean> {
  const legacy = (await tx`
    DELETE FROM awcms_access_assignments
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND role_id = ${roleId}
    RETURNING id
  `) as { id: string }[];

  const revoked = (await tx`
    UPDATE awcms_access_policies
    SET status = 'revoked',
        revoked_at = ${now},
        revoked_by_tenant_user_id = ${actorTenantUserId},
        revoke_reason = ${reason ?? null},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND role_id = ${roleId}
      AND status = 'active'
    RETURNING id
  `) as { id: string }[];

  for (const policy of revoked) {
    await tx`
      INSERT INTO awcms_access_policy_events
        (tenant_id, policy_id, event_type, actor_tenant_user_id, reason)
      VALUES (${tenantId}, ${policy.id}, 'revoked', ${actorTenantUserId}, ${reason ?? null})
    `;
  }

  return legacy.length > 0 || revoked.length > 0;
}
