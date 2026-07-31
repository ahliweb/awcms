import type { TenantContext } from "../domain/access-control";
import { resolveActiveSession } from "./session-lookup";

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
  const rows = (await tx`
    SELECT tu.id, tu.identity_id
    FROM awcms_tenant_users tu
    JOIN awcms_identities i
      ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
    WHERE tu.tenant_id = ${tenantId} AND tu.id = ${tenantUserId}
      AND tu.status = 'active' AND i.status = 'active'
  `) as { id: string; identity_id: string }[];

  const tenantUser = rows[0];
  if (!tenantUser) return null;

  const roleRows = (await tx`
    SELECT r.role_code
    FROM awcms_access_assignments aa
    JOIN awcms_roles r ON r.id = aa.role_id
    WHERE aa.tenant_id = ${tenantId} AND aa.tenant_user_id = ${tenantUser.id} AND r.deleted_at IS NULL
  `) as { role_code: string }[];

  return {
    tenantId,
    tenantUserId: tenantUser.id,
    identityId: tenantUser.identity_id,
    roles: roleRows.map((row) => row.role_code)
  };
}

export async function resolveTenantContext(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<TenantContext | null> {
  const session = await resolveActiveSession(tx, tenantId, tokenHash, now);
  if (!session) return null;

  const tenantUserRows = await tx`
    SELECT id FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND identity_id = ${session.identity_id}
  `;
  const tenantUser = tenantUserRows[0] as { id: string } | undefined;
  if (!tenantUser) return null;

  const roleRows = await tx`
    SELECT r.role_code
    FROM awcms_access_assignments aa
    JOIN awcms_roles r ON r.id = aa.role_id
    WHERE aa.tenant_id = ${tenantId} AND aa.tenant_user_id = ${tenantUser.id} AND r.deleted_at IS NULL
  `;
  const roles = roleRows.map((row: { role_code: string }) => row.role_code);

  return {
    tenantId,
    tenantUserId: tenantUser.id,
    identityId: session.identity_id,
    roles
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

export async function fetchGrantedPermissionKeys(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<Set<string>> {
  const rows = await tx`
    SELECT DISTINCT p.module_key, p.activity_code, p.action
    FROM awcms_access_assignments aa
    JOIN awcms_role_permissions rp ON rp.role_id = aa.role_id AND rp.tenant_id = aa.tenant_id
    JOIN awcms_permissions p ON p.id = rp.permission_id
    JOIN awcms_roles r ON r.id = aa.role_id
    WHERE aa.tenant_id = ${tenantId} AND aa.tenant_user_id = ${tenantUserId} AND r.deleted_at IS NULL
  `;

  return new Set(
    rows.map(
      (row: { module_key: string; activity_code: string; action: string }) =>
        `${row.module_key}.${row.activity_code}.${row.action}`
    )
  );
}
