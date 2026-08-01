import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  selectBackfillablePermissions,
  type CatalogPermissionRecord
} from "../domain/owner-permission-backfill";

/**
 * Grants a tenant's `owner` role the permissions that were added to the global
 * catalog AFTER that tenant was created (see the domain module for why "after"
 * is the rule and not "everything missing").
 *
 * Dry-run by DEFAULT. A tool whose accident is "silently widened authorization
 * across every tenant" does not get to write unless it was told to, in the same
 * shape `idn-regions:import` already uses.
 */

export type TenantBackfillOutcome = {
  tenantId: string;
  tenantCode: string;
  /** Absent `owner` role — nothing to backfill, and a fact worth surfacing. */
  ownerRoleMissing?: boolean;
  granted: string[];
  skippedAsDeliberate: string[];
};

export type OwnerPermissionBackfillResult = {
  committed: boolean;
  tenants: TenantBackfillOutcome[];
  totalGranted: number;
};

type TenantRow = { id: string; tenant_code: string };

export async function runOwnerPermissionBackfill(
  sql: Bun.SQL,
  options: { commit: boolean; now: Date; tenantCode?: string }
): Promise<OwnerPermissionBackfillResult> {
  // `awcms_tenants` is a root table without RLS, so this listing runs outside a
  // tenant context — the same pattern every per-tenant worker here uses.
  const tenantRows = (
    options.tenantCode
      ? await sql`
          SELECT id, tenant_code FROM awcms_tenants
          WHERE status = 'active' AND tenant_code = ${options.tenantCode}
          ORDER BY created_at
        `
      : await sql`
          SELECT id, tenant_code FROM awcms_tenants
          WHERE status = 'active'
          ORDER BY created_at
        `
  ) as TenantRow[];

  const tenants: TenantBackfillOutcome[] = [];
  let totalGranted = 0;

  for (const tenant of tenantRows) {
    const outcome = await withTenantOrThrow(sql, tenant.id, async (tx) => {
      const roleRows = (await tx`
        SELECT id, created_at FROM awcms_roles
        WHERE tenant_id = ${tenant.id} AND role_code = 'owner'
          AND is_system = true AND deleted_at IS NULL
      `) as { id: string; created_at: Date }[];

      const ownerRole = roleRows[0];

      if (!ownerRole) {
        return {
          tenantId: tenant.id,
          tenantCode: tenant.tenant_code,
          ownerRoleMissing: true,
          granted: [],
          skippedAsDeliberate: []
        } satisfies TenantBackfillOutcome;
      }

      // The catalog is GLOBAL (no tenant_id, no RLS) — the same table every
      // tenant's roles point at.
      const catalogRows = (await tx`
        SELECT id, module_key, activity_code, action, created_at
        FROM awcms_permissions
        ORDER BY created_at, module_key, activity_code, action
      `) as {
        id: string;
        module_key: string;
        activity_code: string;
        action: string;
        created_at: Date;
      }[];

      const catalog: CatalogPermissionRecord[] = catalogRows.map((row) => ({
        id: row.id,
        key: `${row.module_key}.${row.activity_code}.${row.action}`,
        createdAt: new Date(row.created_at)
      }));

      const grantedRows = (await tx`
        SELECT permission_id FROM awcms_role_permissions
        WHERE tenant_id = ${tenant.id} AND role_id = ${ownerRole.id}
      `) as { permission_id: string }[];

      const selection = selectBackfillablePermissions(
        { roleId: ownerRole.id, createdAt: new Date(ownerRole.created_at) },
        catalog,
        new Set(grantedRows.map((row) => row.permission_id))
      );

      if (options.commit && selection.grant.length > 0) {
        for (const permission of selection.grant) {
          // One statement per permission rather than a bulk `unnest`: the set
          // is tiny (one release's worth), and `ON CONFLICT DO NOTHING` keeps a
          // concurrent second run from failing the whole tenant.
          await tx`
            INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
            VALUES (${tenant.id}, ${ownerRole.id}, ${permission.id})
            ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING
          `;
        }

        await recordAuditEvent(tx, {
          tenantId: tenant.id,
          moduleKey: "identity_access",
          action: "owner_role.permissions_backfilled",
          resourceType: "role",
          resourceId: ownerRole.id,
          severity: "warning",
          message: `Owner role gained ${selection.grant.length} catalog permission(s) added after the tenant was created.`,
          attributes: {
            grantedPermissionKeys: selection.grant.map((p) => p.key),
            skippedAsDeliberate: selection.skippedAsDeliberate.map((p) => p.key)
          }
        });
      }

      return {
        tenantId: tenant.id,
        tenantCode: tenant.tenant_code,
        granted: selection.grant.map((p) => p.key),
        skippedAsDeliberate: selection.skippedAsDeliberate.map((p) => p.key)
      } satisfies TenantBackfillOutcome;
    });

    tenants.push(outcome);
    totalGranted += outcome.granted.length;
  }

  return { committed: options.commit, tenants, totalGranted };
}
