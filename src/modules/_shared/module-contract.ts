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

/**
 * Deployment profile names (Issue #178, epic #177 ERP-readiness, ADR-0025).
 * Same four operating profiles `docs/awcms/deployment-profiles.md` defines
 * (development / staging / production / offline-LAN). Declared inline here
 * as string literals rather than imported from a config module, to keep
 * this contract file dependency-free — every module's `module.ts`, and now
 * every derived repository's own `application-registry.ts`, transitively
 * depends on this file, so it must never import anything itself. Build-time
 * composition (`module-management/domain/module-composition.ts`) compares
 * these structurally (plain string equality), so keeping the list in sync
 * with the deployment-profiles doc is a documentation obligation, not a
 * compile-time-enforced one.
 */
export type ModuleDeploymentProfile =
  "development" | "staging" | "production" | "offline-lan";

export type ModuleCompatibilityContract = {
  minAppVersion?: string;
  /**
   * Deployment profiles (`docs/awcms/deployment-profiles.md`) this module —
   * base or contributed application module — is declared compatible with
   * (Issue #178). Absence means "no constraint declared", the same
   * convention `minAppVersion`'s absence already uses (compatible with every
   * profile). Build-time composition reports a
   * `deployment_profile_incompatible` issue when a module claims a profile
   * one of its own lifecycle `dependencies` does not support.
   */
  deploymentProfiles?: readonly ModuleDeploymentProfile[];
};

/**
 * One capability this module's application/domain code consumes from ANOTHER
 * module, via a port (ADR-0011) — `_shared/ports/*.ts` defines the actual
 * TypeScript interface; `providedBy` names the module whose adapter
 * implements it, wired at the composition root, never a direct cross-module
 * import inside `application`/`domain`. Deliberately separate from
 * `dependencies` (which governs enable/disable LIFECYCLE ORDERING only):
 * `capabilities` documents a SOURCE-LEVEL relationship, not a lifecycle
 * constraint. `optional: true` means the CONSUMING module's own feature
 * degrades safely when the capability resolves to "not applicable" for a
 * given tenant/request.
 */
export type ModuleCapabilityDependency = {
  capability: string;
  providedBy: string;
  optional?: boolean;
};

/** Trusted, code-only capability declaration (ADR-0011, `capability-contract-versions.ts`). */
export type ModuleCapabilityContract = {
  /** Capability names THIS module provides an adapter for (matches a port in `_shared/ports/`), for other modules to declare in their own `consumes`. */
  provides?: readonly string[];
  consumes?: readonly ModuleCapabilityDependency[];
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
  /**
   * Cross-module capability provider/consumer bindings this module declares
   * (ADR-0011, Issue #178) — see `ModuleCapabilityContract` above. Validated
   * registry-wide by build-time composition
   * (`module-management/domain/module-composition.ts`): a capability may have
   * at most one provider, and every REQUIRED consumed capability must
   * resolve to a registered provider that actually declares it.
   */
  capabilities?: ModuleCapabilityContract;
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
 *
 * `1.2.0` (Issue #178, epic #177 ERP-readiness) — added the optional
 * `ModuleDescriptor.capabilities` field (`ModuleCapabilityContract`),
 * `ModuleCompatibilityContract.deploymentProfiles`, and the new
 * `ApplicationModuleRegistry`/`ModuleMigrationNamespace` composition types
 * (MINOR: purely additive, no existing field removed/retyped — every base
 * `module.ts` that only set the original fields stays valid unchanged).
 */
export const MODULE_CONTRACT_VERSION = "1.2.0";

export function defineModule(descriptor: ModuleDescriptor): ModuleDescriptor {
  return descriptor;
}

/**
 * One derived/downstream repository's declared reservation of the numeric
 * `NNN_` migration-filename prefix range its own `sql/` directory owns
 * (Issue #178). Purely declarative composition metadata — composition does
 * NOT read real `sql/*.sql` filenames (see
 * `module-management/domain/module-composition.ts`'s file header for why
 * that check stays a pure, filesystem-free, declared-data comparison).
 */
export type ModuleMigrationNamespace = {
  /** Human label for diagnostics, e.g. "awpos" or "smart-school-portal". */
  label: string;
  /** Inclusive lower bound of the numeric `NNN_` migration filename prefix this registry owns. */
  rangeStart: number;
  /** Inclusive upper bound. */
  rangeEnd: number;
};

/**
 * One derived/downstream repository's contribution to the final composed
 * module registry (Issue #178, epic #177 ERP-readiness, ADR-0025). Supplied
 * ONLY through the designated build-time extension point
 * (`src/modules/application-registry.ts`) — never by editing
 * `src/modules/index.ts` itself. Still 100% static, compile-time TypeScript
 * — no runtime discovery/upload/package scanning/`eval`. See
 * `src/modules/module-management/domain/module-composition.ts` for the
 * validation engine that composes this against the base registry.
 */
export type ApplicationModuleRegistry = {
  /** Stable, human-readable identifier for the contributing repository/application — used in diagnostics and the composed inventory only, never persisted to a database or used for authorization. */
  id: string;
  modules: readonly ModuleDescriptor[];
  /**
   * This application registry's own reserved migration-number range,
   * validated against the base's reserved range
   * (`module-composition.ts`'s `BASE_MODULE_MIGRATION_NAMESPACE`) to catch a
   * numbering collision before any migration file is even written. Optional:
   * composition skips the overlap check when omitted (a documented caveat,
   * not a silent pass).
   */
  migrationNamespace?: ModuleMigrationNamespace;
};
