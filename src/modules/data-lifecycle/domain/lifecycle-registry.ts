/**
 * High-volume table registry validation gate (ported from awcms-micro Issue
 * #745, ADR-0037). Pure code-registry validation — no I/O, no database, no
 * network — same shape as
 * `module-management/domain/module-dependency-graph.ts`'s
 * `validateModuleDependencyGraph`, which `scripts/validate-module-graph.ts`
 * (`bun run modules:dag:check`) already wires into `bun run check`. This file's
 * `validateLifecycleRegistry` is wired the same way by
 * `scripts/data-lifecycle-registry-check.ts` (`bun run
 * data-lifecycle:registry:check`).
 *
 * Every `HighVolumeTableDescriptor` is declared by its OWNING module's own
 * `module.ts` (`ModuleDescriptor.dataLifecycle`, see
 * `_shared/module-contract.ts`) — this file only AGGREGATES
 * (`collectHighVolumeTableDescriptors`) and VALIDATES what modules already
 * declared. It never invents a descriptor and never reaches into another
 * module's schema.
 */
import type {
  HighVolumeTableDescriptor,
  ModuleDescriptor
} from "../../_shared/module-contract";

const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const DESCRIPTOR_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Sane upper bound on a single batch/pass size — defense in depth against a descriptor accidentally declaring an effectively-unbounded batch ("purge must not issue unbounded deletes"). Ten times `AUDIT_EVENT_PURGE_BATCH_LIMIT` (5000, the largest existing precedent) leaves generous headroom without allowing an arbitrary value. */
export const MAX_LIFECYCLE_BATCH_LIMIT = 50_000;

export const VALID_RETENTION_CLASSES: readonly string[] = [
  "audit_security",
  "analytics_telemetry",
  "operational_queue",
  "financial_tax",
  "communication_log",
  "system_event"
];

export type LifecycleRegistryIssue = {
  descriptorKey: string;
  message: string;
};

export function formatLifecycleRegistryIssue(
  issue: LifecycleRegistryIssue
): string {
  return `[${issue.descriptorKey}] ${issue.message}`;
}

/** Flattens every registered module's own `dataLifecycle` array into one list — the aggregation half of "module-contributed registry". Order follows `modules` (i.e. `listModules()`), stable and deterministic. */
export function collectHighVolumeTableDescriptors(
  modules: readonly ModuleDescriptor[]
): HighVolumeTableDescriptor[] {
  return modules.flatMap((module) => module.dataLifecycle ?? []);
}

