import type { TenantContext } from "../domain/access-control";
import { resolveActiveSession } from "./session-lookup";

/**
 * A resolved principal PLUS the service state of the tenant it belongs to —
 * Issue #429, ADR-0073.
 *
 * The status comes from a JOIN on the query that already runs, not from a
 * second round-trip. `awcms_tenants` is the deliberately RLS-free root table
 * (ADR-0003), so it is readable from inside the tenant transaction without any
 * policy work — which is what makes carrying the status free here.
 */
export type ResolvedTenantPrincipal = {
  context: TenantContext;
  /** `awcms_tenants.status` — `active` | `inactive` | `suspended` (sql/002). */
  tenantStatus: string;
};

/**
 * Builds the `TenantContext` for a tenant user that has ALREADY been
 * authenticated by something other than a session — today, a machine credential
 * (ADR-0049). Roles come from the same `awcms_access_assignments` join the
 * session path uses, so a machine principal is subject to exactly the same RBAC
 * membership, never a parallel one.
 *
 * ## Deliberately STRICTER than the session path
 *
 * `resolveTenantContext` above does not check `awcms_tenant_users.status` or
 * `awcms_identities.status`; deactivating a user therefore only takes effect
 * when their sessions expire or are revoked. That window is hours.
 *
 * A machine credential lives up to a YEAR, and nothing revokes credentials when
 * a service account is deactivated. Inheriting the same laxity would mean
 * "deactivate this service account" silently leaves a working key behind for
 * months — so both statuses are required here. Being stricter can only deny;
 * it can never grant something the session path would refuse.
 */
