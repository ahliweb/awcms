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
  /**
   * The module's primary API prefix — for display, docs and the
   * `openapi_documented` readiness signal. NOT a claim of ownership on its own:
   * see `routes`.
   */
  basePath: string;
  /**
   * Every route prefix this module owns, API and public alike.
   *
   * Added by Issue #256. `basePath` alone could not express ownership, and one
   * module proved it: `tenant_admin` declared `basePath: "/api/v1"`, which is a
   * prefix of every route in the application. Resolve a route to the
   * longest-matching `basePath` and `tenant_admin` swallowed 36 it does not own
   * — all of `/api/v1/access`, `/api/v1/roles`, `/api/v1/users`, `/api/v1/abac`
   * and `/api/v1/identity` (`identity_access`), plus `/api/v1/tenant/modules`
   * (`module_management`). Ownership was therefore not derivable at all, and
   * any gate built on it would have accused the wrong module.
   *
   * A list, because ownership genuinely is not one prefix: `tenant_admin` owns
   * `/api/v1/{offices,settings,setup}`, and `/api/v1/tenant` is SPLIT between
   * `tenant_domain` (`/domains`) and `module_management` (`/modules`).
   * Longest-prefix wins, so a split like that resolves without special cases.
   *
   * Public non-API surfaces belong here too (`/blog/{tenantCode}`, `robots.txt`,
   * `/search`, `/theming`) — they are routes a module owns just as much as its
   * `/api/v1` ones, and leaving them out is what let 30 real routes belong to
   * nobody.
   *
   * Omitted means "`[basePath]`", so every existing descriptor keeps working.
   * `modules:routes:check` requires the resulting map to cover every file under
   * `src/pages` exactly once, or name it in a reviewed platform/public
   * allow-list.
   */
  routes?: string[];
};

export type ModuleEventContract = {
  asyncApiPath?: string;
  publishes?: string[];
  subscribes?: string[];
};

/**
 * Who a permission can ever be held BY (ADR-0053) — not what it lets you do.
 *
 * `tenant` (the default, and what every permission in this base was before the
 * field existed): an ordinary per-tenant permission. It is seeded into the
 * global catalogue and granted to a tenant's `owner` role when that tenant is
 * created.
 *
 * `platform`: the action's effect crosses tenant boundaries, so it is NEVER
 * included in the blanket grant a new tenant's owner receives, and the
 * authorization chokepoint additionally refuses it unless the acting tenant IS
 * the platform tenant (`lib/tenant/platform-tenant.ts`). Two independent
 * mechanisms on purpose: a grant that leaks — by a hand-written INSERT, a
 * restored backup, a future provisioning path that forgets the filter — still
 * cannot be exercised from another tenant.
 */
export type ModulePermissionScope = "tenant" | "platform";

