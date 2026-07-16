/**
 * Module descriptor contract (docs/awcms/10_template_kode_coding_standard.md
 * §Module descriptor). Trusted code-only metadata — written by a module's own
 * `module.ts`, never user/tenant-controlled, never carries a runtime secret.
 */

/** Descriptive category only — not itself an authorization or enable/disable mechanism. */
export type ModuleType = "base" | "system" | "domain" | "integration";

/**
 * `disabled` here means globally disabled by code/deployment — not a
 * per-tenant toggle (that is separate database state, added when the
 * module-management module lands).
 */
export type ModuleLifecycleStatus =
  "active" | "experimental" | "deprecated" | "maintenance" | "disabled";

export type ModuleApiContract = {
  openApiPath: string;
  basePath: string;
};

export type ModuleEventContract = {
  asyncApiPath?: string;
  publishes?: string[];
  subscribes?: string[];
};

export type ModulePermissionDescriptor = {
  activityCode: string;
  action: string;
  description: string;
};

export type ModuleNavigationEntry = {
  labelKey: string;
  path: string;
  icon?: string;
  order?: number;
  group?: string;
  requiredPermission?: string;
};

export type ModuleSettingsContract = {
  schemaVersion?: number;
  defaults?: Record<string, unknown>;
};

export type ModuleJobDescriptor = {
  command: string;
  purpose: string;
  recommendedSchedule?: string;
  environmentNotes?: string;
  safeInOfflineLan?: boolean;
};

export type ModuleHealthContract = {
  hasHealthCheck?: boolean;
  hasReadinessCheck?: boolean;
};

export type ModuleCompatibilityContract = {
  minAppVersion?: string;
};

export type ModuleDescriptor = {
  key: string;
  name: string;
  version: string;
  status: ModuleLifecycleStatus;
  description: string;
  dependencies: string[];
  api?: ModuleApiContract;
  events?: ModuleEventContract;
  type?: ModuleType;
  isCore?: boolean;
  permissions?: ModulePermissionDescriptor[];
  navigation?: ModuleNavigationEntry[];
  settings?: ModuleSettingsContract;
  jobs?: ModuleJobDescriptor[];
  health?: ModuleHealthContract;
  compatibility?: ModuleCompatibilityContract;
  maintainers?: string[];
  /**
   * Read-model projection descriptors this module owns (ported from
   * awcms-mini Issue #753) — see `ProjectionDescriptor`'s own doc comment
   * below. A module that wants a derived, incrementally-maintained read
   * model contributes ONE of these per projection in its own `module.ts`;
   * `reporting`'s engine aggregates every module's array via
   * `reporting/domain/projection-registry.ts` and only ever writes ITS OWN
   * `awcms_reporting_projection_*` tables.
   */
  reportingProjections?: ProjectionDescriptor[];
};

/**
 * Module-contributed read-model projection descriptor (ported from
 * awcms-mini Issue #753). Same "module declares its own array, a central
 * aggregator (`reporting/domain/projection-registry.ts`) reads
 * `listModules()`" shape the rest of this contract uses. `reporting`'s
 * engine never writes another module's transactional table; it only ever
 * READS a source table (a bounded cursor re-scan of a column the owning
 * module declares here, or a `domain_event_runtime` consumer it registers
 * itself) and writes its own `awcms_reporting_projection_*` tables.
 *
 * TRUSTED CODE-ONLY METADATA (same rule as every descriptor type above) —
 * declared by the owning module's source, never tenant/request-controlled.
 */
export type ProjectionScope = "tenant" | "global";

/** One event type/version this projection's steady-state updates consume via a `domain_event_runtime` consumer — the actual consumer entry lives in `domain-event-runtime/infrastructure/consumer-registry.ts` (the cross-module wiring point). `eventVersion` is a STRING (e.g. `"1.0"`), matching `DomainEventEnvelope.eventVersion`. */
export type ProjectionEventSource = {
  eventType: string;
  eventVersion: string;
};

