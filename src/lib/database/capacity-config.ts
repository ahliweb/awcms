/**
 * Deployment-aware database capacity model (Issue #743, epic #738
 * platform-evolution, Wave 1). Depends on the merged extension-layers ADR
 * (Issue #739, `docs/adr/0013-extension-layers-and-boundary-model.md`) only
 * as context, not as an implementation dependency — this module is pure
 * runtime/config code, no architectural-layer coupling.
 *
 * ## Problem this closes
 *
 * `src/lib/database/client.ts` (Issue 10.2) and `work-class.ts` already size
 * and gate ONE process's own connection usage. Neither knows anything about
 * how many OTHER instances of the same process class are running elsewhere
 * in a horizontally-scaled deployment — so a per-process pool size that is
 * perfectly safe alone can still cause a connection storm once multiplied
 * across every instance:
 *
 * ```text
 * 10 application instances x pool_max 20 = 200 application connections
 * approved PgBouncer/PostgreSQL capacity = 80
 * result = connection storm during scale-out or restart
 * ```
 *
 * This module defines the typed configuration for that fleet-wide picture
 * (instance counts, pool budgets, PgBouncer capacity, the approved
 * PostgreSQL connection budget, and reserved administration headroom), a
 * pure calculator that sums them, and a validator that flags unsafe or
 * internally inconsistent combinations. It performs NO I/O and reaches no
 * database or network — `scripts/database-capacity-check.ts` and the new
 * `database:capacity` stage in `scripts/production-preflight.ts` are the
 * only callers that turn this into a CLI/preflight result, and both are
 * READ-ONLY: this module cannot change pool/database configuration, it can
 * only read `process.env` and report findings (issue's own non-negotiable
 * "preflight must not auto-change pool/DB config" requirement).
 *
 * ## Process class inventory (issue scope: "inventory every process that
 * opens PostgreSQL connections")
 *
 * - `app` — every web/SSR instance (`bun run start`/`preview`/`dev`), the
 *   `awcms_app` role, `DATABASE_URL`. Also the ONLY process class that
 *   `POST /api/v1/setup/initialize` runs inside of at request time (see
 *   `setup` below) — but that call is one-time/rare, not steady-state, so it
 *   is modeled as its OWN process class rather than folded into `app`.
 * - `worker` — the unattended background scripts that call
 *   `getWorkerDatabaseClient()` (`scripts/audit-log-purge.ts`,
 *   `form-draft-purge.ts`, `visitor-analytics-purge.ts`,
 *   `visitor-analytics-rollup.ts`, `email-dispatch.ts`,
 *   `object-sync-dispatch.ts`, `social-publish-dispatch.ts`,
 *   `blog-scheduled-publish.ts`, `news-media-r2-reconcile.ts` — verified via
 *   `grep -rl getWorkerDatabaseClient scripts/`, the same ground truth
 *   `scripts/work-class-registry-check.ts` uses), the `awcms_worker`
 *   role, `WORKER_DATABASE_URL`. Each job additionally serializes itself
 *   via a Postgres advisory lock (`src/lib/jobs/job-runner.ts`) — at most one
 *   instance of a GIVEN job name runs cluster-wide at a time — which is a
 *   real, already-existing mitigation this model does not re-implement; see
 *   `docs/awcms/database-capacity-runbook.md` for why job CONCURRENCY
 *   is exempted from the work-class gate while job CONNECTION BUDGET is
 *   still counted below.
 * - `setup` — `POST /api/v1/setup/initialize` only, the `awcms_setup`
 *   role, `SETUP_DATABASE_URL`. Meaningfully invoked once per deployment.
 *
 * Explicitly EXEMPTED, with rationale (issue's own "or explicitly exempted"
 * clause):
 *
 * - **Migration/backup/restore CLI tools** (`bun run db:migrate`,
 *   `deploy/backup/*.sh`) — connect ad hoc with a privileged/superuser URL
 *   passed on the command line, never through a named pool, and are
 *   operator-serialized by construction (nobody runs two migrations at
 *   once against the same database). They draw from `reservedAdminHeadroom`
 *   below, not from `app`/`worker`/`setup`'s steady-state pool budgets — see
 *   `reservedAdminHeadroom`'s own doc comment.
 * - **Test/CI processes** (`bun test`, the CI workflow's ephemeral
 *   `postgres:18.4` service) — run against an isolated test/CI database
 *   with its own independent `max_connections`, never sharing budget with
 *   any real deployment this model validates.
 */