function validateSingleDescriptor(
  ownerModule: ModuleDescriptor,
  descriptor: HighVolumeTableDescriptor
): LifecycleRegistryIssue[] {
  const issues: LifecycleRegistryIssue[] = [];
  const push = (message: string) =>
    issues.push({ descriptorKey: descriptor.key || "(missing key)", message });

  if (!descriptor.key || !DESCRIPTOR_KEY_PATTERN.test(descriptor.key)) {
    push(
      `key must be non-empty and match "<module_key>.<table_shortname>" (got ${JSON.stringify(descriptor.key)}).`
    );
  }

  if (!descriptor.tableName || !TABLE_NAME_PATTERN.test(descriptor.tableName)) {
    push(
      `tableName must start with "awcms_" and be snake_case (got ${JSON.stringify(descriptor.tableName)}).`
    );
  }

  if (descriptor.ownerModuleKey !== ownerModule.key) {
    push(
      `ownerModuleKey (${JSON.stringify(descriptor.ownerModuleKey)}) must equal the declaring module's own key (${JSON.stringify(ownerModule.key)}) — a module must not declare a descriptor it claims another module owns.`
    );
  }

  if (descriptor.scope !== "tenant" && descriptor.scope !== "global") {
    push(
      `scope must be "tenant" or "global" (got ${JSON.stringify(descriptor.scope)}).`
    );
  }

  if (descriptor.scope === "global" && descriptor.tenantColumn) {
    push(
      `tenantColumn must not be set when scope is "global" (got ${JSON.stringify(descriptor.tenantColumn)}) — a global table has no tenant column by definition.`
    );
  }

  if (descriptor.scope === "tenant") {
    const tenantColumn = descriptor.tenantColumn ?? "tenant_id";
    if (!COLUMN_NAME_PATTERN.test(tenantColumn)) {
      push(
        `tenantColumn is not a valid column name: ${JSON.stringify(tenantColumn)}.`
      );
    }
  }

  if (
    !descriptor.cursorColumn ||
    !COLUMN_NAME_PATTERN.test(descriptor.cursorColumn)
  ) {
    push(
      `cursorColumn must be a valid column name (got ${JSON.stringify(descriptor.cursorColumn)}).`
    );
  }

  if (!VALID_RETENTION_CLASSES.includes(descriptor.retentionClass)) {
    push(
      `retentionClass ${JSON.stringify(descriptor.retentionClass)} is not one of ${VALID_RETENTION_CLASSES.join(", ")}.`
    );
  }

  const { retentionMinDays, retentionMaxDays, defaultRetentionDays } =
    descriptor;
  if (
    !Number.isFinite(retentionMinDays) ||
    !Number.isFinite(retentionMaxDays) ||
    !Number.isFinite(defaultRetentionDays) ||
    retentionMinDays <= 0 ||
    retentionMaxDays <= 0 ||
    defaultRetentionDays <= 0
  ) {
    push(
      "retentionMinDays/retentionMaxDays/defaultRetentionDays must all be positive numbers."
    );
  } else if (!(
    retentionMinDays <= defaultRetentionDays &&
    defaultRetentionDays <= retentionMaxDays
  )) {
    push(
      `retention bounds must satisfy retentionMinDays (${retentionMinDays}) <= defaultRetentionDays (${defaultRetentionDays}) <= retentionMaxDays (${retentionMaxDays}).`
    );
  }

  if (!descriptor.partition) {
    push(
      "partition policy is required (state eligible=false with a rationale if not eligible)."
    );
  } else {
    if (!descriptor.partition.rationale) {
      push(
        "partition.rationale is required whether or not the table is partition-eligible."
      );
    }
    if (descriptor.partition.eligible && !descriptor.partition.granularity) {
      push(
        "partition.granularity is required when partition.eligible is true."
      );
    }
  }

  if (!descriptor.archive) {
    push(
      "archive policy is required (state archivable=false with a rationale if not archivable)."
    );
  } else {
    if (!descriptor.archive.rationale) {
      push(
        "archive.rationale is required whether or not the table is archivable."
      );
    }
    if (descriptor.archive.archivable) {
      if (!descriptor.archive.format) {
        push("archive.format is required when archive.archivable is true.");
      }
      if (!descriptor.archive.port || descriptor.archive.port === "none") {
        push(
          'archive.port must be "local_offline" or "external_object_storage" when archive.archivable is true.'
        );
      }
    }
  }

  if (!descriptor.deletion) {
    push("deletion policy is required.");
  } else if (!descriptor.deletion.rationale) {
    push("deletion.rationale is required.");
  }

  if (!descriptor.legalHold) {
    push("legalHold policy is required.");
  } else {
    const { applicable, precedence } = descriptor.legalHold;
    if (applicable && precedence !== "overrides_retention") {
      push(
        'legalHold.precedence must be "overrides_retention" when legalHold.applicable is true — legal hold must always override ordinary retention/purge (critical requirement).'
      );
    }
    if (!applicable && precedence !== "not_applicable") {
      push(
        'legalHold.precedence must be "not_applicable" when legalHold.applicable is false.'
      );
    }
  }

  if (!descriptor.requiredIndexes || descriptor.requiredIndexes.length === 0) {
    push("requiredIndexes must declare at least one index.");
  } else if (
    descriptor.scope === "tenant" &&
    descriptor.executionMode === "generic"
  ) {
    // Only enforced for "generic" execution — that is the ONLY mode where
    // `data_lifecycle`'s own engine issues the bounded
    // `WHERE tenant = ? AND cursor < ?/> ? ORDER BY cursor LIMIT ?` scan/delete
    // queries (`application/archive-purge-job.ts`) that genuinely need this
    // composite index for query-plan safety. A "delegated" descriptor's real
    // purge query is owned by the existing adopter's own code and indexes
    // (already covered by that module's own migrations) — this registry does
    // not dictate their index shape, only that at least one index is documented
    // (the check above).
    const tenantColumn = descriptor.tenantColumn ?? "tenant_id";
    const hasTenantCursorIndex = descriptor.requiredIndexes.some(
      (index) =>
        index.columns.includes(tenantColumn) &&
        index.columns.includes(descriptor.cursorColumn)
    );
    if (!hasTenantCursorIndex) {
      push(
        `requiredIndexes must include at least one index covering both the tenant column ("${tenantColumn}") and the cursor column ("${descriptor.cursorColumn}") — this engine's generic batching/purge queries filter and order by both.`
      );
    }
  }

  if (
    !Number.isFinite(descriptor.batchLimit) ||
    descriptor.batchLimit <= 0 ||
    descriptor.batchLimit > MAX_LIFECYCLE_BATCH_LIMIT
  ) {
    push(
      `batchLimit must be a positive number no greater than ${MAX_LIFECYCLE_BATCH_LIMIT} (got ${descriptor.batchLimit}) — purge/archive must never be an unbounded operation.`
    );
  }

  if (!descriptor.backupRestoreNotes) {
    push(
      "backupRestoreNotes is required — even a table with no special backup/restore implications must say so explicitly."
    );
  }

  if (descriptor.executionMode === "delegated") {
    if (
      !descriptor.existingAdopter ||
      !descriptor.existingAdopter.purgeFunctionRef
    ) {
      push(
        'executionMode "delegated" requires existingAdopter.purgeFunctionRef documenting the mechanism this descriptor adopts rather than duplicates.'
      );
    }
  } else if (descriptor.executionMode === "generic") {
    if (descriptor.existingAdopter) {
      push(
        'executionMode "generic" must not also declare existingAdopter — a table cannot both delegate to an existing mechanism and opt into generic execution at the same time.'
      );
    }
  } else {
    push(
      `executionMode must be "delegated" or "generic" (got ${JSON.stringify(descriptor.executionMode)}).`
    );
  }

  return issues;
}

