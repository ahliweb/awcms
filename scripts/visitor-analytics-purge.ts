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
 * Retention windows come from the module's env config
 * (VISITOR_ANALYTICS_EVENT_RETENTION_DAYS / _RAW_DETAIL_RETENTION_DAYS /
 * _ROLLUP_RETENTION_DAYS). `--dry-run` reports the tenant count without
 * deleting/clearing anything.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { withTenant } from "../src/lib/database/tenant-context";
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
import { purgeVisitorAnalyticsData } from "../src/modules/visitor-analytics/application/retention-purge";
import {
  resolveVisitorAnalyticsConfig,
  type VisitorAnalyticsConfig
} from "../src/modules/visitor-analytics/domain/visitor-analytics-config";

export type VisitorAnalyticsPurgeResult = {
  tenantsChecked: number;
  eventsDeleted: number;
  sessionsRawDetailCleared: number;
  sessionsDeleted: number;
  rollupsDeleted: number;
  tenantsSkipped: number;
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
    tenantsSkipped: 0
  };

  if (ctx.dryRun) {
    return totals;
  }

  for (const tenant of tenants) {
    if (ctx.signal?.aborted) {
      break;
    }

    const result = await withTenant(sql, tenant.id, (tx) =>
      purgeVisitorAnalyticsData(tx, tenant.id, config, now)
    );

    if (result instanceof Response) {
      totals.tenantsSkipped += 1;
      continue;
    }

    totals.eventsDeleted += result.eventsDeleted;
    totals.sessionsRawDetailCleared += result.sessionsRawDetailCleared;
    totals.sessionsDeleted += result.sessionsDeleted;
    totals.rollupsDeleted += result.rollupsDeleted;
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

          console.log(
            `analytics:purge complete — correlationId=${ctx.correlationId} ` +
              `tenants=${purgeResult.tenantsChecked} eventsDeleted=${purgeResult.eventsDeleted} ` +
              `sessionsRawDetailCleared=${purgeResult.sessionsRawDetailCleared} ` +
              `sessionsDeleted=${purgeResult.sessionsDeleted} rollupsDeleted=${purgeResult.rollupsDeleted}` +
              (ctx.dryRun ? " (dry-run: nothing was deleted)" : "") +
              (skipped
                ? ` (WARNING: ${purgeResult.tenantsSkipped} tenant(s) skipped — database busy)`
                : "")
          );

          return {
            status: skipped ? "partial" : "success",
            itemCounts: {
              tenantsChecked: purgeResult.tenantsChecked,
              eventsDeleted: purgeResult.eventsDeleted,
              sessionsRawDetailCleared: purgeResult.sessionsRawDetailCleared,
              sessionsDeleted: purgeResult.sessionsDeleted,
              rollupsDeleted: purgeResult.rollupsDeleted,
              tenantsSkipped: purgeResult.tenantsSkipped
            },
            detail: skipped
              ? `${purgeResult.tenantsSkipped} tenant(s) skipped due to database backpressure`
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
