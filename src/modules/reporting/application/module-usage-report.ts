import { listModules } from "../../index";

export type ModuleUsageEntry = {
  moduleKey: string;
  moduleName: string;
  metricLabel: string;
  recordCount: number;
};

/**
 * Module usage summary (Issue 9.1, `GET /reports/module-usage`). Reports one
 * simple "has data" row-count signal per module registered in
 * `src/modules/index.ts` — deliberately generic, no domain-specific metrics
 * (derived applications add those in their own modules).
 *
 * `awcms_permissions` (the `reporting` module's own metric) is a
 * global, non-tenant-scoped catalog table (migration 005) — its count is
 * the same across every tenant, unlike the other four rows.
 */
export async function fetchModuleUsageReport(
  tx: Bun.SQL,
  tenantId: string
): Promise<ModuleUsageEntry[]> {
  const entries: ModuleUsageEntry[] = [];

  for (const module of listModules()) {
    switch (module.key) {
      case "tenant_admin": {
        const rows = await tx`
          SELECT COUNT(*) AS record_count
          FROM awcms_offices
          WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        `;
        entries.push({
          moduleKey: module.key,
          moduleName: module.name,
          metricLabel: "Offices",
          recordCount: Number(rows[0]?.record_count ?? 0)
        });
        break;
      }
      case "profile_identity": {
        const rows = await tx`
          SELECT COUNT(*) AS record_count
          FROM awcms_profiles
          WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        `;
        entries.push({
          moduleKey: module.key,
          moduleName: module.name,
          metricLabel: "Profiles",
          recordCount: Number(rows[0]?.record_count ?? 0)
        });
        break;
      }
      case "identity_access": {
        const rows = await tx`
          SELECT COUNT(*) AS record_count
          FROM awcms_identities
          WHERE tenant_id = ${tenantId}
        `;
        entries.push({
          moduleKey: module.key,
          moduleName: module.name,
          metricLabel: "Identities",
          recordCount: Number(rows[0]?.record_count ?? 0)
        });
        break;
      }
      case "sync_storage": {
        const rows = await tx`
          SELECT COUNT(*) AS record_count
          FROM awcms_sync_nodes
          WHERE tenant_id = ${tenantId}
        `;
        entries.push({
          moduleKey: module.key,
          moduleName: module.name,
          metricLabel: "Sync nodes",
          recordCount: Number(rows[0]?.record_count ?? 0)
        });
        break;
      }
      case "reporting": {
        const rows = await tx`
          SELECT COUNT(*) AS record_count
          FROM awcms_permissions
        `;
        entries.push({
          moduleKey: module.key,
          moduleName: module.name,
          metricLabel: "Permissions in catalog (global, not tenant-scoped)",
          recordCount: Number(rows[0]?.record_count ?? 0)
        });
        break;
      }
      default: {
        entries.push({
          moduleKey: module.key,
          moduleName: module.name,
          metricLabel: "No metric defined yet",
          recordCount: 0
        });
      }
    }
  }

  return entries;
}