import type { ClientKind } from "./client";
import { resolvePoolMaxForKind } from "./client";
import { getWorkClassLimits } from "./work-class";
import { recordGauge } from "../observability/metrics-port";

export type ProcessClass = ClientKind;

export const PROCESS_CLASSES: readonly ProcessClass[] = [
  "app",
  "worker",
  "setup"
];

export type InstanceCountConfig = {
  min: number;
  expected: number;
  max: number;
};

export type PgBouncerCapacityConfig = {
  enabled: boolean;
  /** `pgbouncer.ini`'s `max_client_conn` — the ceiling on app-side connections PgBouncer will accept. */
  maxClientConnections: number;
  /** `pgbouncer.ini`'s `default_pool_size` — the ceiling on PgBouncer's OWN backend connections to real PostgreSQL. */
  defaultPoolSize: number;
};

export type CapacityConfig = {
  instanceCounts: Record<ProcessClass, InstanceCountConfig>;
  /** Effective `Bun.SQL` pool `max` per process class — read via `resolvePoolMaxForKind` (client.ts), the SAME function `buildClient` uses, so this can never drift from the pool the runtime actually opens. */
  poolMax: Record<ProcessClass, number>;
  pgBouncer: PgBouncerCapacityConfig;
  /** Approved PostgreSQL (or, when PgBouncer is enabled, PgBouncer-fronted PostgreSQL) connection budget — e.g. `max_connections` minus whatever the hosting provider/DBA has approved for THIS application. */
  approvedConnections: number;
  /** Connections carved out for admin/migration/backup-restore recovery (see module header) — MUST NOT be consumed by app/worker/setup steady-state sizing; enforced structurally by `computeCapacityUsage`'s formula (it is added, not subtracted, to the "must fit" side). */
  reservedAdminHeadroom: number;
};

const DEFAULT_INSTANCE_COUNTS: Record<ProcessClass, InstanceCountConfig> = {
  // LAN-first single-instance default (doc 18 topology) — one app instance.
  app: { min: 1, expected: 1, max: 1 },
  // Worker scripts are periodic CLI invocations, not always-running daemons
  // — "0 concurrently running" is the true steady-state floor.
  worker: { min: 0, expected: 1, max: 1 },
  // The setup wizard is meaningfully invoked once per deployment lifetime.
  setup: { min: 0, expected: 0, max: 1 }
};

const DEFAULT_PGBOUNCER_MAX_CLIENT_CONN = 200;
const DEFAULT_PGBOUNCER_DEFAULT_POOL_SIZE = 20;
// PostgreSQL's own documented default `max_connections` — a conservative,
// widely-applicable assumption for a deployment that has not overridden
// postgresql.conf (the offline/LAN-first default profile, doc 18).
const DEFAULT_APPROVED_CONNECTIONS = 100;
// Comfortably above PostgreSQL's own default `superuser_reserved_connections`
// (3), leaving room for one interactive admin/migration session plus a
// small margin — see `reservedAdminHeadroom`'s doc comment above.
const DEFAULT_RESERVED_ADMIN_HEADROOM = 5;

const INSTANCE_COUNT_MIN = 0;
const INSTANCE_COUNT_MAX = 10_000;
const CONNECTION_BUDGET_MIN = 0;
const CONNECTION_BUDGET_MAX = 1_000_000;

/**
 * Never throws — an unparseable/out-of-range value silently falls back to
 * `fallback`, the same "a malformed env var must never crash boot" contract
 * `client.ts`'s `resolvePoolMaxForKind` already established for
 * `DATABASE_POOL_MAX`. `validateCapacityConfig`/`database:capacity:check`
 * are where an operator is told something looks wrong — never a thrown
 * exception from a config loader.
 */
