/**
 * Module admin navigation registry service. Reads navigation entries
 * directly from the live code registry (`listModules()`) — never
 * `awcms_module_navigation` — same reasoning as
 * `tenant-module-lifecycle.ts`'s dependency graph: that table only reflects
 * whatever `bun run modules:sync` last wrote, and a sidebar rendered on every
 * admin request must never depend on someone having remembered to run a sync
 * first. This also keeps the per-request cost to exactly one lightweight
 * query (the tenant's disabled-module keys).
 */
import { listModules } from "../..";
import {
  filterVisibleNavigationEntries,
  type NavigationCandidate
} from "../domain/navigation-registry";

function collectNavigationCandidates(): NavigationCandidate[] {
  return listModules().flatMap((descriptor) =>
    (descriptor.navigation ?? []).map((entry) => ({
      moduleKey: descriptor.key,
      moduleStatus: descriptor.status,
      labelKey: entry.labelKey,
      path: entry.path,
      icon: entry.icon,
      order: entry.order ?? 0,
      group: entry.group,
      requiredPermission: entry.requiredPermission
    }))
  );
}

async function fetchTenantDisabledModuleKeys(
  tx: Bun.SQL,
  tenantId: string
): Promise<Set<string>> {
  const rows = (await tx`
    SELECT module_key FROM awcms_tenant_modules
    WHERE tenant_id = ${tenantId} AND enabled = false
  `) as { module_key: string }[];

  return new Set(rows.map((row) => row.module_key));
}

/**
 * Every module-declared nav entry currently visible to this caller —
 * filtered by module status, tenant module enablement, and the entry's own
 * `requiredPermission` (see `domain/navigation-registry.ts` for the exact
 * rules). Callers append this to whatever fallback nav items they already
 * render unconditionally — a failure here must never hide those.
 */
export async function fetchVisibleModuleNavigationEntries(
  tx: Bun.SQL,
  tenantId: string,
  grantedPermissionKeys: ReadonlySet<string>
): Promise<NavigationCandidate[]> {
  const tenantDisabledModuleKeys = await fetchTenantDisabledModuleKeys(
    tx,
    tenantId
  );

  return filterVisibleNavigationEntries(collectNavigationCandidates(), {
    grantedPermissionKeys,
    tenantDisabledModuleKeys
  });
}
