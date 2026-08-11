import type { TenantContext } from "../domain/access-control";
import { ENTITLING_SUBSCRIPTION_STATUSES } from "../domain/entitlement";
import { activeRoleGrants } from "./grant-source";
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
 * (ADR-0049). Roles come from the same `activeRoleGrants` fragment the session
 * path uses, so a machine principal is subject to exactly the same RBAC
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
    SELECT DISTINCT r.role_code
    FROM (${activeRoleGrants(tx, tenantId)}) g
    JOIN awcms_roles r ON r.id = g.role_id AND r.tenant_id = ${tenantId}
    WHERE g.tenant_user_id = ${tenantUser.id} AND r.deleted_at IS NULL
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
    SELECT DISTINCT r.role_code
    FROM (${activeRoleGrants(tx, tenantId)}) g
    JOIN awcms_roles r ON r.id = g.role_id AND r.tenant_id = ${tenantId}
    WHERE g.tenant_user_id = ${tenantUser.id} AND r.deleted_at IS NULL
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
 *
 * Retained alongside `resolveModuleAvailability` below rather than folded into
 * it: three routes call this directly before assembling an ADR-0063 ownership
 * grant (`blog/posts/[id].ts` and two siblings), and those calls are asking a
 * genuinely narrower question. Changing their signature would put an
 * entitlement argument in three files that have no business resolving one — the
 * chokepoint they hand the ownership grant to already does.
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

/** What the chokepoint learned about a module in ONE round trip (ADR-0084). */
export type ModuleAvailability = {
  enabled: boolean;
  /**
   * Whether the tenant holds `requiredEntitlementKey`. Always `true` when no
   * key was asked for — "nothing was required, so nothing is missing". The
   * DECISION about what that means is not taken here; it belongs to
   * `evaluateEntitlementRequirement`, which is the only function allowed to
   * turn these facts into a refusal.
   */
  entitlementHeld: boolean;
};

/**
 * `resolveModuleEnabled` plus the entitlement question, in a single query
 * (ADR-0084, Gelombang 5 PR 5.1 of #423).
 *
 * ## The null path is the old query, unchanged
 *
 * When `requiredEntitlementKey` is `null` — which is every request in this base,
 * because no module declares `requiresEntitlement` — this issues literally the
 * statement `resolveModuleEnabled` issues and returns `entitlementHeld: true`.
 * Not "an equivalent statement": the same one, so the wave's inertness is a
 * property of the code rather than a claim about it, and
 * `tests/entitlement-guard-chain.test.ts` asserts the emitted SQL is identical.
 *
 * ## Why a LEFT JOIN and not a second await
 *
 * The chokepoint runs on every guarded request. A second round trip for a
 * question whose answer is "nothing was required" 100% of the time would be a
 * permanent cost bought for a feature nobody enabled. The entitlement half is
 * folded into the `awcms_tenant_modules` read that already happens, so a
 * deployment that DOES sell something pays one query for both answers and a
 * deployment that does not pays nothing at all.
 *
 * ## The union, and why it is resolved live
 *
 * A tenant holds an entitlement when EITHER a direct grant in
 * `awcms_tenant_entitlements` is live (no expiry, or an expiry in the future),
 * OR its EFFECTIVE plan contains the key. Both halves are read at request time;
 * nothing is materialized. A cached effective set would mean a downgrade takes
 * effect on the next refresh, and the gap between those two moments is exactly
 * when someone still reaches what they stopped paying for.
 *
 * ## No subscription row means the DEFAULT plan (ADR-0084, PR 5.4)
 *
 * The same convention `awcms_tenant_modules` has used since `sql/008`: a missing
 * row is not a decision, it is the absence of one, and the absence must read as
 * the baseline the operator declared rather than as a refusal. An installation
 * that never touches subscriptions therefore behaves exactly as it did before
 * entitlements existed — which is the only acceptable default for a template.
 *
 * It also removed a defect the ownership gate caught: provisioning used to
 * INSERT a subscription at tenant birth, making `awcms_tenant_subscriptions`
 * a table written by BOTH `tenant_admin` and `identity_access` — an ADR-0013 §6
 * shared-table write. Deriving the default instead of writing it leaves exactly
 * one writer (the ladder job) and needs no cross-tenant backfill at all.
 *
 * The fallback is deliberately NOT applied when a subscription row EXISTS but is
 * not in an entitling status. That case is a suspension, and falling back to the
 * default plan there would quietly undo it — the `CASE ... THEN NULL` is what
 * distinguishes "never subscribed" from "subscribed and lapsed".
 *
 * `now` is the request timestamp already threaded through the guard, not
 * `now()`: a CHECK or a comparison that mixes the application clock with the
 * transaction clock is the trap `postgres now() = transaction start` records,
 * and expiry that lands on a transaction boundary would read differently to the
 * two halves of the same decision.
 */
