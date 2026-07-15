/**
 * Metrics port (Issue #698, epic #679 platform-hardening — "operational
 * proof" wave). Complements, does NOT replace, the structured logger
 * (`src/lib/logging/logger.ts`, Issue #447) or the audit trail
 * (`src/modules/logging/application/audit-log.ts`, doc 10): those two record
 * discrete, per-event, high-detail facts (what happened, to whom, when, with
 * what free-text detail). This module records low-cardinality numeric
 * AGGREGATES (how many, how fast, how saturated) meant to be scraped/pushed
 * to a time-series backend at a fixed, small cost regardless of traffic
 * volume — a different concept, not a rename of logging.
 *
 * Same extension-point shape as `setLogSink`/`getLogSink`
 * (`src/lib/logging/logger.ts`): the default adapter is a total no-op (zero
 * I/O, zero allocation beyond a couple of object literals), so every
 * offline/LAN deployment that never calls `setMetricsPort` pays no runtime
 * cost and needs no external collector — satisfying the issue's "Offline/LAN
 * operation works with no external collector" guardrail by construction. A
 * derived application registers its own adapter (Prometheus text exposition,
 * OpenTelemetry, anything else) via `setMetricsPort`; see
 * `./adapters/prometheus-text-adapter.ts` for a worked, dependency-free
 * example.
 *
 * Guardrails (Issue #698 issue body, non-negotiable):
 * - No tenant IDs, unbounded-ID routes, email/IP, object keys, tokens,
 *   prompts, or conversation content in ANY label, ever.
 * - Every metric this codebase emits is declared in `METRIC_DEFINITIONS`
 *   below with its full label set, an `approxCardinality` estimate, and a
 *   `privacyNote` — this is the "documented cardinality and privacy review"
 *   the issue's first acceptance criterion asks for. `MetricName` is a
 *   compile-time union derived from this registry's keys, so a call site
 *   CANNOT emit an undeclared metric name — adding one always means adding a
 *   reviewed `METRIC_DEFINITIONS` entry first, never an ad hoc string at a
 *   call site.
 * - `recordCounter`/`recordHistogram`/`recordGauge` are the ONLY way
 *   application code emits metrics — never call a registered `MetricsPort`
 *   adapter directly. They silently DROP any label key not declared in that
 *   metric's `allowedLabelKeys` (defense in depth: even a future call-site
 *   bug that tries to pass, say, a raw path or an id can never actually
 *   reach an adapter) and never let an adapter's own thrown error escape —
 *   mirroring `log()`'s sink-error containment in `logger.ts` — so a broken
 *   or slow third-party adapter can never break request/job processing.
 * - Metrics are NEVER an authorization source — nothing in this module (or
 *   anything that calls it) may read a metric value to make an ABAC/RLS/
 *   authentication decision.
 */
import { safeErrorDetail } from "../logging/error-sanitizer";

export type MetricLabels = Record<string, string>;

/** The full contract every metrics adapter (no-op, in-memory, Prometheus, OpenTelemetry, ...) implements. Deliberately tiny — three methods, no adapter lifecycle/flush/close, matching `LogSink`'s minimalism. */
export type MetricsPort = {
  incrementCounter(name: string, labels: MetricLabels, value: number): void;
  observeHistogram(name: string, valueMs: number, labels: MetricLabels): void;
  setGauge(name: string, value: number, labels: MetricLabels): void;
};

export type MetricType = "counter" | "histogram" | "gauge";

export type MetricDefinition = {
  /** Same string as this entry's key — kept as a field too so an adapter rendering exposition text (e.g. Prometheus `# HELP`/`# TYPE`) can iterate `Object.values(METRIC_DEFINITIONS)` without re-deriving it. */
  name: string;
  type: MetricType;
  description: string;
  /** The ONLY label keys `recordCounter`/`recordHistogram`/`recordGauge` will ever forward to an adapter for this metric — anything else passed in is silently dropped before the adapter ever sees it. */
  allowedLabelKeys: readonly string[];
  /** Human-readable upper bound on distinct label-value combinations, given every `allowedLabelKeys` value comes from a fixed, code-defined enum (never tenant/user/request-supplied free text) — see each entry's own note for why its inputs are bounded. */
  approxCardinality: string;
  /** Why this metric's labels cannot leak a tenant id, unbounded route id, email/IP, object key, token, prompt, or conversation content (Issue #698 guardrail). */
  privacyNote: string;
};