function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return fallback;
  }

  if (parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

function loadInstanceCounts(
  processClass: ProcessClass,
  env: Record<string, string | undefined>
): InstanceCountConfig {
  const prefix = `DATABASE_CAPACITY_${processClass.toUpperCase()}_INSTANCES_`;
  const defaults = DEFAULT_INSTANCE_COUNTS[processClass];

  return {
    min: parseBoundedInt(
      env[`${prefix}MIN`],
      defaults.min,
      INSTANCE_COUNT_MIN,
      INSTANCE_COUNT_MAX
    ),
    expected: parseBoundedInt(
      env[`${prefix}EXPECTED`],
      defaults.expected,
      INSTANCE_COUNT_MIN,
      INSTANCE_COUNT_MAX
    ),
    max: parseBoundedInt(
      env[`${prefix}MAX`],
      defaults.max,
      INSTANCE_COUNT_MIN,
      INSTANCE_COUNT_MAX
    )
  };
}

/**
 * Reads every Issue #743 capacity env var (all optional, all with
 * conservative defaults matching the existing single-instance offline/LAN
 * profile — see each `DEFAULT_*` constant above) plus the SAME
 * `resolvePoolMaxForKind`/`DATABASE_POOL_MAX*` variables `client.ts` uses
 * for the real pool, so this can never silently disagree with the pool the
 * process actually opens. Pure — no I/O, no thrown exceptions.
 */
export function loadCapacityConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): CapacityConfig {
  const instanceCounts = Object.fromEntries(
    PROCESS_CLASSES.map((processClass) => [
      processClass,
      loadInstanceCounts(processClass, env)
    ])
  ) as Record<ProcessClass, InstanceCountConfig>;

  const poolMax = Object.fromEntries(
    PROCESS_CLASSES.map((processClass) => [
      processClass,
      resolvePoolMaxForKind(processClass, env)
    ])
  ) as Record<ProcessClass, number>;

  return {
    instanceCounts,
    poolMax,
    pgBouncer: {
      enabled: env.DATABASE_PGBOUNCER === "true",
      maxClientConnections: parseBoundedInt(
        env.DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN,
        DEFAULT_PGBOUNCER_MAX_CLIENT_CONN,
        1,
        CONNECTION_BUDGET_MAX
      ),
      defaultPoolSize: parseBoundedInt(
        env.DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE,
        DEFAULT_PGBOUNCER_DEFAULT_POOL_SIZE,
        1,
        CONNECTION_BUDGET_MAX
      )
    },
    approvedConnections: parseBoundedInt(
      env.DATABASE_CAPACITY_APPROVED_CONNECTIONS,
      DEFAULT_APPROVED_CONNECTIONS,
      1,
      CONNECTION_BUDGET_MAX
    ),
    reservedAdminHeadroom: parseBoundedInt(
      env.DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS,
      DEFAULT_RESERVED_ADMIN_HEADROOM,
      CONNECTION_BUDGET_MIN,
      CONNECTION_BUDGET_MAX
    )
  };
}

export type CapacityFindingSeverity = "fail" | "warning";

export type CapacityFinding = {
  severity: CapacityFindingSeverity;
  /** Stable machine-readable code, e.g. for tests/alerting — never a raw DSN/tenant id (this module never touches either). */
  code: string;
  message: string;
};

/**
 * Pure structural/logical validation of a `CapacityConfig` — catches
 * "unsafe or internally inconsistent values" (issue's own non-negotiable
 * requirement) independent of whether they also blow the approved budget
 * (that cross-check is `evaluateCapacityBudget` below). Every finding here
 * is derived only from already-resolved integers/booleans — never a DSN,
 * never a tenant id, so this is safe to print verbatim in CI/preflight
 * output.
 */