/** One rule evaluated against a fetched batch row (`reporting/application/projection-incremental-worker.ts`) — `matchColumn`/`matchValue` are optional (omit both to count every row); when present, both are required together. */
export type ProjectionCursorMetricRule = {
  metricKey: string;
  effect: "increment" | "decrement";
  matchColumn?: string;
  matchValue?: string;
};

/**
 * One bounded, cursor-ordered re-scan of a single source table — the ONLY
 * mechanism this system uses to poll-update a `cursor_table` projection or
 * to recompute ANY projection during a rebuild. `cursorColumn` must be a
 * monotonically-increasing, insert-time-only column on an effectively
 * append-only table/stream.
 */
export type ProjectionCursorStream = {
  /** Unique within the descriptor — keys this stream's own cursor row. */
  streamKey: string;
  /** Must start with `awcms_` and be snake_case. */
  tableName: string;
  /** Defaults to `"tenant_id"`. */
  tenantColumn?: string;
  cursorColumn: string;
  metrics: readonly ProjectionCursorMetricRule[];
};

export type ProjectionSourceContract =
  | { strategy: "cursor_table"; streams: readonly ProjectionCursorStream[] }
  | {
      strategy: "domain_event";
      events: readonly ProjectionEventSource[];
      /** Must match the `DomainEventConsumerDefinition.name` registered for this projection in `domain-event-runtime/infrastructure/consumer-registry.ts`. */
      consumerName: string;
    };

export type ProjectionFreshnessPolicy = {
  /** Below this age since the last successful update, the projection reports `"current"`. */
  targetSeconds: number;
  /** At or above this age, the projection reports `"stale"` (between `targetSeconds` and this, `"delayed"`). Must be `>= targetSeconds`. */
  staleAfterSeconds: number;
  /** Consecutive update failures at or above this count report `"failed"` regardless of age. */
  errorAfterConsecutiveFailures: number;
};

export type ProjectionDescriptor = {
  /** Stable, unique across the whole registry, `"<ownerModuleKey>.<name>"`. */
  key: string;
  version: number;
  /** Must equal the declaring module's own `key` — validated by the registry gate, not the type system (see `reporting/domain/projection-registry.ts`). */
  ownerModuleKey: string;
  scope: ProjectionScope;
  description: string;
  /** How this projection's STEADY-STATE (ongoing, incremental) updates arrive. */
  source: ProjectionSourceContract;
  /** How a REBUILD recomputes this projection from scratch — ALWAYS a bounded cursor re-scan of the authoritative source table(s), even for a `domain_event`-strategy projection. */
  rebuildSource: { streams: readonly ProjectionCursorStream[] };
  /** `metricKey` (from `source`/`rebuildSource`'s own rules) -> human-readable label. */
  metricLabels: Readonly<Record<string, string>>;
  /** `module.activity.action` permission key required to READ this projection's snapshot/freshness/reconciliation. Rebuild/export use their own separate permissions. */
  requiredPermission: string;
  freshness: ProjectionFreshnessPolicy;
  /** API path a client can follow to see the live, fully-reauthorized source view this projection summarizes — MUST independently re-check RBAC/ABAC at request time. */
  drillDownPath?: string;
  /** Free-text reference to a lifecycle registry key if this projection's own tables are separately registered there, or a short rationale if not — documentation only. */
  retentionClass: string;
  /** Bounded per-pass row limit for both incremental and rebuild cursor scans. */
  batchLimit: number;
};

/**
 * SemVer of this file's own exported type shape — independent of
 * `package.json` (release version) and OpenAPI/AsyncAPI `info.version`.
 * MAJOR: a field removed/renamed or an optional field becomes required.
 * MINOR: a new optional field added. PATCH: doc-only clarification.
 *
 * `1.1.0` — added the optional `ModuleDescriptor.reportingProjections`
 * field plus the `ProjectionDescriptor` family of exported types (MINOR:
 * purely additive), ported from awcms-mini Issue #753.
 */
export const MODULE_CONTRACT_VERSION = "1.1.0";

export function defineModule(descriptor: ModuleDescriptor): ModuleDescriptor {
  return descriptor;
}
