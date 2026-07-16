/**
 * Module-contributed projection registry validation gate (Issue #753, epic
 * #738 platform-evolution Wave 3). Pure code-registry validation — no I/O,
 * no database, no network — same shape as `data-lifecycle/domain/
 * lifecycle-registry.ts`'s `validateLifecycleRegistry`, which `bun run
 * data-lifecycle:registry:check` already wires into `bun run check`. This
 * file's `validateProjectionRegistry` is wired the same way by
 * `scripts/reporting-projection-registry-check.ts` (`bun run
 * reporting:projections:registry:check`).
 *
 * Every `ProjectionDescriptor` is declared by its OWNING module's own
 * `module.ts` (`ModuleDescriptor.reportingProjections`, see
 * `_shared/module-contract.ts`) — this file only AGGREGATES
 * (`collectProjectionDescriptors`) and VALIDATES what modules already
 * declared. It never invents a descriptor and never reaches into another
 * module's schema.
 */
import type {
  ModuleDescriptor,
  ProjectionCursorStream,
  ProjectionDescriptor
} from "../../_shared/module-contract";

const TABLE_NAME_PATTERN = /^awcms_[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const DESCRIPTOR_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const PERMISSION_KEY_PATTERN =
  /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Same order of magnitude as `data_lifecycle`'s `MAX_LIFECYCLE_BATCH_LIMIT` — defense in depth against a descriptor accidentally declaring an effectively-unbounded batch. */
export const MAX_PROJECTION_BATCH_LIMIT = 50_000;

export type ProjectionRegistryIssue = {
  descriptorKey: string;
  message: string;
};

export function formatProjectionRegistryIssue(
  issue: ProjectionRegistryIssue
): string {
  return `[${issue.descriptorKey}] ${issue.message}`;
}

/** Flattens every registered module's own `reportingProjections` array into one list — the aggregation half of "module-contributed registry" (issue #753 scope). Order follows `modules` (i.e. `listModules()`), stable and deterministic. */
export function collectProjectionDescriptors(
  modules: readonly ModuleDescriptor[]
): ProjectionDescriptor[] {
  return modules.flatMap((module) => module.reportingProjections ?? []);
}

function validateCursorStream(
  push: (message: string) => void,
  stream: ProjectionCursorStream,
  context: string
): void {
  if (!stream.streamKey || !COLUMN_NAME_PATTERN.test(stream.streamKey)) {
    push(
      `${context}: streamKey must be a valid identifier (got ${JSON.stringify(stream.streamKey)}).`
    );
  }
  if (!stream.tableName || !TABLE_NAME_PATTERN.test(stream.tableName)) {
    push(
      `${context}: tableName must start with "awcms_" and be snake_case (got ${JSON.stringify(stream.tableName)}).`
    );
  }
  const tenantColumn = stream.tenantColumn ?? "tenant_id";
  if (!COLUMN_NAME_PATTERN.test(tenantColumn)) {
    push(`${context}: tenantColumn is not a valid column name.`);
  }
  if (!stream.cursorColumn || !COLUMN_NAME_PATTERN.test(stream.cursorColumn)) {
    push(
      `${context}: cursorColumn must be a valid column name (got ${JSON.stringify(stream.cursorColumn)}).`
    );
  }
  if (!stream.metrics || stream.metrics.length === 0) {
    push(`${context}: metrics must declare at least one rule.`);
    return;
  }
  const seenMetricKeys = new Set<string>();
  for (const metric of stream.metrics) {
    if (!metric.metricKey || !COLUMN_NAME_PATTERN.test(metric.metricKey)) {
      push(
        `${context}: metric.metricKey must be a valid identifier (got ${JSON.stringify(metric.metricKey)}).`
      );
    }
    if (seenMetricKeys.has(metric.metricKey)) {
      push(
        `${context}: metricKey "${metric.metricKey}" is declared more than once within the same stream.`
      );
    }
    seenMetricKeys.add(metric.metricKey);
    if (metric.effect !== "increment" && metric.effect !== "decrement") {
      push(`${context}: metric "${metric.metricKey}" has an invalid effect.`);
    }
    const hasMatchColumn = metric.matchColumn !== undefined;
    const hasMatchValue = metric.matchValue !== undefined;
    if (hasMatchColumn !== hasMatchValue) {
      push(
        `${context}: metric "${metric.metricKey}" must declare BOTH matchColumn and matchValue, or neither.`
      );
    }
    if (hasMatchColumn && !COLUMN_NAME_PATTERN.test(metric.matchColumn!)) {
      push(
        `${context}: metric "${metric.metricKey}" matchColumn is not a valid column name.`
      );
    }
  }
}

function validateSingleDescriptor(
  ownerModule: ModuleDescriptor,
  descriptor: ProjectionDescriptor
): ProjectionRegistryIssue[] {
  const issues: ProjectionRegistryIssue[] = [];
  const push = (message: string) =>
    issues.push({ descriptorKey: descriptor.key || "(missing key)", message });

  if (!descriptor.key || !DESCRIPTOR_KEY_PATTERN.test(descriptor.key)) {
    push(
      `key must be non-empty and match "<module_key>.<name>" (got ${JSON.stringify(descriptor.key)}).`
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

  if (!Number.isInteger(descriptor.version) || descriptor.version < 1) {
    push(
      `version must be a positive integer (got ${JSON.stringify(descriptor.version)}).`
    );
  }

  if (
    !descriptor.requiredPermission ||
    !PERMISSION_KEY_PATTERN.test(descriptor.requiredPermission)
  ) {
    push(
      `requiredPermission must be a "module.activity.action" permission key (got ${JSON.stringify(descriptor.requiredPermission)}).`
    );
  }

  if (!descriptor.freshness) {
    push("freshness policy is required.");
  } else {
    const { targetSeconds, staleAfterSeconds, errorAfterConsecutiveFailures } =
      descriptor.freshness;
    if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
      push("freshness.targetSeconds must be a positive number.");
    }
    if (
      !Number.isFinite(staleAfterSeconds) ||
      staleAfterSeconds < targetSeconds
    ) {
      push(
        "freshness.staleAfterSeconds must be a number >= freshness.targetSeconds."
      );
    }
    if (
      !Number.isInteger(errorAfterConsecutiveFailures) ||
      errorAfterConsecutiveFailures < 1
    ) {
      push(
        "freshness.errorAfterConsecutiveFailures must be a positive integer."
      );
    }
  }

  if (
    !Number.isFinite(descriptor.batchLimit) ||
    descriptor.batchLimit <= 0 ||
    descriptor.batchLimit > MAX_PROJECTION_BATCH_LIMIT
  ) {
    push(
      `batchLimit must be a positive number no greater than ${MAX_PROJECTION_BATCH_LIMIT} (got ${descriptor.batchLimit}).`
    );
  }

  if (!descriptor.retentionClass) {
    push(
      "retentionClass is required (documentation reference, may be free text)."
    );
  }

  if (!descriptor.source) {
    push("source contract is required.");
  } else if (descriptor.source.strategy === "cursor_table") {
    if (descriptor.source.streams.length === 0) {
      push(
        'source.streams must declare at least one stream when strategy is "cursor_table".'
      );
    }
    descriptor.source.streams.forEach((stream, index) =>
      validateCursorStream(push, stream, `source.streams[${index}]`)
    );
  } else if (descriptor.source.strategy === "domain_event") {
    if (!descriptor.source.events || descriptor.source.events.length === 0) {
      push(
        'source.events must declare at least one event when strategy is "domain_event".'
      );
    }
    if (!descriptor.source.consumerName) {
      push('source.consumerName is required when strategy is "domain_event".');
    }
  } else {
    push(
      `source.strategy must be "cursor_table" or "domain_event" (got ${JSON.stringify((descriptor.source as { strategy?: string }).strategy)}).`
    );
  }

  if (
    !descriptor.rebuildSource ||
    descriptor.rebuildSource.streams.length === 0
  ) {
    push(
      "rebuildSource.streams must declare at least one stream — every projection must be rebuildable from an authoritative source, regardless of its steady-state update strategy."
    );
  } else {
    descriptor.rebuildSource.streams.forEach((stream, index) =>
      validateCursorStream(push, stream, `rebuildSource.streams[${index}]`)
    );
  }

  const declaredMetricKeys = new Set<string>();
  const collectStreamMetricKeys = (
    streams: readonly ProjectionCursorStream[]
  ) => {
    for (const stream of streams) {
      for (const metric of stream.metrics ?? []) {
        declaredMetricKeys.add(metric.metricKey);
      }
    }
  };
  if (descriptor.source?.strategy === "cursor_table") {
    collectStreamMetricKeys(descriptor.source.streams);
  }
  if (descriptor.rebuildSource) {
    collectStreamMetricKeys(descriptor.rebuildSource.streams);
  }

  if (
    !descriptor.metricLabels ||
    Object.keys(descriptor.metricLabels).length === 0
  ) {
    push(
      "metricLabels must declare a human-readable label for at least one metric."
    );
  } else {
    for (const metricKey of Object.keys(descriptor.metricLabels)) {
      if (declaredMetricKeys.size > 0 && !declaredMetricKeys.has(metricKey)) {
        push(
          `metricLabels declares a label for "${metricKey}", which is not produced by any declared stream's metrics.`
        );
      }
    }
  }

  return issues;
}

export type ProjectionRegistryValidationResult = {
  valid: boolean;
  issues: ProjectionRegistryIssue[];
  descriptors: readonly ProjectionDescriptor[];
};

/**
 * Validates the WHOLE registry (every module's contributed descriptors):
 * per-descriptor structural validity (`validateSingleDescriptor`), plus a
 * cross-descriptor invariant (unique `key` — a projection must never be
 * registered twice, whether by the same or different modules).
 */
export function validateProjectionRegistry(
  modules: readonly ModuleDescriptor[]
): ProjectionRegistryValidationResult {
  const issues: ProjectionRegistryIssue[] = [];
  const allDescriptors: ProjectionDescriptor[] = [];
  const seenKeys = new Map<string, number>();

  for (const module of modules) {
    for (const descriptor of module.reportingProjections ?? []) {
      allDescriptors.push(descriptor);
      issues.push(...validateSingleDescriptor(module, descriptor));

      seenKeys.set(descriptor.key, (seenKeys.get(descriptor.key) ?? 0) + 1);
    }
  }

  for (const [key, count] of seenKeys) {
    if (count > 1) {
      issues.push({
        descriptorKey: key,
        message: `key is registered ${count} times — projection keys must be unique across the whole registry.`
      });
    }
  }

  return { valid: issues.length === 0, issues, descriptors: allDescriptors };
}