export type LifecycleRegistryValidationResult = {
  valid: boolean;
  issues: LifecycleRegistryIssue[];
  descriptors: readonly HighVolumeTableDescriptor[];
};

/**
 * Validates the WHOLE registry (every module's contributed descriptors):
 * per-descriptor structural validity (`validateSingleDescriptor`), plus
 * cross-descriptor invariants (unique `key`, unique `tableName` — a table must
 * never be registered twice, whether by the same or different modules) and
 * unique `ownerModuleKey` correctness (checked per-descriptor above via
 * `ownerModule`, resolved here by walking each module's own array so every
 * descriptor is checked against the module that actually declared it, never a
 * mismatched one).
 */
export function validateLifecycleRegistry(
  modules: readonly ModuleDescriptor[]
): LifecycleRegistryValidationResult {
  const issues: LifecycleRegistryIssue[] = [];
  const allDescriptors: HighVolumeTableDescriptor[] = [];
  const seenKeys = new Map<string, number>();
  const seenTableNames = new Map<string, number>();

  for (const module of modules) {
    for (const descriptor of module.dataLifecycle ?? []) {
      allDescriptors.push(descriptor);
      issues.push(...validateSingleDescriptor(module, descriptor));

      seenKeys.set(descriptor.key, (seenKeys.get(descriptor.key) ?? 0) + 1);
      seenTableNames.set(
        descriptor.tableName,
        (seenTableNames.get(descriptor.tableName) ?? 0) + 1
      );
    }
  }

  for (const [key, count] of seenKeys) {
    if (count > 1) {
      issues.push({
        descriptorKey: key,
        message: `key is registered ${count} times — descriptor keys must be unique across the whole registry.`
      });
    }
  }

  for (const [tableName, count] of seenTableNames) {
    if (count > 1) {
      issues.push({
        descriptorKey: tableName,
        message: `tableName "${tableName}" is registered ${count} times — a table must be declared by exactly one descriptor.`
      });
    }
  }

  return { valid: issues.length === 0, issues, descriptors: allDescriptors };
}