export async function resolveModuleAvailability(
  tx: Bun.SQL,
  tenantId: string,
  moduleKey: string,
  requiredEntitlementKey: string | null,
  now: Date
): Promise<ModuleAvailability> {
  if (requiredEntitlementKey === null) {
    return {
      enabled: await resolveModuleEnabled(tx, tenantId, moduleKey),
      entitlementHeld: true
    };
  }

  const rows = (await tx`
    SELECT
      COALESCE(tm.enabled, true) AS enabled,
      (
        EXISTS (
          SELECT 1 FROM awcms_tenant_entitlements te
          WHERE te.tenant_id = ${tenantId}
            AND te.entitlement_key = ${requiredEntitlementKey}
            AND (te.expires_at IS NULL OR te.expires_at > ${now})
        )
        OR EXISTS (
          SELECT 1 FROM awcms_plan_entitlements pe
          WHERE pe.entitlement_key = ${requiredEntitlementKey}
            AND pe.plan_code = COALESCE(
              (SELECT ts.plan_code FROM awcms_tenant_subscriptions ts
                WHERE ts.tenant_id = ${tenantId}
                  AND ts.status = ANY(${tx.array(
                    [...ENTITLING_SUBSCRIPTION_STATUSES],
                    "text"
                  )})),
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM awcms_tenant_subscriptions existing
                  WHERE existing.tenant_id = ${tenantId}
                ) THEN NULL
                ELSE (SELECT p.plan_code FROM awcms_plans p WHERE p.is_default)
              END
            )
        )
      ) AS entitlement_held
    FROM (SELECT 1) AS anchor
    LEFT JOIN awcms_tenant_modules tm
      ON tm.tenant_id = ${tenantId} AND tm.module_key = ${moduleKey}
  `) as { enabled: boolean; entitlement_held: boolean }[];

  // A missing row is impossible here — the anchor guarantees exactly one — but
  // the fallback states which way it would fail if that ever stopped being
  // true: available and UNENTITLED, so the structural gate refuses rather than
  // waving a request through on a query that returned nothing.
  return {
    enabled: rows[0]?.enabled ?? true,
    entitlementHeld: rows[0]?.entitlement_held ?? false
  };
}

/**
 * Every permission key the subject holds.
 *
 * ## One grant source (ADR-0079, Gelombang 3 PR 3.3 of #423)
 *
 * The `UNION ALL` over two tables that ADR-0078 introduced is gone: `sql/103`
 * copied every `awcms_access_assignments` row into `awcms_access_policies`
 * keeping its `id`, then revoked write privileges on the old table, so a live
 * grant now has exactly one home. The union had to go in the SAME change,
 * because the legacy rows are RETAINED as history — reading them after
 * revocation would mean an admin could no longer take a role away (the DELETE
 * that used to remove them is no longer permitted, and the row would keep
 * granting forever).
 *
 * The join itself lives in `grant-source.ts` and is shared with every other
 * reader, which is the actual fix ADR-0079 records: five readers had drifted
 * onto the abandoned table and each one was wrong in a different, silent way.
 *
 * ## Why the return type has NOT changed yet
 *
 * The program plan has this returning `{ keys, scopes }`, because scope-qualified
 * evaluation (PR 3.4) needs the map. It stays a `Set<string>` here: shipping a
 * `scopes` field that nothing reads is the same unused-capability smell this
 * repo removed from `awcms_sync_outbox` in ADR-0077. The type changes in the PR
 * that consumes it.
 *
 * The NAME must not change. `scripts/access-chokepoint-check.ts:149` keys its
 * "this handler decides permissions" signal on the literal
 * `fetchGrantedPermissionKeys(`, so a rename leaves that gate green while it
 * reports zero deciding handlers — which is why the gate also asserts the count
 * is non-zero.
 *
 * ## What is filtered where
 *
 * Lifecycle (`status`, effective dating) is filtered by the shared fragment, at
 * the database's transaction clock. Soft-deleted roles are dropped here, because
 * `r.deleted_at` belongs to the role rather than to the grant — a deleted role is
 * exactly what an admin deletes in order to take access away, and it must stop
 * granting even while the grant row survives.
 */
export async function fetchGrantedPermissionKeys(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<Set<string>> {
  const rows = await tx`
    SELECT DISTINCT p.module_key, p.activity_code, p.action
    FROM (${activeRoleGrants(tx, tenantId)}) grants
    JOIN awcms_role_permissions rp ON rp.role_id = grants.role_id AND rp.tenant_id = ${tenantId}
    JOIN awcms_permissions p ON p.id = rp.permission_id
    JOIN awcms_roles r ON r.id = grants.role_id AND r.tenant_id = ${tenantId}
    WHERE grants.tenant_user_id = ${tenantUserId} AND r.deleted_at IS NULL
  `;

  return new Set(
    rows.map(
      (row: { module_key: string; activity_code: string; action: string }) =>
        `${row.module_key}.${row.activity_code}.${row.action}`
    )
  );
}
