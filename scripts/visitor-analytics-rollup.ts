/**
 * visitor-analytics-rollup.ts — `bun run analytics:rollup`.
 *
 * Scheduled worker entrypoint for `rollupVisitorAnalyticsForDate`
 * (`src/modules/visitor-analytics/application/rollup.ts`). Recomputes the
 * target UTC date's `awcms_visitor_daily_rollups` from raw
 * `awcms_visit_events`, for every active tenant. Idempotent by construction
 * (full UPSERT recompute), so re-running a date never double-counts.
 *
 * Built on the shared job runner (`src/lib/jobs/job-runner.ts`): advisory
 * lock (two concurrent runs cannot collide), timeout, SIGTERM/SIGINT-aware
 * cancellation, JSON telemetry, meaningful exit code. Pure PostgreSQL
 * operation, safe in offline/LAN deployments. Runs as the least-privilege
 * `awcms_worker` role (sql/022) when `WORKER_DATABASE_URL` is configured.
 *
 * Target date resolution:
 *   1. `--date=YYYY-MM-DD` CLI flag
 *   2. yesterday (UTC) — the most recent fully-elapsed day
 *
 * `--dry-run` reports the tenant count without writing any rollup row.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import {
  applyJobExitCode,
  formatJobOutcomeLine,
  isJobResultOk,
  parseJobCliArgs,
  printJobTelemetry,
  runJob,
  writeJobTelemetry,
  type JobContext
} from "../src/lib/jobs/job-runner";
import { fetchActiveTenants } from "../src/lib/jobs/batching";
import { rollupVisitorAnalyticsForDate } from "../src/modules/visitor-analytics/application/rollup";
import { DatabaseBusyError } from "../src/lib/database/tenant-context";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Yesterday (UTC) as `YYYY-MM-DD` — the most recent fully-elapsed day. */
export function resolveDefaultRollupDate(now: Date = new Date()): string {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return yesterday.toISOString().slice(0, 10);
}

export function resolveRollupDate(
  argv: string[] = process.argv,
  now: Date = new Date()
): string {
  const flag = argv.find((arg) => arg.startsWith("--date="));
  const value = flag?.split("=")[1];

  if (
    value &&
    DATE_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  ) {
    return value;
  }

  return resolveDefaultRollupDate(now);
}

export type VisitorAnalyticsRollupResult = {
  date: string;
  tenantsChecked: number;
  tenantsRolledUp: number;
  areasProcessed: number;
  tenantsSkipped: number;
  /** Named, not just counted: `--date=` is the remedy and it needs the ids. */
  skippedTenantIds: string[];
};

export async function runVisitorAnalyticsRollup(
  sql: Bun.SQL,
  ctx: Pick<JobContext, "dryRun"> & Partial<Pick<JobContext, "signal">>,
  date: string
): Promise<VisitorAnalyticsRollupResult> {
  const tenants = await fetchActiveTenants(sql);

  if (ctx.dryRun) {
    return {
      date,
      tenantsChecked: tenants.length,
      tenantsRolledUp: 0,
      areasProcessed: 0,
      tenantsSkipped: 0,
      skippedTenantIds: []
    };
  }

  let tenantsRolledUp = 0;
  let areasProcessed = 0;
  const skippedTenantIds: string[] = [];

  for (const tenant of tenants) {
    if (ctx.signal?.aborted) {
      break;
    }

    // Finding D4 — this used to read
    // `if (result instanceof Response) { tenantsSkipped += 1; continue; }`,
    // and that branch was DEAD. `withTenant` returns a 503 `Response` on
    // backpressure; `withTenantOrThrow`, which is what this loop calls,
    // THROWS a `DatabaseBusyError` instead. So `tenantsSkipped` was
    // permanently 0, the `partial` warning built on it could never fire, and
    // — the part that actually cost something — a busy database abandoned
    // every REMAINING tenant instead of skipping one.
    //
    // The rollup targets a single day, so an abandoned run is a permanent
    // hole: tomorrow's pass rolls up tomorrow. That is why the ids are
    // collected and printed rather than counted — `--date=` is the remedy and
    // an operator needs to know which tenants to name.
    try {
      const result = await withTenantOrThrow(
        sql,
        tenant.id,
        (tx) => rollupVisitorAnalyticsForDate(tx, tenant.id, date),
        { workClass: "background_sync" }
      );

      tenantsRolledUp += 1;
      areasProcessed += result.areasProcessed;
    } catch (error) {
      // ONLY backpressure is a skip. Anything else is a defect in the rollup
      // and must reach the job runner, which classifies a thrown error as a
      // retryable failure — swallowing it would turn a broken query into a
      // quiet zero.
      if (!(error instanceof DatabaseBusyError)) throw error;

      skippedTenantIds.push(tenant.id);
    }
  }

  return {
    date,
    tenantsChecked: tenants.length,
    tenantsRolledUp,
    areasProcessed,
    tenantsSkipped: skippedTenantIds.length,
    skippedTenantIds
  };
}

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));
  const date = resolveRollupDate();

  try {
    const result = await runJob(
      {
        name: "analytics:rollup",
        description:
          "Recomputes awcms_visitor_daily_rollups for the target UTC date from raw awcms_visit_events, for every active tenant (idempotent UPSERT).",
        handler: async (ctx) => {
          const rollupResult = await runVisitorAnalyticsRollup(sql, ctx, date);
          const skipped = rollupResult.tenantsSkipped > 0;

          console.log(
            `analytics:rollup complete — correlationId=${ctx.correlationId} ` +
              `date=${rollupResult.date} tenants=${rollupResult.tenantsChecked} ` +
              `rolledUp=${rollupResult.tenantsRolledUp} areas=${rollupResult.areasProcessed}` +
              (ctx.dryRun ? " (dry-run: nothing was written)" : "") +
              (skipped
                ? ` (WARNING: ${rollupResult.tenantsSkipped} tenant(s) skipped — database busy; re-run with --date=${date} for: ${rollupResult.skippedTenantIds.join(", ")})`
                : "")
          );

          return {
            status: skipped ? "partial" : "success",
            itemCounts: {
              tenantsChecked: rollupResult.tenantsChecked,
              tenantsRolledUp: rollupResult.tenantsRolledUp,
              areasProcessed: rollupResult.areasProcessed,
              tenantsSkipped: rollupResult.tenantsSkipped
            },
            detail: skipped
              ? `${rollupResult.tenantsSkipped} tenant(s) skipped due to database backpressure`
              : undefined
          };
        }
      },
      { sql, dryRun: cliOptions.dryRun }
    );

    printJobTelemetry(result);
    await writeJobTelemetry(result, cliOptions.jsonOutputPath);

    if (!isJobResultOk(result)) {
      console.error(formatJobOutcomeLine(result));
    }

    applyJobExitCode(result);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
