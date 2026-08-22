/**
 * visitor-analytics-purge.ts — `bun run analytics:purge`.
 *
 * Scheduled worker entrypoint for `purgeVisitorAnalyticsData`
 * (`src/modules/visitor-analytics/application/retention-purge.ts`) — the same
 * function the on-demand `POST /api/v1/analytics/retention/purge` endpoint
 * calls, run here for every active tenant so retention is enforced without a
 * user action.
 *
 * Built on the shared job runner (`src/lib/jobs/job-runner.ts`): advisory
 * lock, timeout, SIGTERM/SIGINT-aware cancellation, JSON telemetry, exit
 * code. Pure PostgreSQL operation, safe in offline/LAN deployments. Runs as
 * the least-privilege `awcms_worker` role (sql/022) when
 * `WORKER_DATABASE_URL` is configured.
 *
 * Audit note (accepted asymmetry, base-consistent): unlike the on-demand
 * `POST /api/v1/analytics/retention/purge` endpoint (which writes a `critical`
 * audit event), this SCHEDULED run is not audited to `awcms_audit_events` — its
 * record of record is the job runner's JSON telemetry (job-telemetry-as-record),
 * the same posture as the other scheduled retention/rollup jobs in this base.
 *
 * Retention windows come from the module's env config
 * (VISITOR_ANALYTICS_EVENT_RETENTION_DAYS / _RAW_DETAIL_RETENTION_DAYS /
 * _ROLLUP_RETENTION_DAYS). `--dry-run` reports the tenant count without
 * deleting/clearing anything.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import {
  DatabaseBusyError,
  withTenantOrThrow
} from "../src/lib/database/tenant-context";
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
import {
  fetchActiveTenants,
  runBoundedBatches
} from "../src/lib/jobs/batching";
import { purgeVisitorAnalyticsData } from "../src/modules/visitor-analytics/application/retention-purge";
import {
  resolveVisitorAnalyticsConfig,
  type VisitorAnalyticsConfig
} from "../src/modules/visitor-analytics/domain/visitor-analytics-config";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";

export type VisitorAnalyticsPurgeResult = {
  tenantsChecked: number;
  eventsDeleted: number;
  sessionsRawDetailCleared: number;
  sessionsDeleted: number;
  rollupsDeleted: number;
  tenantsSkipped: number;
  /** Named, not just counted — a re-run needs to know which tenants still hold data past retention. */
  skippedTenantIds: string[];
  /** Finding C2 — tenants that hit the pass cap with work still to do. The next run continues them; silence here would read as "finished". */
  tenantsWithBacklog: string[];
};

