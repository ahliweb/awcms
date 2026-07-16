/**
 * Module catalog read service. The trusted code registry (`listModules()`)
 * is the source of truth for a module's static metadata
 * (name/version/description/dependencies/api/events/type) — it is always
 * current, never stale, unlike the DB registry which only reflects whatever
 * `bun run modules:sync` last wrote. This merges the two: static fields come
 * from the descriptor, `lifecycleStatus`/`isCore`/`lastSyncedAt` come from
 * `awcms_modules` when a row exists (falling back to the descriptor's own
 * `status`/`isCore` if sync hasn't run yet).
 *
 * A module absent from `listModules()` is never returned here, even if a
 * stale DB row exists for it (the descriptor sync already marks that case
 * `lifecycle_status = 'disabled'` — surfacing orphaned rows to an operator
 * is the permission-sync/health concern, not this basic catalog).
 */
import { listModules } from "../..";
import type {
  ModuleApiContract,
  ModuleEventContract,
  ModuleType
} from "../../_shared/module-contract";

export type ModuleCatalogEntry = {
  moduleKey: string;
  name: string;
  version: string;
  description: string;
  status: string;
  type: ModuleType | null;
  isCore: boolean;
  dependencies: string[];
  api?: ModuleApiContract;
  events?: ModuleEventContract;
  lastSyncedAt: string | null;
};

type ModuleRegistryRow = {
  module_key: string;
  lifecycle_status: string;
  is_core: boolean;
  updated_at: Date;
};

async function fetchRegistryRows(
  tx: Bun.SQL
): Promise<Map<string, ModuleRegistryRow>> {
  const rows = (await tx`
    SELECT module_key, lifecycle_status, is_core, updated_at
    FROM awcms_modules
  `) as ModuleRegistryRow[];

  return new Map(rows.map((row) => [row.module_key, row]));
}

export async function fetchModuleCatalog(
  tx: Bun.SQL
): Promise<ModuleCatalogEntry[]> {
  const registryByKey = await fetchRegistryRows(tx);

  return listModules().map((descriptor) => {
    const registryRow = registryByKey.get(descriptor.key);

    return {
      moduleKey: descriptor.key,
      name: descriptor.name,
      version: descriptor.version,
      description: descriptor.description,
      status: registryRow?.lifecycle_status ?? descriptor.status,
      type: descriptor.type ?? null,
      isCore: registryRow?.is_core ?? descriptor.isCore ?? false,
      dependencies: descriptor.dependencies,
      api: descriptor.api,
      events: descriptor.events,
      lastSyncedAt: registryRow?.updated_at.toISOString() ?? null
    };
  });
}

export async function fetchModuleCatalogEntry(
  tx: Bun.SQL,
  moduleKey: string
): Promise<ModuleCatalogEntry | null> {
  const catalog = await fetchModuleCatalog(tx);

  return catalog.find((entry) => entry.moduleKey === moduleKey) ?? null;
}