export function validateCapacityConfig(
  config: CapacityConfig
): CapacityFinding[] {
  const findings: CapacityFinding[] = [];

  for (const processClass of PROCESS_CLASSES) {
    const counts = config.instanceCounts[processClass];

    if (!(counts.min <= counts.expected && counts.expected <= counts.max)) {
      findings.push({
        severity: "fail",
        code: `instance_count_order:${processClass}`,
        message:
          `${processClass} instance counts are internally inconsistent: ` +
          `min (${counts.min}) <= expected (${counts.expected}) <= max (${counts.max}) does not hold.`
      });
    }

    const poolMax = config.poolMax[processClass];

    if (!(Number.isInteger(poolMax) && poolMax > 0)) {
      findings.push({
        severity: "fail",
        code: `pool_max_invalid:${processClass}`,
        message: `${processClass} pool max (${poolMax}) must be a positive integer.`
      });
    }

    if (counts.max > 0 && poolMax <= 0) {
      findings.push({
        severity: "fail",
        code: `pool_max_zero_with_instances:${processClass}`,
        message: `${processClass} allows up to ${counts.max} instance(s) but has a pool max of ${poolMax} — every instance would open zero connections.`
      });
    }
  }

  if (config.pgBouncer.enabled) {
    if (
      config.pgBouncer.defaultPoolSize > config.pgBouncer.maxClientConnections
    ) {
      findings.push({
        severity: "fail",
        code: "pgbouncer_pool_exceeds_client_conn",
        message:
          `PgBouncer default_pool_size (${config.pgBouncer.defaultPoolSize}) exceeds ` +
          `max_client_conn (${config.pgBouncer.maxClientConnections}) — an internally inconsistent PgBouncer profile.`
      });
    }
  }

  if (config.reservedAdminHeadroom >= config.approvedConnections) {
    findings.push({
      severity: "fail",
      code: "reserved_headroom_exceeds_budget",
      message:
        `Reserved admin headroom (${config.reservedAdminHeadroom}) leaves no room ` +
        `in the approved connection budget (${config.approvedConnections}) for any runtime pool.`
    });
  }

  // Non-blocking cross-check: does any process class's work-class
  // concurrency ceiling oversubscribe that process's own physical pool?
  // See work-class.ts's header comment for why this is a WARNING, not a
  // FAIL, by design.
  const workClassTotal = getWorkClassLimits().reduce(
    (sum, limit) => sum + limit.maxConcurrency,
    0
  );
  const appPoolMax = config.poolMax.app;

  if (workClassTotal > appPoolMax) {
    findings.push({
      severity: "warning",
      code: "work_class_oversubscribes_app_pool",
      message:
        `Combined work-class concurrency ceilings (${workClassTotal}) exceed the "app" pool max ` +
        `(${appPoolMax}) — an intentional, documented oversubscription (see work-class.ts), ` +
        "not a hard failure; consider raising DATABASE_POOL_MAX if this process is latency-sensitive under load."
    });
  }

  return findings;
}

export type ProcessClassUsage = {
  processClass: ProcessClass;
  instanceCount: number;
  poolMax: number;
  connections: number;
};

export type CapacityScenario = "expected" | "max";

export type CapacityUsage = {
  scenario: CapacityScenario;
  perClass: ProcessClassUsage[];
  totalConnections: number;
};

/**
 * Pure calculator: `sum(instance_count[class] x pool_max[class])` per the
 * issue's own formula, for one instance-count scenario ("expected" = the
 * steady-state operator intent, "max" = the configured horizontal ceiling —
 * `evaluateCapacityBudget` below gates on "max", the conservative,
 * worst-case reading of "before horizontal deployment").
 */
export function computeCapacityUsage(
  config: CapacityConfig,
  scenario: CapacityScenario
): CapacityUsage {
  const perClass = PROCESS_CLASSES.map((processClass) => {
    const instanceCount = config.instanceCounts[processClass][scenario];
    const poolMax = config.poolMax[processClass];

    return {
      processClass,
      instanceCount,
      poolMax,
      connections: instanceCount * poolMax
    };
  });

  return {
    scenario,
    perClass,
    totalConnections: perClass.reduce(
      (sum, entry) => sum + entry.connections,
      0
    )
  };
}

export type CapacityBudgetReport = {
  ok: boolean;
  findings: CapacityFinding[];
  expected: CapacityUsage;
  worstCase: CapacityUsage;
  approvedConnections: number;
  reservedAdminHeadroom: number;
  /** `approvedConnections - reservedAdminHeadroom` — what app/worker/setup pools may actually use. */
  availableForRuntime: number;
  pgBouncer: PgBouncerCapacityConfig;
  exceedsAtExpected: boolean;
  exceedsAtMax: boolean;
};

