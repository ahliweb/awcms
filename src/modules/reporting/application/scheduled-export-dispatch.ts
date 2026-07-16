/**
 * Scheduled export dispatch (Issue #753) — the body of `bun run
 * reporting:exports:dispatch`. For every `active` tenant, finds every
 * ENABLED scheduled export config whose interval has elapsed since its
 * last export run (`scheduled-export-store.ts`'s `listDueScheduledExports`)
 * and generates a fresh export for it, reusing the EXACT SAME
 * `generateProjectionExport` a manual `POST .../export` API call uses —
 * no separate/divergent scheduled-only code path.
 */
import { withTenant } from "../../../lib/database/tenant-context";
import { fetchActiveTenants } from "../../../lib/jobs/batching";
import { generateProjectionExport } from "./export-generation";
import { findProjectionDescriptor } from "./projection-directory";
import { listDueScheduledExports } from "./scheduled-export-store";

export type ScheduledExportDispatchResult = {
  tenantsChecked: number;
  exportsAttempted: number;
  exportsFailed: number;
};

export async function dispatchDueScheduledExports(
  sql: Bun.SQL,
  now: Date = new Date()
): Promise<ScheduledExportDispatchResult> {
  const tenants = await fetchActiveTenants(sql);
  let exportsAttempted = 0;
  let exportsFailed = 0;

  for (const tenant of tenants) {
    const due = await withTenant(
      sql,
      tenant.id,
      (tx) => listDueScheduledExports(tx, tenant.id, now),
      { workClass: "maintenance" }
    );

    for (const config of due) {
      const descriptor = findProjectionDescriptor(config.projectionKey);
      if (!descriptor) {
        // A descriptor was removed/renamed since this schedule was
        // created — skip rather than throw, so one stale config never
        // blocks every other tenant's/config's export in the same run.
        continue;
      }

      exportsAttempted += 1;
      const result = await generateProjectionExport(sql, {
        tenantId: tenant.id,
        descriptor,
        format: config.format,
        scheduledExportId: config.id,
        requestedBy: null
      });
      if (result.status === "failed") {
        exportsFailed += 1;
      }
    }
  }

  return { tenantsChecked: tenants.length, exportsAttempted, exportsFailed };
}