export async function runVisitorAnalyticsPurge(
  sql: Bun.SQL,
  ctx: Pick<JobContext, "dryRun"> & Partial<Pick<JobContext, "signal">>,
  config: VisitorAnalyticsConfig,
  now: Date = new Date()
): Promise<VisitorAnalyticsPurgeResult> {
  const tenants = await fetchActiveTenants(sql);

  const totals: VisitorAnalyticsPurgeResult = {
    tenantsChecked: tenants.length,
    eventsDeleted: 0,
    sessionsRawDetailCleared: 0,
    sessionsDeleted: 0,
    rollupsDeleted: 0,
    tenantsSkipped: 0,
    skippedTenantIds: [],
    tenantsWithBacklog: []
  };

  if (ctx.dryRun) {
    return totals;
  }

  for (const tenant of tenants) {
    if (ctx.signal?.aborted) {
      break;
    }

    // Finding D4, second occurrence — `if (result instanceof Response)` was
    // DEAD here too. That shape only ever comes out of `withTenant`;
    // `withTenantOrThrow` THROWS `DatabaseBusyError`. So `tenantsSkipped` was
    // permanently 0, the summary's `(WARNING: … database busy)` clause could
    // never print, and a busy database abandoned every remaining tenant.
    //
    // The stakes here are higher than the rollup's. This job is what ENFORCES
    // retention: an abandoned run means every tenant after the first keeps
    // holding visitor data past its retention window, silently, until someone
    // notices the counts are too low — and the summary was reporting success.
    try {
      // Finding C2 — the purge is BATCHED now, so one pass is one bounded bite
      // and the loop is what finishes the job. A fresh transaction per pass is
      // the whole point: looping inside one transaction would hold every lock
      // and every dead tuple for the duration, which is the thing the batching
      // exists to avoid.
      //
      // `runBoundedBatches` caps the passes, so a tenant with a pathological
      // backlog cannot make this job run forever; whatever is left is picked up
      // by the next scheduled run.
      const outcome = await runBoundedBatches(
        async () => {
          const pass = await withTenantOrThrow(sql, tenant.id, (tx) =>
            purgeVisitorAnalyticsData(
              tx,
              tenant.id,
              config,
              now,
              legalHoldGuardPortAdapter
            )
          );

          totals.eventsDeleted += pass.eventsDeleted;
          totals.sessionsRawDetailCleared += pass.sessionsRawDetailCleared;
          totals.sessionsDeleted += pass.sessionsDeleted;
          totals.rollupsDeleted += pass.rollupsDeleted;

          // `count` drives the loop: zero ends it. `hasMore` alone would not,
          // because a pass that deletes nothing but is `hasMore` cannot exist —
          // and a pass that deletes something without being `hasMore` should
          // still stop.
          return { count: pass.hasMore ? 1 : 0 };
        },
        { signal: ctx.signal }
      );

      if (outcome.hitPassLimit) {
        totals.tenantsWithBacklog.push(tenant.id);
      }
    } catch (error) {
      // ONLY backpressure is a skip. A legal-hold refusal or a broken query is
      // a real failure and must reach the job runner, which classifies a
      // thrown error as a retryable failure — swallowing it would turn a
      // retention job that cannot run into a quiet zero.
      if (!(error instanceof DatabaseBusyError)) throw error;

      totals.tenantsSkipped += 1;
      totals.skippedTenantIds.push(tenant.id);
    }
  }

  return totals;
}

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));
  const config = resolveVisitorAnalyticsConfig();

  try {
    const result = await runJob(
      {
        name: "analytics:purge",
        description:
          "Deletes/clears visitor analytics data past its retention windows (events, session raw detail, sessions, rollups) for every active tenant.",
        handler: async (ctx) => {
          const purgeResult = await runVisitorAnalyticsPurge(sql, ctx, config);
          const skipped = purgeResult.tenantsSkipped > 0;
          // Finding C2 — the batching means "finished this pass" and "finished"
          // are now different states, and a run that stops with work left must
          // say so. A summary that reads identically either way is the same
          // false-success the D4/D5/D6 round was about.
          const backlog = purgeResult.tenantsWithBacklog.length > 0;

          console.log(
            `analytics:purge complete — correlationId=${ctx.correlationId} ` +
              `tenants=${purgeResult.tenantsChecked} eventsDeleted=${purgeResult.eventsDeleted} ` +
              `sessionsRawDetailCleared=${purgeResult.sessionsRawDetailCleared} ` +
              `sessionsDeleted=${purgeResult.sessionsDeleted} rollupsDeleted=${purgeResult.rollupsDeleted}` +
              (ctx.dryRun ? " (dry-run: nothing was deleted)" : "") +
              (skipped
                ? ` (WARNING: ${purgeResult.tenantsSkipped} tenant(s) skipped — database busy;` +
                  ` data past retention is STILL HELD for: ${purgeResult.skippedTenantIds.join(", ")})`
                : "") +
              (backlog
                ? ` (${purgeResult.tenantsWithBacklog.length} tenant(s) hit the pass cap with work remaining;` +
                  ` the next run continues them: ${purgeResult.tenantsWithBacklog.join(", ")})`
                : "")
          );

          return {
            status: skipped || backlog ? "partial" : "success",
            itemCounts: {
              tenantsChecked: purgeResult.tenantsChecked,
              eventsDeleted: purgeResult.eventsDeleted,
              sessionsRawDetailCleared: purgeResult.sessionsRawDetailCleared,
              sessionsDeleted: purgeResult.sessionsDeleted,
              rollupsDeleted: purgeResult.rollupsDeleted,
              tenantsSkipped: purgeResult.tenantsSkipped,
              tenantsWithBacklog: purgeResult.tenantsWithBacklog.length
            },
            detail: skipped
              ? `${purgeResult.tenantsSkipped} tenant(s) skipped due to database backpressure`
              : backlog
                ? `${purgeResult.tenantsWithBacklog.length} tenant(s) hit the pass cap with work remaining`
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