/**
 * The read-only, preflight-facing entry point — combines
 * `validateCapacityConfig` with the issue's core formula:
 *
 * ```text
 * sum(instance_count[class] x pool_max[class]) + reserved_headroom
 *   <= approved PgBouncer/PostgreSQL capacity
 * ```
 *
 * ## PgBouncer vs. direct-PostgreSQL profiles (issue requirement: "Account
 * explicitly for PgBouncer transaction-pooling versus direct PostgreSQL
 * profiles")
 *
 * - **Direct PostgreSQL** (`pgBouncer.enabled === false`, the offline/LAN
 *   default): every `app`/`worker`/`setup` pool connection IS a real
 *   PostgreSQL backend connection, so the formula above is checked directly
 *   against `approvedConnections` (assumed to be that PostgreSQL server's
 *   own approved `max_connections` budget).
 * - **PgBouncer transaction pooling** (`pgBouncer.enabled === true`): TWO
 *   separate checks apply, because PgBouncer sits between the application
 *   and PostgreSQL and multiplexes many client-side connections onto far
 *   fewer server-side ones:
 *   1. App-side: `sum(instance_count x pool_max)` must fit within
 *      `pgBouncer.maxClientConnections` (`max_client_conn`) — PgBouncer
 *      itself refuses new client connections past that ceiling.
 *   2. Server-side: `pgBouncer.defaultPoolSize + reservedAdminHeadroom` must
 *      fit within `approvedConnections` — PgBouncer's OWN backend
 *      connections to real PostgreSQL (bounded by `default_pool_size`,
 *      independent of how many app-side clients are multiplexed onto them)
 *      are what actually count against the PostgreSQL server's budget.
 *
 * `exceedsAtExpected`/`exceedsAtMax` are computed the same way in both
 * profiles; `ok` gates on the worst-case ("max") scenario only — the issue
 * frames this as "before horizontal deployment", i.e. "if you scale up to
 * your configured ceiling, does it still fit", not merely today's expected
 * usage.
 */
export function evaluateCapacityBudget(
  config: CapacityConfig = loadCapacityConfigFromEnv()
): CapacityBudgetReport {
  const findings = validateCapacityConfig(config);
  const expected = computeCapacityUsage(config, "expected");
  const worstCase = computeCapacityUsage(config, "max");
  const availableForRuntime = Math.max(
    0,
    config.approvedConnections - config.reservedAdminHeadroom
  );

  function exceedsBudget(usage: CapacityUsage): boolean {
    if (config.pgBouncer.enabled) {
      const appSideOk =
        usage.totalConnections <= config.pgBouncer.maxClientConnections;
      const serverSideOk =
        config.pgBouncer.defaultPoolSize + config.reservedAdminHeadroom <=
        config.approvedConnections;

      return !appSideOk || !serverSideOk;
    }

    return usage.totalConnections > availableForRuntime;
  }

  const exceedsAtExpected = exceedsBudget(expected);
  const exceedsAtMax = exceedsBudget(worstCase);

  if (exceedsAtMax) {
    findings.push({
      severity: "fail",
      code: "capacity_exceeds_budget_at_max",
      message: config.pgBouncer.enabled
        ? `At the configured max instance counts, app-side connections (${worstCase.totalConnections}) or ` +
          `PgBouncer's backend pool (${config.pgBouncer.defaultPoolSize} + ${config.reservedAdminHeadroom} reserved) ` +
          `would exceed the approved capacity (client cap ${config.pgBouncer.maxClientConnections}, approved ${config.approvedConnections}).`
        : `At the configured max instance counts, sum(instance_count x pool_max) = ${worstCase.totalConnections} ` +
          `would leave less than the reserved admin headroom (${config.reservedAdminHeadroom}) free within the ` +
          `approved connection budget (${config.approvedConnections}) — connection-storm risk on scale-out/restart.`
    });
  }

  const ok = findings.every((finding) => finding.severity !== "fail");

  return {
    ok,
    findings,
    expected,
    worstCase,
    approvedConnections: config.approvedConnections,
    reservedAdminHeadroom: config.reservedAdminHeadroom,
    availableForRuntime,
    pgBouncer: config.pgBouncer,
    exceedsAtExpected,
    exceedsAtMax
  };
}

/**
 * Issue #743 — refreshes the `db_pool_capacity_*` gauges
 * (`src/lib/observability/metrics-port.ts`) from one evaluation. Shared by
 * `scripts/database-capacity-check.ts` and
 * `GET /api/v1/database/pool/health` so both call sites feed the same
 * metric names/labels. Safe to call repeatedly (gauges, not counters);
 * no-op under the default no-op MetricsPort adapter.
 */
export function emitCapacityGauges(report: CapacityBudgetReport): void {
  for (const entry of report.expected.perClass) {
    recordGauge("db_pool_capacity_configured_connections", entry.poolMax, {
      processClass: entry.processClass
    });
  }

  recordGauge(
    "db_pool_capacity_estimated_total_connections",
    report.expected.totalConnections,
    { scenario: "expected" }
  );
  recordGauge(
    "db_pool_capacity_estimated_total_connections",
    report.worstCase.totalConnections,
    { scenario: "max" }
  );
  recordGauge("db_pool_capacity_approved_budget", report.approvedConnections);
}