export async function resolveTenantContextForTenantUser(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<TenantContext | null> {
  return (
    (await resolveTenantPrincipalForTenantUser(tx, tenantId, tenantUserId))
      ?.context ?? null
  );
}

/**
 * As `resolveTenantContextForTenantUser`, but also carrying the tenant's
 * service state (ADR-0073). The `awcms_tenants` JOIN is free: the table has no
 * RLS and the query already runs.
 */
export async function resolveTenantPrincipalForTenantUser(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<ResolvedTenantPrincipal | null> {
  const rows = (await tx`
    SELECT tu.id, tu.identity_id, t.status AS tenant_status
    FROM awcms_tenant_users tu
    JOIN awcms_identities i
      ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
    JOIN awcms_tenants t ON t.id = tu.tenant_id
    WHERE tu.tenant_id = ${tenantId} AND tu.id = ${tenantUserId}
      AND tu.status = 'active' AND i.status = 'active'
  `) as { id: string; identity_id: string; tenant_status: string }[];

  const tenantUser = rows[0];
  if (!tenantUser) return null;

  const roleRows = (await tx`
    SELECT r.role_code
    FROM awcms_access_assignments aa
    JOIN awcms_roles r ON r.id = aa.role_id
    WHERE aa.tenant_id = ${tenantId} AND aa.tenant_user_id = ${tenantUser.id} AND r.deleted_at IS NULL
  `) as { role_code: string }[];

  return {
    context: {
      tenantId,
      tenantUserId: tenantUser.id,
      identityId: tenantUser.identity_id,
      roles: roleRows.map((row) => row.role_code)
    },
    tenantStatus: tenantUser.tenant_status
  };
}

export async function resolveTenantContext(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<TenantContext | null> {
  return (
    (await resolveTenantPrincipal(tx, tenantId, tokenHash, now))?.context ??
    null
  );
}

/**
 * As `resolveTenantContext`, but also carrying the tenant's service state
 * (ADR-0073).
 *
 * `resolveTenantContext` stays as the narrower view because seven call sites
 * outside the chokepoint use it — including `src/lib/auth/ssr-session.ts`,
 * which feeds all 32 admin screens. Widening its return type would be a
 * seven-file change to give six of them a field they do not read; keeping both
 * over ONE query keeps the two from drifting.
 */
export async function resolveTenantPrincipal(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<ResolvedTenantPrincipal | null> {
  const session = await resolveActiveSession(tx, tenantId, tokenHash, now);
  if (!session) return null;

  const tenantUserRows = await tx`
    SELECT tu.id, t.status AS tenant_status
    FROM awcms_tenant_users tu
    JOIN awcms_tenants t ON t.id = tu.tenant_id
    WHERE tu.tenant_id = ${tenantId} AND tu.identity_id = ${session.identity_id}
  `;
  const tenantUser = tenantUserRows[0] as
    { id: string; tenant_status: string } | undefined;
  if (!tenantUser) return null;

  const roleRows = await tx`
    SELECT r.role_code
    FROM awcms_access_assignments aa
    JOIN awcms_roles r ON r.id = aa.role_id
    WHERE aa.tenant_id = ${tenantId} AND aa.tenant_user_id = ${tenantUser.id} AND r.deleted_at IS NULL
  `;
  const roles = roleRows.map((row: { role_code: string }) => row.role_code);

  return {
    context: {
      tenantId,
      tenantUserId: tenantUser.id,
      identityId: session.identity_id,
      roles
    },
    tenantStatus: tenantUser.tenant_status
  };
}

/**
 * Whether `moduleKey` is available for `tenantId`. No row means "never
 * toggled" — available by default, the same convention the tenant module
 * lifecycle service itself uses (`tenant-module-lifecycle.ts`).
 */
export async function resolveModuleEnabled(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT enabled FROM awcms_tenant_modules
    WHERE tenant_id = ${tenantId} AND module_key = ${moduleKey}
  `) as { enabled: boolean }[];

  return rows[0]?.enabled ?? true;
}

/**
 * Every permission key the subject holds, from BOTH grant shapes.
 *
 * ## Two branches, one answer (ADR-0078, Gelombang 3 PR 3.1 of #423)
 *
 * The first branch is the original `awcms_access_assignments` grant: a role held
 * anywhere in the tenant. The second is an `awcms_access_policies` row: the same
 * role, carrying the scope it is confined to. `UNION ALL` under a `DISTINCT`
 * means a subject who holds a role through both shapes contributes each key
 * once, so the migration from one table to the other can proceed row by row
 * without a window in which somebody loses access or gains it twice.
 *
 * **With `awcms_access_policies` empty the second branch contributes nothing and
 * the result is byte-identical to what this function returned before.** That is
 * the property PR 3.1 rests on, and `tests/integration/access-policy-equivalence`
 * is what checks it against a real database rather than by reading.
 *
 * ## Why the return type has NOT changed yet
 *
 * The program plan has this returning `{ keys, scopes }`, because scope-qualified
 * evaluation (PR 3.4) needs the map. It stays a `Set<string>` here: shipping a
 * `scopes` field that nothing reads is the same unused-capability smell this
 * repo removed from `awcms_sync_outbox` in ADR-0077, and it would churn eleven
 * call sites in the PR least able to afford unrelated diff. The type changes in
 * the PR that consumes it.
 *
 * The NAME must not change. `scripts/access-chokepoint-check.ts:149` keys its
 * "this handler decides permissions" signal on the literal
 * `fetchGrantedPermissionKeys(`, so a rename leaves that gate green while it
 * reports zero deciding handlers — which is why the gate also asserts the count
 * is non-zero.
 *
 * ## What each branch filters on, and why the two differ
 *
 * Both drop soft-deleted roles (`r.deleted_at IS NULL`). Only the policy branch
 * filters `status`/`effective_*`: an assignment row has no lifecycle to filter —
 * it exists or it does not — while a policy can be scheduled, expired, or
 * revoked. `effective_to IS NULL OR effective_to > now()` is evaluated in the
 * DATABASE rather than against a caller-supplied clock, because a grant that
 * expires according to the application's idea of the time is a grant an
 * application bug can extend.
 */
export async function fetchGrantedPermissionKeys(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<Set<string>> {
  const rows = await tx`
    SELECT DISTINCT p.module_key, p.activity_code, p.action
    FROM (
      SELECT aa.role_id
      FROM awcms_access_assignments aa
      WHERE aa.tenant_id = ${tenantId} AND aa.tenant_user_id = ${tenantUserId}
      UNION ALL
      SELECT ap.role_id
      FROM awcms_access_policies ap
      WHERE ap.tenant_id = ${tenantId}
        AND ap.tenant_user_id = ${tenantUserId}
        AND ap.status = 'active'
        AND ap.effective_from <= now()
        AND (ap.effective_to IS NULL OR ap.effective_to > now())
    ) grants
    JOIN awcms_role_permissions rp ON rp.role_id = grants.role_id AND rp.tenant_id = ${tenantId}
    JOIN awcms_permissions p ON p.id = rp.permission_id
    JOIN awcms_roles r ON r.id = grants.role_id AND r.tenant_id = ${tenantId}
    WHERE r.deleted_at IS NULL
  `;

  return new Set(
    rows.map(
      (row: { module_key: string; activity_code: string; action: string }) =>
        `${row.module_key}.${row.activity_code}.${row.action}`
    )
  );
}
