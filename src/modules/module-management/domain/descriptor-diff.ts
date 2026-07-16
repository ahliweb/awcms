/**
 * Pure diff/orphan-detection logic for the descriptor sync service. No I/O
 * here — the application layer (`application/descriptor-sync.ts`) reads
 * `listModules()` and the current `awcms_modules` rows, then hands both to
 * `planModuleSync` to decide what to write, keeping the actual decision
 * testable without a database.
 */
import type { ModuleDescriptor } from "../../_shared/module-contract";

export type ExistingModuleRow = {
  moduleKey: string;
  moduleName: string;
  version: string;
  description: string | null;
  lifecycleStatus: string;
  moduleType: string | null;
  isCore: boolean;
};

export type ModuleSyncAction = "create" | "update" | "unchanged";

export type ModuleSyncPlanEntry = {
  moduleKey: string;
  action: ModuleSyncAction;
  changedFields: string[];
};

export type ModuleSyncPlan = {
  entries: ModuleSyncPlanEntry[];
  /** Present in `awcms_modules` but no longer in `listModules()` — reported so the sync service can mark them (never delete), and so operators/tests can see drift explicitly. */
  orphanedModuleKeys: string[];
};

function diffFields(
  descriptor: ModuleDescriptor,
  existing: ExistingModuleRow
): string[] {
  const changed: string[] = [];

  if (descriptor.name !== existing.moduleName) {
    changed.push("name");
  }
  if (descriptor.version !== existing.version) {
    changed.push("version");
  }
  if ((descriptor.description ?? null) !== (existing.description ?? null)) {
    changed.push("description");
  }
  if (descriptor.status !== existing.lifecycleStatus) {
    changed.push("status");
  }
  if ((descriptor.type ?? null) !== (existing.moduleType ?? null)) {
    changed.push("type");
  }
  if ((descriptor.isCore ?? false) !== existing.isCore) {
    changed.push("isCore");
  }

  return changed;
}

export function planModuleSync(
  descriptors: readonly ModuleDescriptor[],
  existingRows: readonly ExistingModuleRow[]
): ModuleSyncPlan {
  const existingByKey = new Map(
    existingRows.map((row) => [row.moduleKey, row] as const)
  );
  const descriptorKeys = new Set(descriptors.map((d) => d.key));

  const entries: ModuleSyncPlanEntry[] = descriptors.map((descriptor) => {
    const existing = existingByKey.get(descriptor.key);

    if (!existing) {
      return { moduleKey: descriptor.key, action: "create", changedFields: [] };
    }

    const changedFields = diffFields(descriptor, existing);

    return {
      moduleKey: descriptor.key,
      action: changedFields.length > 0 ? "update" : "unchanged",
      changedFields
    };
  });

  const orphanedModuleKeys = existingRows
    .map((row) => row.moduleKey)
    .filter((moduleKey) => !descriptorKeys.has(moduleKey));

  return { entries, orphanedModuleKeys };
}