const PRIVACY_NOTE_CODE_DEFINED_ENUM =
  "All label values are drawn from a fixed, code-defined enum/allow-list (HTTP method, Astro's static route pattern, HTTP status code, work-class name, job name, job status, provider family, circuit-breaker state) — never a tenant id, raw request path with an id in it, email, IP, object key, token, or free text.";

/**
 * Every metric this codebase is allowed to emit. Adding a metric or a label
 * key means adding/extending an entry HERE first (compile-time enforced via
 * `MetricName` below) — never inventing a name inline at a call site.
 */
export const METRIC_DEFINITIONS = {
  http_requests_total: {
    name: "http_requests_total",
    type: "counter",
    description:
      "Count of completed HTTP responses, by method/route-pattern/status code.",
    allowedLabelKeys: ["method", "routePattern", "statusCode"],
    approxCardinality:
      "~7 HTTP methods x ~150 Astro route patterns (file-based, static — never a concrete id) x ~20 realistically-used status codes ≈ low thousands worst case, far fewer in practice.",
    privacyNote:
      'routePattern is Astro\'s own static route-matching pattern (e.g. "/api/v1/modules/[moduleKey]/health"), the bracketed placeholder literal — NEVER the concrete id from the actual request. ' +
      PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  http_request_duration_ms: {
    name: "http_request_duration_ms",
    type: "histogram",
    description: "Request handling latency in milliseconds.",
    allowedLabelKeys: ["method", "routePattern"],
    approxCardinality: "~7 methods x ~150 route patterns ≈ ~1000 series bound.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  db_pool_work_class_active: {
    name: "db_pool_work_class_active",
    type: "gauge",
    description:
      "Current in-flight request count per database work class (src/lib/database/work-class.ts).",
    allowedLabelKeys: ["workClass"],
    approxCardinality:
      "Exactly 5 — the fixed WorkClass enum (critical_transaction, interactive, reporting, background_sync, maintenance).",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  db_pool_work_class_queued: {
    name: "db_pool_work_class_queued",
    type: "gauge",
    description:
      "Current FIFO-queued waiter count per database work class (backpressure signal).",
    allowedLabelKeys: ["workClass"],
    approxCardinality: "Exactly 5 — same fixed WorkClass enum.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  db_pool_work_class_rejected_total: {
    name: "db_pool_work_class_rejected_total",
    type: "counter",
    description:
      "Count of database work-class acquisitions rejected immediately (Issue #743) because the bounded FIFO queue for that class was already full — distinct from a queued caller that later timed out (see db_pool_work_class_wait_ms's outcome label).",
    allowedLabelKeys: ["workClass"],
    approxCardinality: "Exactly 5 — same fixed WorkClass enum.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  db_pool_work_class_wait_ms: {
    name: "db_pool_work_class_wait_ms",
    type: "histogram",
    description:
      "How long a caller that had to queue for a database work-class slot (Issue #743) waited, in milliseconds — the 'saturation duration' operational signal. Only recorded for callers that actually queued (immediate, non-saturated acquisitions are not observed here); outcome distinguishes eventually acquiring a slot from timing out.",
    allowedLabelKeys: ["workClass", "outcome"],
    approxCardinality:
      "5 work classes x 2 outcomes (acquired, timeout) = 10 series bound.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  db_pool_capacity_configured_connections: {
    name: "db_pool_capacity_configured_connections",
    type: "gauge",
    description:
      "This process's configured Bun.SQL pool max, per database process class (Issue #743, src/lib/database/capacity-config.ts) — a per-process, per-class signal, refreshed whenever GET /api/v1/database/pool/health is called.",
    allowedLabelKeys: ["processClass"],
    approxCardinality:
      "Exactly 3 — the fixed ProcessClass enum (app, worker, setup).",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  db_pool_capacity_estimated_total_connections: {
    name: "db_pool_capacity_estimated_total_connections",
    type: "gauge",
    description:
      "sum(instance_count[class] x pool_max[class]) across every process class, as estimated from THIS process's own capacity configuration (Issue #743) — reported for both the 'expected' and worst-case 'max' configured instance-count scenarios.",
    allowedLabelKeys: ["scenario"],
    approxCardinality: "Exactly 2 — scenario is 'expected' or 'max'.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  db_pool_capacity_approved_budget: {
    name: "db_pool_capacity_approved_budget",
    type: "gauge",
    description:
      "The configured approved PostgreSQL/PgBouncer connection budget (DATABASE_CAPACITY_APPROVED_CONNECTIONS, Issue #743) this process is validating itself against — a single number, no labels.",
    allowedLabelKeys: [],
    approxCardinality: "Exactly 1 — unlabeled.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  job_run_total: {
    name: "job_run_total",
    type: "counter",
    description:
      "Count of shared worker-runner (src/lib/jobs/job-runner.ts) job runs, by job name and outcome status.",
    allowedLabelKeys: ["jobName", "status"],
    approxCardinality:
      "~20 known job names (one per `bun run <script>` job definition, a fixed set declared in package.json/module descriptors, never tenant input) x 6 JobStatus values ≈ ~120 series bound.",
    privacyNote:
      'jobName is the literal `JobDefinition.name` a script hardcodes at its own call site (e.g. "logs:audit:purge") — never a tenant id or per-run identifier. ' +
      PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  job_run_duration_ms: {
    name: "job_run_duration_ms",
    type: "histogram",
    description: "Shared worker-runner job run duration in milliseconds.",
    allowedLabelKeys: ["jobName"],
    approxCardinality: "~20 known job names.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  job_run_item_count: {
    name: "job_run_item_count",
    type: "gauge",
    description:
      "Latest per-run named item count reported by a job handler's JobHandlerResult.itemCounts (e.g. { purged: 120 }) — a backlog/throughput signal, not a cumulative total.",
    allowedLabelKeys: ["jobName", "itemName"],
    approxCardinality:
      '~20 known job names x a handful of code-defined counter names per job (e.g. "purged", "tenantsChecked") ≈ low hundreds bound — itemName is always a literal object key a job handler writes in its own source, never request/tenant-supplied.',
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  provider_call_total: {
    name: "provider_call_total",
    type: "counter",
    description:
      "Count of outbound provider/database calls observed through a circuit breaker (src/lib/database/circuit-breaker.ts), by provider family and outcome.",
    allowedLabelKeys: ["provider", "outcome"],
    approxCardinality:
      "~10 known provider families (database, email, object-storage, turnstile, tenant-domain-cloudflare-dns, sso-oidc-discovery, sso-oidc-jwks, sso-oidc-token, google-oauth-token, google-oauth-jwks) x 2 outcomes ≈ ~20 series bound.",
    privacyNote:
      '`provider` is derived by `deriveProviderFamilyLabel` (circuit-breaker.ts), which keeps only the literal, code-hardcoded prefix before the first ":" of a breaker\'s registry key — e.g. "sso-oidc-discovery:<tenantId>:<providerKey>" becomes just "sso-oidc-discovery". This is the specific mechanism that keeps a per-tenant-scoped breaker key (Issue #610) from ever reaching a metric label. ' +
      PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  provider_call_duration_ms: {
    name: "provider_call_duration_ms",
    type: "histogram",
    description: "Outbound provider/database call latency in milliseconds.",
    allowedLabelKeys: ["provider"],
    approxCardinality: "~10 known provider families.",
    privacyNote:
      "Same `deriveProviderFamilyLabel` bounding as provider_call_total. " +
      PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  provider_circuit_state: {
    name: "provider_circuit_state",
    type: "gauge",
    description:
      "Current circuit-breaker state per provider family, encoded 0=closed, 1=half_open, 2=open.",
    allowedLabelKeys: ["provider"],
    approxCardinality: "~10 known provider families.",
    privacyNote:
      "Same `deriveProviderFamilyLabel` bounding as provider_call_total. " +
      PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  // Issue #742 (epic #738 platform-evolution) — domain-event-runtime
  // outbox/dispatcher observability. `consumerName` is always one of the
  // small, fixed, code-defined `DOMAIN_EVENT_CONSUMERS` registry entries
  // (`src/modules/domain-event-runtime/infrastructure/consumer-registry.ts`)
  // — never tenant/request input, same bounding rationale as `jobName`
  // above.
  domain_event_dispatch_total: {
    name: "domain_event_dispatch_total",
    type: "counter",
    description:
      "Count of domain-event delivery dispatch attempts, by consumer and outcome (delivered/retried/dead_letter/skipped) — also the source for retry-rate (retried / total).",
    allowedLabelKeys: ["consumerName", "outcome"],
    approxCardinality:
      "A handful of registered consumer names (2 today) x 4 outcome values ≈ low tens of series.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  domain_event_delivery_backlog: {
    name: "domain_event_delivery_backlog",
    type: "gauge",
    description:
      "Current count of domain-event deliveries per consumer in a non-terminal-success state — status=pending is consumer lag/checkpoint distance, status=dead_letter is the DLQ count.",
    allowedLabelKeys: ["consumerName", "status"],
    approxCardinality:
      "A handful of registered consumer names (2 today) x 2 status values (pending, dead_letter) ≈ low tens of series.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  domain_event_delivery_oldest_pending_seconds: {
    name: "domain_event_delivery_oldest_pending_seconds",
    type: "gauge",
    description:
      "Age in seconds of the oldest still-pending domain-event delivery per consumer — outbox lag signal.",
    allowedLabelKeys: ["consumerName"],
    approxCardinality: "A handful of registered consumer names (2 today).",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  // Issue #746 (epic #738 platform-evolution Wave 2) — business-scope
  // assignments/SoD observability. `scopeType` is a small, code-defined
  // set today (only "office" resolves) but is technically operator/
  // deployment-declared (a future organization module could register more)
  // — bounded by convention (short lowercase snake_case identifiers,
  // never a UUID/tenant id), same class of bound `provider`/`jobName`
  // already rely on.
  business_scope_assignments_active: {
    name: "business_scope_assignments_active",
    type: "gauge",
    description:
      "Current count of active business-scope assignments, by scopeType.",
    allowedLabelKeys: ["scopeType"],
    approxCardinality:
      'A handful of scope types in practice (1 today: "office").',
    privacyNote:
      'scopeType is a short, code-defined identifier (e.g. "office") declared by the owning capability — never a scopeId, tenant id, or subject id. ' +
      PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  business_scope_assignments_temporary: {
    name: "business_scope_assignments_temporary",
    type: "gauge",
    description:
      "Current count of active, temporary (isTemporary=true) business-scope assignments, by scopeType.",
    allowedLabelKeys: ["scopeType"],
    approxCardinality: "Same bound as business_scope_assignments_active.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  business_scope_expirations_total: {
    name: "business_scope_expirations_total",
    type: "counter",
    description:
      "Count of business-scope assignments/exceptions transitioned to expired by the scheduled expiry job, by itemType.",
    allowedLabelKeys: ["itemType"],
    approxCardinality: 'Exactly 2 — itemType is "assignment" or "exception".',
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  business_scope_cross_tenant_denied_total: {
    name: "business_scope_cross_tenant_denied_total",
    type: "counter",
    description:
      "Count of cross-tenant business-scope/hierarchy resolution attempts denied by RLS/ABAC tenant isolation.",
    allowedLabelKeys: [],
    approxCardinality: "Exactly 1 — unlabeled.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  sod_conflicts_detected_total: {
    name: "sod_conflicts_detected_total",
    type: "counter",
    description:
      "Count of segregation-of-duties conflict evaluations that detected a conflict, by ruleKey and resolvedVia.",
    allowedLabelKeys: ["ruleKey", "resolvedVia"],
    approxCardinality:
      "A handful of registered SoD rule keys (3 today) x 3 resolvedVia values (none, exception, denied) ≈ low tens of series.",
    privacyNote:
      'ruleKey is the literal, code-declared SoDRuleDescriptor.ruleKey (e.g. "data_lifecycle.legal_hold_maker_checker") — never a tenant/subject id. ' +
      PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  sod_exceptions_granted_total: {
    name: "sod_exceptions_granted_total",
    type: "counter",
    description: "Count of SoD conflict exceptions approved, by ruleKey.",
    allowedLabelKeys: ["ruleKey"],
    approxCardinality: "A handful of registered SoD rule keys (3 today).",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  // Issue #747 (epic #738 platform-evolution) — workflow-approval managed
  // definitions/escalation observability.
  workflow_instances_active_total: {
    name: "workflow_instances_active_total",
    type: "gauge",
    description:
      "Current count of `pending` workflow instances for a tenant, sampled by the escalation/timeout job's own pass.",
    allowedLabelKeys: [],
    approxCardinality:
      "Exactly 1 — unlabeled (one value per emitting process per tenant iteration, not itself a label).",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  workflow_tasks_overdue_total: {
    name: "workflow_tasks_overdue_total",
    type: "gauge",
    description:
      "Current count of `pending` workflow tasks past their `due_at`, sampled by the escalation/timeout job's own pass.",
    allowedLabelKeys: [],
    approxCardinality: "Exactly 1 — unlabeled.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  workflow_task_decision_duration_ms: {
    name: "workflow_task_decision_duration_ms",
    type: "histogram",
    description:
      "Wall-clock duration of recording a workflow task decision (POST /api/v1/workflows/tasks/{id}/decisions), by outcome.",
    allowedLabelKeys: ["outcome"],
    approxCardinality: "Exactly 2 — outcome is 'approved' or 'rejected'.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  workflow_escalation_total: {
    name: "workflow_escalation_total",
    type: "counter",
    description:
      "Count of workflow tasks escalated by the scheduled escalation/timeout job (`bun run workflow:escalations:dispatch`).",
    allowedLabelKeys: [],
    approxCardinality: "Exactly 1 — unlabeled.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  workflow_recovery_action_total: {
    name: "workflow_recovery_action_total",
    type: "counter",
    description:
      "Count of administrative recovery actions (reassign/cancel/force-decision) recorded against workflow tasks/instances.",
    allowedLabelKeys: ["action"],
    approxCardinality:
      "Exactly 3 — action is 'reassign', 'cancel', or 'force_decide'.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  // Issue #748 (epic #738 platform-evolution) — profile_identity party
  // lifecycle/duplicate/merge privacy-safe operational counters. Every
  // label is a small, fixed, code-defined enum — never a profile id,
  // tenant id, display name, or identifier value.
  profile_identity_party_lifecycle_total: {
    name: "profile_identity_party_lifecycle_total",
    type: "counter",
    description:
      "Count of party (person/organization) lifecycle transitions, by action.",
    allowedLabelKeys: ["action"],
    approxCardinality:
      "Exactly 4 — the fixed action enum (create, update, archive, restore).",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  profile_identity_duplicate_candidate_total: {
    name: "profile_identity_duplicate_candidate_total",
    type: "counter",
    description:
      "Count of duplicate-candidate rows generated or reviewed, by match basis and resulting status.",
    allowedLabelKeys: ["matchBasis", "status"],
    approxCardinality:
      "3 match-basis values x 3 status values = 9 series bound.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  profile_identity_merge_total: {
    name: "profile_identity_merge_total",
    type: "counter",
    description:
      "Count of profile merge workflow transitions, by outcome (requested, approved, rejected, executed, cross_tenant_rejected).",
    allowedLabelKeys: ["outcome"],
    approxCardinality: "Exactly 5 — the fixed outcome enum.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  // Issue #749 (epic #738 platform-evolution Wave 2) — organization_
  // structure active-units/hierarchy-depth/invalid-attempt/expiring-
  // assignment observability. Every label is a small, fixed, code-defined
  // enum — never a tenant id, unit id, or legal entity id.
  organization_structure_active_units_total: {
    name: "organization_structure_active_units_total",
    type: "gauge",
    description:
      "Current count of active (not soft-deleted, status=active, within effective dates) organization units for a tenant, sampled by the metrics-snapshot job's own pass.",
    allowedLabelKeys: [],
    approxCardinality:
      "Exactly 1 — unlabeled (one value per emitting process per tenant iteration, not itself a label).",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  organization_structure_hierarchy_max_depth: {
    name: "organization_structure_hierarchy_max_depth",
    type: "gauge",
    description:
      "Deepest current organization-unit hierarchy chain for a tenant (root = depth 0), sampled by the metrics-snapshot job's own pass.",
    allowedLabelKeys: [],
    approxCardinality: "Exactly 1 — unlabeled.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  organization_structure_hierarchy_invalid_attempts_total: {
    name: "organization_structure_hierarchy_invalid_attempts_total",
    type: "counter",
    description:
      "Count of rejected organization-unit hierarchy write attempts, by reason (self_parent, cycle, invalid_period, cross_tenant, max_depth_exceeded) — incremented on EVERY validator rejection, not just accepted writes.",
    allowedLabelKeys: ["reason"],
    approxCardinality:
      "Exactly 5 — the fixed HierarchyValidationError reason enum.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  },
  organization_structure_assignments_expiring_total: {
    name: "organization_structure_assignments_expiring_total",
    type: "gauge",
    description:
      "Current count of active organization-unit assignments whose effectiveTo falls within the near-term expiring-soon window, sampled by the metrics-snapshot job's own pass.",
    allowedLabelKeys: [],
    approxCardinality: "Exactly 1 — unlabeled.",
    privacyNote: PRIVACY_NOTE_CODE_DEFINED_ENUM
  }
} as const satisfies Record<string, MetricDefinition>;

export type MetricName = keyof typeof METRIC_DEFINITIONS;

/** Shared latency bucket boundaries (milliseconds) — adapters that render a real histogram (e.g. Prometheus `_bucket` series) should use these so every deployment's dashboards/alerts agree on bucket edges. Purely a convention for adapters; `observeHistogram` itself takes the raw value. */
export const DEFAULT_HISTOGRAM_BUCKETS_MS: readonly number[] = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000
];

/** Total no-op adapter — the default, and what `setMetricsPort(null)` restores. Every offline/LAN deployment that never registers a real adapter runs this and only this: no I/O, no external collector, no behavior change. */
export function createNoopMetricsPort(): MetricsPort {
  return {
    incrementCounter() {},
    observeHistogram() {},
    setGauge() {}
  };
}

let registeredPort: MetricsPort = createNoopMetricsPort();

/** Registers a real adapter (Prometheus, OpenTelemetry, anything implementing `MetricsPort`). Pass `null` to restore the no-op default. Mirrors `setLogSink`/`getLogSink`. */
export function setMetricsPort(port: MetricsPort | null): void {
  registeredPort = port ?? createNoopMetricsPort();
}

export function getMetricsPort(): MetricsPort {
  return registeredPort;
}

/** Test-only reset so adapter registration from one test case never leaks into the next. */
export function resetMetricsPortForTests(): void {
  registeredPort = createNoopMetricsPort();
}

/** Drops any label key not declared in `allowedLabelKeys` for `name` — defense in depth, so a call-site bug can never let an unreviewed (and possibly high-cardinality or privacy-sensitive) label key reach an adapter. */
function filterLabels(name: MetricName, labels: MetricLabels): MetricLabels {
  const allowed = METRIC_DEFINITIONS[name].allowedLabelKeys;
  const filtered: MetricLabels = {};

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(labels, key)) {
      filtered[key] = labels[key]!;
    }
  }

  return filtered;
}

/**
 * Reports an adapter's own thrown error the same safe way `logger.ts`
 * reports a broken `LogSink` — sanitized, never re-thrown. A metrics
 * adapter must never be able to break the request/job it is observing.
 */
function reportAdapterError(operation: string, error: unknown): void {
  console.error(
    `Metrics adapter threw on ${operation} — ignoring (Issue #698 extension point):`,
    safeErrorDetail(error)
  );
}

/** The only sanctioned way to emit a counter increment. */
export function recordCounter(
  name: MetricName,
  labels: MetricLabels = {},
  value = 1
): void {
  try {
    registeredPort.incrementCounter(name, filterLabels(name, labels), value);
  } catch (error) {
    reportAdapterError("incrementCounter", error);
  }
}

/** The only sanctioned way to emit a histogram observation (a duration in milliseconds, by convention). */
export function recordHistogram(
  name: MetricName,
  valueMs: number,
  labels: MetricLabels = {}
): void {
  try {
    registeredPort.observeHistogram(name, valueMs, filterLabels(name, labels));
  } catch (error) {
    reportAdapterError("observeHistogram", error);
  }
}

/** The only sanctioned way to set a gauge's current value. */
export function recordGauge(
  name: MetricName,
  value: number,
  labels: MetricLabels = {}
): void {
  try {
    registeredPort.setGauge(name, value, filterLabels(name, labels));
  } catch (error) {
    reportAdapterError("setGauge", error);
  }
}