export type ModulePermissionDescriptor = {
  activityCode: string;
  action: string;
  description: string;
  /**
   * Defaults to `"tenant"` when omitted, which is what every existing
   * descriptor means. Declared HERE (in code) rather than read from the
   * database at request time so the chokepoint needs no extra query per call;
   * `tests/platform-scoped-permissions.test.ts` pins this declaration against
   * the migration that seeds it, so the two cannot drift apart silently.
   */
  scope?: ModulePermissionScope;
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
 * this contract file dependency-free — every module's `module.ts`
 * transitively depends on this file, so it must never import anything itself.
 * Build-time
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
   * Deployment profiles (`docs/awcms/deployment-profiles.md`) this module is
   * declared compatible with
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
  /**
   * High-volume table lifecycle descriptors this module owns (ported from
   * awcms-micro Issue #745, ADR-0037) — see `HighVolumeTableDescriptor`'s own
   * doc comment below. Same "module declares its own array, a central engine
   * reads `listModules()`" shape the rest of this contract uses: the
   * `data_lifecycle` module's `domain/lifecycle-registry.ts` aggregates every
   * module's array and validates it (`bun run data-lifecycle:registry:check`),
   * and its bounded archive/purge engine operates ONLY on the metadata the
   * OWNING module declared here — it never reaches into another module's schema
   * (ADR-0013 §6 "no shared-table write").
   */
  dataLifecycle?: HighVolumeTableDescriptor[];
  /**
   * Public search-source descriptors this module contributes to `site_search`
   * (ported from awcms-micro Issue #270, ADR-0040) — see
   * `SearchSourceDescriptor`'s own doc comment below. Same "module declares its
   * own array, a central engine reads `listModules()`" shape `dataLifecycle`/
   * `reportingProjections`/`sodRules` above already use: `site_search`'s
   * `domain/search-source-registry.ts` aggregates + validates every module's
   * array (`bun run site-search:sources:check`), and its generic extraction
   * engine reads a source table using ONLY the column names + declarative
   * publication filter the OWNING module declared here — never a cross-module
   * TypeScript import and never a write into another module's tables
   * (ADR-0013 §6).
   */
  searchSources?: SearchSourceDescriptor[];
  /**
   * Public commentable-resource descriptors this module contributes to
   * `comments` (ported from awcms-micro Issue #271, ADR-0041) — see
   * `CommentableResourceDescriptor`'s own doc comment below. Exactly the
   * `searchSources` shape one field up: the owning content module declares
   * which of ITS resources may be commented on, and `comments`'s
   * `domain/commentable-resource-registry.ts` aggregates + validates every
   * module's array through `listModules()` (`bun run
   * comments:resources:check`). The engine confirms publication state by
   * reading the source table through ONLY the column names + declarative
   * filter declared here — never a cross-module TypeScript import, never a
   * write into another module's tables (ADR-0013 §6).
   */
  commentableResources?: CommentableResourceDescriptor[];
  /**
   * Segregation-of-duties conflict rules this module owns (Issue #181,
   * epic #177 Wave 2 authorization) — see `SoDRuleDescriptor`'s own doc
   * comment below. A module contributes ONE of these per GENERIC
   * conflicting-permission declaration it wants enforced;
   * `identity_access/domain/sod-rule-registry.ts` is the aggregator/validator
   * (`collectSoDRuleDescriptors`/`validateSoDRuleRegistry` over
   * `listModules()`). The BASE ships NO domain *business* SoD rules (issue #181
   * out-of-scope: "Hardcode rule finance/procurement/payroll/inventory ke
   * base" — the base never invents a business rule); a domain module declares
   * its own, and the in-repo test-support fixture
   * `tests/fixtures/example-domain-modules/` carries the illustrative examples.
   * A System-Foundation module MAY still ship a rule governing ITS OWN
   * permissions: since ADR-0037 the base `data_lifecycle` module ships one
   * governance maker/checker rule over its `legal_hold.create`/`.release`.
   */
  sodRules?: SoDRuleDescriptor[];
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
 * Segregation-of-duties conflict rule descriptor (Issue #181, epic #177
 * Wave 2 authorization). Ported from awcms-mini (`_shared/module-contract.ts`,
 * Issue #746). Same "module declares its own descriptor, a central engine
 * reads `listModules()`" shape `permissions`/`reportingProjections` above
 * already use — `identity_access`'s `domain/sod-rule-registry.ts` is the
 * aggregator/validator, mirroring `reporting/domain/projection-registry.ts`.
 *
 * A module contributes ONE of these per real SoD policy it wants enforced
 * (maker/checker, requester/approver, posting/period-control, ...) — the
 * base never hardcodes a domain-specific rule itself (issue #181 out-of-scope:
 * "Hardcode rule finance, procurement, payroll, atau inventory ke base");
 * every entry is a GENERIC conflicting-permission-pair declaration, never a
 * business rule about what those permissions actually do.
 *
 * TRUSTED CODE-ONLY METADATA (same rule as every descriptor type above) —
 * declared by the owning module's source, never tenant/request-controlled,
 * never a secret/executable expression (issue #181 out-of-scope: no
 * tenant-supplied arbitrary expression/SQL).
 */
export type SoDRuleScopeApplicability =
  "any" | "same_scope_only" | "global_within_tenant";

export type SoDRuleSeverity = "low" | "medium" | "high" | "critical";

export type SoDRuleExceptionPolicy = {
  allowed: boolean;
  /** Required when `allowed` is `true` — the permission key a DIFFERENT tenant user must hold to approve an exception to THIS rule (never the same permission the rule itself conflicts over). */
  requiresApprovalPermission?: string;
  /** Required only when `allowed` is `true` — an exception must always have a bounded lifetime (issue #181: "Exception harus ... time-bound"; no indefinite override); moot (must be absent) when `allowed` is `false`. */
  maxDurationDays?: number;
};

export type SoDRuleDescriptor = {
  /** Stable, unique across the whole registry, e.g. `"sales.invoice_maker_checker"`, matching `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` (`<module_key>.<rule_shortname>`). */
  ruleKey: string;
  /** Must equal the declaring module's own `key` — validated by the registry gate, not the type system (see `identity-access/domain/sod-rule-registry.ts`). */
  ownerModuleKey: string;
  description: string;
  /** At least 2 `module.activity.action` permission keys (the `permissionKey()` format, `identity-access/domain/access-control.ts`) that must never all be held/exercised by the same subject for the same scope (or anywhere in the tenant, per `scopeApplicability`) without an approved exception. */
  conflictingPermissionKeys: string[];
  /**
   * `"global_within_tenant"` — the conflict applies even without any shared
   * business scope (holding both permissions anywhere in the tenant is itself
   * the conflict). `"same_scope_only"` — the conflict only applies when both
   * permissions would apply to the SAME `scopeType`+`scopeId`. `"any"` is
   * reserved for a future scope-agnostic rule kind (neither global nor
   * scope-matched) — treated the same as `"global_within_tenant"` by the
   * evaluator so it never silently fails open; no rule in this base uses it.
   */
  scopeApplicability: SoDRuleScopeApplicability;
  severity: SoDRuleSeverity;
  exceptionPolicy: SoDRuleExceptionPolicy;
};

/**
 * A declarative, pure-data public search-source descriptor a content module
 * contributes to `site_search` (ported from awcms-micro Issue #270, ADR-0040).
 * Same "module declares its own descriptor array, a central engine reads
 * `listModules()`" shape `dataLifecycle`/`reportingProjections`/`sodRules`
 * already use — `site_search`'s `domain/search-source-registry.ts` is the
 * aggregator/validator, mirroring `data-lifecycle/domain/lifecycle-registry.ts`.
 *
 * ## Why a descriptor-list, not a capability `provides` (ADR-0040 §3)
 *
 * Search wants MANY content modules to contribute sources. Modeling
 * `search_source` as a capability `provides` would immediately trip
 * `module-composition.ts`'s `capability_provider_conflict` (>1 declared provider
 * of the same capability string). A descriptor-list riding `listModules()` lets
 * a module contribute a reviewed source by declaring it in its own `module.ts`
 * WITHOUT writing to `site_search`'s index tables.
 *
 * ## Pure DATA, not an executable extractor
 *
 * This descriptor carries NO function reference — only reviewed, code-only
 * column/table NAMES and a declarative `publicationFilter`. `site_search`'s
 * generic engine builds a PARAMETERIZED extraction query from it: literal filter
 * VALUES are always bound parameters; only the IDENTIFIERS (table/column names)
 * are interpolated, and they are re-validated with a strict identifier pattern
 * immediately before interpolation — the exact discipline `data_lifecycle`'s
 * `generic` executionMode uses. There is no place for a tenant to inject SQL.
 *
 * TRUSTED CODE-ONLY METADATA (same rule as every descriptor type here) —
 * declared by the owning module's source, never tenant/request-controlled.
 */
export type SearchSourcePublicationFilter = {
  /**
   * Column = literal-value equality checks, e.g. `{ status: "published",
   * visibility: "public" }`. The VALUES are bound parameters (never
   * interpolated), the KEYS are validated identifiers. All must hold (AND).
   */
  equals?: Readonly<Record<string, string>>;
  /** Columns that must be `IS NOT NULL` for a row to be public (e.g. `published_at`). */
  notNullColumns?: readonly string[];
  /** Columns that must be `IS NULL` for a row to be public — the soft-delete gate (e.g. `deleted_at`). */
  nullColumns?: readonly string[];
  /** Columns whose value must be `<= now()` for a row to be public — the schedule gate (e.g. `published_at`). */
  timeReachedColumns?: readonly string[];
};

export type SearchSourceDescriptor = {
  /** Stable, unique across the whole registry, `"<module_key>.<short>"` (e.g. `"blog_content.post"`). */
  key: string;
  /** Must equal the declaring module's own `key` — validated by the registry gate (`site-search/domain/search-source-registry.ts`), not the type system. */
  ownerModuleKey: string;
  /** Opaque content-type discriminator, e.g. `"blog_post"` / a domain module's `"product"`. Stored on each index document and used for admitted-type filtering; never interpreted structurally by `site_search`. */
  resourceType: string;
  /** Source table the generic engine reads (must start with `awcms_`). */
  tableName: string;
  /** Defaults to `"tenant_id"`. */
  tenantColumn?: string;
  /** Defaults to `"id"` — the resource primary key stored as the index document's `resource_id`. */
  idColumn?: string;
  /** Column carrying the BCP-47 locale of each row — every index document is locale-scoped. */
  localeColumn: string;
  /** Column carrying the row's last-modified `timestamptz` — the reconciliation staleness/`source_updated_at` signal. */
  updatedAtColumn: string;
  /** Column mapped to the index document's weighted `title` (tsvector weight A). */
  titleColumn: string;
  /** Column mapped to the index document's `summary` (tsvector weight B); `null`/omit when the source has none. */
  summaryColumn?: string | null;
  /** Columns concatenated into the index document's `body_text` (tsvector weight D + snippet source). */
  bodyColumns: readonly string[];
  /** `text[]` column mapped to the index document's `tags` (tsvector weight C); `null`/omit when the source has none. */
  tagsColumn?: string | null;
  /**
   * Public URL template resolved at index time. Placeholders: `:slug` and `:id`
   * (from `slugColumn`/`idColumn`) plus `:tenantCode` — an AWCMS-SPECIFIC
   * addition over the awcms-micro original, because this base's public content
   * routes are path-tenant-scoped (`/blog/{tenantCode}/{slug}`, ADR-0009) rather
   * than host-resolved `/news/:slug`. `site_search`'s engine substitutes
   * `:tenantCode` from `awcms_tenants.tenant_code` for the tenant being indexed;
   * every substituted value is `encodeURIComponent`'d, so no source value can
   * inject a path segment or a scheme.
   */
  urlTemplate: string;
  /** Column supplying `:slug` in `urlTemplate`; `null`/omit when the template uses only `:id`. */
  slugColumn?: string | null;
  /** Declarative publication predicate enforced at the source→index boundary — the draft/private/deleted-leakage defense (ADR-0040 §5). */
  publicationFilter: SearchSourcePublicationFilter;
  /** Relevance multiplier applied to `ts_rank` at query time — lets a source rank above/below another (`0 < weight <= 10`). */
  weight: number;
  /** Privacy classification — ONLY `"public"` content is admitted to the index (never private/admin business data). */
  privacyClassification: "public";
};

/**
 * A declarative, pure-data public commentable-resource descriptor a content
 * module contributes to `comments` (ported from awcms-micro Issue #271,
 * ADR-0041). Same seam as `searchSources` above, and for the same reason: many
 * content modules may want to accept comments, so modeling
 * `commentable_resource` as a capability `provides` would immediately trip
 * `module-composition.ts`'s `capability_provider_conflict`. A descriptor-list
 * riding `listModules()` lets a module admit a reviewed commentable type by
 * declaring it in its own `module.ts` WITHOUT writing to `comments`'s tables.
 *
 * ## Pure DATA, not an executable extractor
 *
 * No function reference — only reviewed, code-only column/table NAMES and a
 * declarative `publicationFilter`. `comments`'s engine builds a PARAMETERIZED
 * existence/publication query from it: literal filter VALUES are always bound
 * parameters; only the IDENTIFIERS are interpolated, re-validated with the
 * sanctioned `assertSafeIdentifier` pattern immediately before interpolation. A
 * resource must be PUBLISHED & PUBLIC (per `publicationFilter`) before a comment
 * on it is ever accepted or shown, so a draft/private/deleted/scheduled resource
 * can neither receive nor expose comments — and the comment surface is never an
 * authorization source for the underlying resource.
 *
 * TRUSTED CODE-ONLY METADATA (same rule as every descriptor type here) —
 * declared by the owning module's source, never tenant/request-controlled.
 */
export type CommentableResourcePublicationFilter = {
  /** Column = literal-value equality checks, e.g. `{ status: "published", visibility: "public" }`. VALUES are bound parameters, KEYS are validated identifiers. All must hold (AND). */
  equals?: Readonly<Record<string, string>>;
  /** Columns that must be `IS NOT NULL` for a row to be public (e.g. `published_at`). */
  notNullColumns?: readonly string[];
  /** Columns that must be `IS NULL` for a row to be public — the soft-delete gate (e.g. `deleted_at`). */
  nullColumns?: readonly string[];
  /** Columns whose value must be `<= now()` for a row to be public — the schedule gate (e.g. `published_at`). */
  timeReachedColumns?: readonly string[];
};

/**
 * The policy a resource type's thread opens with until the tenant overrides it.
 * Same four modes as `awcms_comments_settings.default_policy_mode` and the
 * `comment-policy.ts` decision function.
 */
export type CommentableResourceDefaultPolicy =
  | "disabled"
  | "authenticated-only"
  | "moderated-anonymous"
  | "moderated-registered";

export type CommentableResourceDescriptor = {
  /** Stable, unique across the whole registry, `"<module_key>.<short>"` (e.g. `"blog_content.post"`). */
  key: string;
  /** Must equal the declaring module's own `key` — validated by the registry gate (`comments/domain/commentable-resource-registry.ts`), not the type system. */
  ownerModuleKey: string;
  /** Opaque content-type discriminator, e.g. `"blog_post"`. Stored on each thread; never interpreted structurally by `comments`. */
  resourceType: string;
  /** Source table the engine reads to confirm a resource is published/public (must start with `awcms_`). */
  tableName: string;
  /** Defaults to `"tenant_id"`. */
  tenantColumn?: string;
  /** Defaults to `"id"` — the resource primary key. */
  idColumn?: string;
  /** Column carrying the BCP-47 locale of each row — every thread is locale-scoped. */
  localeColumn: string;
  /** Column supplying `:slug` in `urlTemplate`; `null`/omit when the template uses only `:id`. */
  slugColumn?: string | null;
  /**
   * Public URL template resolved when a thread is opened. Placeholders `:slug`,
   * `:id`, and `:tenantCode` — the last one being the same AWCMS-specific
   * addition `SearchSourceDescriptor.urlTemplate` carries, because this base's
   * public content routes are path-tenant-scoped (`/blog/{tenantCode}/{slug}`,
   * ADR-0009) rather than host-resolved. Every substituted value is
   * `encodeURIComponent`'d.
   */
  urlTemplate: string;
  /** Declarative publication predicate enforced at the resource→thread boundary — the draft/private/deleted-leakage defense (ADR-0041 §5). */
  publicationFilter: CommentableResourcePublicationFilter;
  /** Policy mode a fresh thread for this resource type opens with (the tenant's settings may override). */
  defaultPolicy: CommentableResourceDefaultPolicy;
};

/**
 * High-volume table lifecycle descriptor family (ported from awcms-micro
 * Issue #745, ADR-0037). A module contributes ONE `HighVolumeTableDescriptor`
 * per high-volume table it owns, in its own `module.ts`'s `dataLifecycle`
 * array — trusted, code-only metadata (never tenant/request-controlled). The
 * `data_lifecycle` module's engine reads `listModules()`, validates the whole
 * registry (`data-lifecycle/domain/lifecycle-registry.ts`), plans dry-runs,
 * and — for `"generic"` descriptors only — performs bounded archive/purge on
 * the owning module's behalf using ONLY the column names/limits declared here.
 * A `"delegated"` descriptor keeps its OWN existing purge mechanism as the
 * sole mutator; the engine only reads it for a dry-run backlog snapshot.
 */
export type LifecycleTableScope = "tenant" | "global";

/** Broad retention rationale bucket — used for readiness/compliance-mapping grouping, not itself a legal category (never asserts one universal legal retention period). */
export type LifecycleRetentionClass =
  | "audit_security"
  | "analytics_telemetry"
  | "operational_queue"
  | "financial_tax"
  | "communication_log"
  | "system_event";

/**
 * `"delegated"` — the owning module already has its own hand-rolled
 * purge/retention function and/or scheduled job (e.g.
 * `purgeExpiredAuditEvents`); `data_lifecycle`'s engine may read this table for
 * dry-run counts (read-only, safe) but NEVER mutates it — real archive/purge
 * stays owned by the existing mechanism. `"generic"` — the owning module has
 * NO existing purge mechanism and explicitly opts the table into
 * `data_lifecycle`'s generic bounded archive/purge execution (table name,
 * tenant column, cursor column, batch limit — all declared right here, by the
 * owner, so this is never an unsanctioned cross-module schema access).
 */
export type LifecycleExecutionMode = "delegated" | "generic";

export type LifecycleArchivePortKind =
  "local_offline" | "external_object_storage" | "none";

export type LifecycleArchiveFormat = "jsonl" | "csv";

export type LifecycleDeletionMode =
  "hard_delete" | "anonymize" | "status_transition_then_purge";

export type LifecyclePartitionPolicy = {
  eligible: boolean;
  granularity?: "daily" | "monthly" | "yearly";
  /** Required either way — "not eligible" needs as much of a stated reason as "eligible". */
  rationale: string;
};

export type LifecycleArchivePolicy = {
  archivable: boolean;
  format?: LifecycleArchiveFormat;
  port?: LifecycleArchivePortKind;
  rationale: string;
};

export type LifecycleDeletionPolicy = {
  mode: LifecycleDeletionMode;
  rationale: string;
};

export type LifecycleLegalHoldPolicy = {
  /**
   * DOCUMENTATION/GUIDANCE ONLY — whether this class of data plausibly warrants
   * a legal hold at all, for an operator deciding whether to bother creating
   * one. Deliberately NOT consulted by the runtime engine
   * (`data-lifecycle/domain/legal-hold.ts`'s `evaluateLegalHoldForDescriptor`)
   * to decide whether an ACTUAL hold record applies — a hold record (a human,
   * permission-gated, audited action) targeting this descriptor's `key`, or a
   * tenant-wide hold (`descriptorKey: null`), always applies regardless of what
   * this flag says. Letting `applicable: false` suppress enforcement would let
   * an owning module silently defeat legal hold coverage for its own table by
   * declaring it "not applicable" — exactly the bypass Issue #745 forbids
   * ("cannot be silently bypassed by tenant policy").
   */
  applicable: boolean;
  /**
   * A literal, not a free-choice enum value, when `applicable` is `true` —
   * "legal hold overrides ordinary retention/purge" (Issue #745 critical
   * requirement) can never be declared away per-descriptor by an owning module
   * picking a different precedence value. When `applicable` is `false`,
   * precedence is moot (`"not_applicable"`).
   */
  precedence: "overrides_retention" | "not_applicable";
};

export type LifecycleIndexRequirement = {
  columns: readonly string[];
  purpose: string;
};

/** Documents an EXISTING hand-rolled purge mechanism this descriptor adopts rather than duplicates — required when `executionMode: "delegated"`. */
export type LifecycleExistingAdopter = {
  jobCommand?: string;
  purgeFunctionRef: string;
  description: string;
};

export type HighVolumeTableDescriptor = {
  /** Stable, unique across the whole registry, e.g. `"logging.audit_events"` (`<ownerModuleKey>.<table_shortname>`). */
  key: string;
  /** Must start with `awcms_` and be snake_case. */
  tableName: string;
  /** Must equal the declaring module's own `key` — validated by the registry gate, not by the type system (see `data-lifecycle/domain/lifecycle-registry.ts`). */
  ownerModuleKey: string;
  scope: LifecycleTableScope;
  cursorColumn: string;
  /** Defaults to `"tenant_id"` when `scope === "tenant"`. */
  tenantColumn?: string;
  retentionClass: LifecycleRetentionClass;
  retentionMinDays: number;
  retentionMaxDays: number;
  defaultRetentionDays: number;
  partition: LifecyclePartitionPolicy;
  archive: LifecycleArchivePolicy;
  deletion: LifecycleDeletionPolicy;
  legalHold: LifecycleLegalHoldPolicy;
  requiredIndexes: readonly LifecycleIndexRequirement[];
  batchLimit: number;
  backupRestoreNotes: string;
  executionMode: LifecycleExecutionMode;
  existingAdopter?: LifecycleExistingAdopter;
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
 *
 * `1.3.0` (Issue #181, epic #177 Wave 2 authorization) — added the optional
 * `ModuleDescriptor.sodRules` field plus the `SoDRuleDescriptor` family of
 * exported types (`SoDRuleScopeApplicability`/`SoDRuleSeverity`/
 * `SoDRuleExceptionPolicy`), ported from awcms-mini Issue #746 (MINOR: purely
 * additive — every base `module.ts` that omits `sodRules` stays valid).
 *
 * `2.0.0` (ADR-0034 §3 — derived application pathway removal) — REMOVED the
 * `ApplicationModuleRegistry` and `ModuleMigrationNamespace` composition types
 * (MAJOR: exported types removed). The derived-application seam
 * (`src/modules/application-registry.ts`, migration namespace 900-999,
 * `extension:check`) is deleted; the base is a template used directly. No
 * `ModuleDescriptor` field changed — every `module.ts` stays valid unchanged.
 *
 * `2.1.0` (ADR-0037, ported from awcms-micro Issue #745) — added the optional
 * `ModuleDescriptor.dataLifecycle` field plus the `HighVolumeTableDescriptor`
 * family of exported types (`Lifecycle{TableScope,RetentionClass,ExecutionMode,
 * ArchivePortKind,ArchiveFormat,DeletionMode}`, `Lifecycle{Partition,Archive,
 * Deletion,LegalHold}Policy`, `LifecycleIndexRequirement`,
 * `LifecycleExistingAdopter`) — MINOR: purely additive, every base `module.ts`
 * that omits `dataLifecycle` stays valid unchanged.
 *
 * `2.2.0` (ADR-0040, ported from awcms-micro Issue #270) — added the optional
 * `ModuleDescriptor.searchSources` field plus the `SearchSourceDescriptor` /
 * `SearchSourcePublicationFilter` exported types — MINOR: purely additive, every
 * base `module.ts` that omits `searchSources` stays valid unchanged.
 *
 * `2.3.0` (ADR-0041, ported from awcms-micro Issue #271) — added the optional
 * `ModuleDescriptor.commentableResources` field plus the
 * `CommentableResourceDescriptor` / `CommentableResourcePublicationFilter` /
 * `CommentableResourceDefaultPolicy` exported types — MINOR: purely additive,
 * every base `module.ts` that omits `commentableResources` stays valid
 * unchanged.
 *
 * `2.4.0` (Issue #256, PR #267) — added `ModuleApiContract.routes`, making
 * route ownership DERIVABLE instead of inferred from a single `basePath`.
 * `tenant_admin` had declared `basePath: "/api/v1"` — a prefix of every route
 * in the application — so longest-prefix resolution handed it 36 routes it does
 * not own. MINOR: purely additive, `basePath` keeps its display/docs meaning.
 * This entry was MISSING from this changelog until 8 August 2026, which is how
 * `absorb-awcms-micro-roadmap.md` came to reserve `2.4.0` for a seam that had
 * not landed while the slot was already taken.
 *
 * `2.5.0` (ADR-0053) — added the optional `ModulePermissionDescriptor.scope`
 * field plus the `ModulePermissionScope` exported type — MINOR: purely
 * additive, and omitting it means `"tenant"`, which is exactly what every
 * existing descriptor already meant.
 */
export const MODULE_CONTRACT_VERSION = "2.5.0";

export function defineModule(descriptor: ModuleDescriptor): ModuleDescriptor {
  return descriptor;
}
