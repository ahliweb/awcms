import type { TenantContext } from "../domain/access-control";
import { resolveActiveSession } from "./session-lookup";

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
