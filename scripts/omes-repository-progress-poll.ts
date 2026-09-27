/**
 * omes-repository-progress-poll.ts — `bun run omes:repository-progress:poll`.
 *
 * Scheduled entry point for the ADR-0030 / Issue ahliweb/omes#249 GitHub
 * repository-progress poller. For every active tenant with a configured
 * repository (`awcms_omes_repository_progress_config`), polls the GitHub
 * REST API (`application/repository-progress-poller.ts`) and upserts the
 * projection (`application/repository-progress-ingestion.ts`) that
 * `/admin/omes/progres-hermes` and `GET /api/v1/omes/repository-progress`
 * read.
 *
 * Built on the shared job runner (`src/lib/jobs/job-runner.ts`): advisory
 * lock, timeout, SIGTERM/SIGINT-aware cancellation, JSON telemetry, exit
 * code — the same shape as `visitor-analytics-purge.ts`.
 *
 * Per doc 16 §Transactional outbox ("Jangan memanggil provider eksternal di
 * dalam transaction", also noted in `src/lib/integration/timeout.ts`'s
 * header), the outbound GitHub HTTP calls run OUTSIDE any database
 * transaction: one short read-only transaction loads the tenant's config +
 * previous ETag/projection state, then the network call happens with no
 * transaction open, then a second short transaction persists the outcome.
 * Runs as `awcms_worker` when `WORKER_DATABASE_URL` is configured (least
 * privilege — sql/166 grants it SELECT-only on the config table and full
 * read/write only on the projection table it owns).
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
import { fetchActiveTenants } from "../src/lib/jobs/batching";
import { getPollableRepositoryProgressConfig } from "../src/modules/omes-control/application/repository-progress-config";
import {
  getPreviousRepositoryProgressState,
  recordRepositoryProgressError,
  recordRepositoryProgressSuccess,
  recordRepositoryProgressUnchanged
} from "../src/modules/omes-control/application/repository-progress-ingestion";
import {
  pollOneRepository,
  resolveGithubToken
} from "../src/modules/omes-control/application/repository-progress-poller";

export type RepositoryProgressPollResult = {
  tenantsChecked: number;
  tenantsConfigured: number;
  tenantsUpdated: number;
  tenantsUnchanged: number;
  tenantsErrored: number;
  tenantsSkipped: number;
  skippedTenantIds: string[];
};

async function loadTenantPollInput(sql: Bun.SQL, tenantId: string) {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const config = await getPollableRepositoryProgressConfig(tx);
      if (!config) return null;
      const previous = await getPreviousRepositoryProgressState(tx, tenantId);
      return { config, previous };
    },
    { workClass: "maintenance" }
  );
}

export async function runRepositoryProgressPoll(
  sql: Bun.SQL,
  ctx: Pick<JobContext, "dryRun"> & Partial<Pick<JobContext, "signal">>,
  now: Date = new Date()
): Promise<RepositoryProgressPollResult> {
  const tenants = await fetchActiveTenants(sql);

  const totals: RepositoryProgressPollResult = {
    tenantsChecked: tenants.length,
    tenantsConfigured: 0,
    tenantsUpdated: 0,
    tenantsUnchanged: 0,
    tenantsErrored: 0,
    tenantsSkipped: 0,
    skippedTenantIds: []
  };

  for (const tenant of tenants) {
    if (ctx.signal?.aborted) break;

    let loaded: Awaited<ReturnType<typeof loadTenantPollInput>>;
    try {
      loaded = await loadTenantPollInput(sql, tenant.id);
    } catch (error) {
      if (!(error instanceof DatabaseBusyError)) throw error;
      totals.tenantsSkipped += 1;
      totals.skippedTenantIds.push(tenant.id);
      continue;
    }

    if (!loaded) continue; // tenant has no repository-progress config
    totals.tenantsConfigured += 1;

    if (ctx.dryRun) continue;

    const { config, previous } = loaded;
    const token = resolveGithubToken(config.secretRef);

    const outcome = await pollOneRepository({
      tenantId: tenant.id,
      owner: config.owner,
      name: config.name,
      token,
      previousMilestonesEtag: previous?.milestonesEtag ?? null,
      previousIssuesEtag: previous?.issuesEtag ?? null,
      previousMilestones: previous?.milestones ?? [],
      previousIssues: previous?.issues ?? [],
      now
    });

    try {
      if (outcome.outcome === "updated") {
        await withTenantOrThrow(
          sql,
          tenant.id,
          (tx) =>
            recordRepositoryProgressSuccess(
              tx,
              tenant.id,
              outcome.view,
              outcome.milestonesEtag,
              outcome.issuesEtag
            ),
          { workClass: "maintenance" }
        );
        totals.tenantsUpdated += 1;
      } else if (outcome.outcome === "not_modified") {
        await withTenantOrThrow(
          sql,
          tenant.id,
          (tx) =>
            recordRepositoryProgressUnchanged(
              tx,
              tenant.id,
              now.toISOString().replace(/\.\d{3}Z$/, "Z")
            ),
          { workClass: "maintenance" }
        );
        totals.tenantsUnchanged += 1;
      } else {
        await withTenantOrThrow(
          sql,
          tenant.id,
          (tx) =>
            recordRepositoryProgressError(
              tx,
              tenant.id,
              config.owner,
              config.name,
              outcome.errorClass,
              now
            ),
          { workClass: "maintenance" }
        );
        totals.tenantsErrored += 1;
      }
    } catch (error) {
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

  try {
    const result = await runJob(
      {
        name: "omes:repository-progress:poll",
        description:
          "Polls the GitHub REST API for every tenant's configured repository (ADR-0030, ahliweb/omes#249) and upserts the milestone/issue progress projection for /admin/omes/progres-hermes.",
        handler: async (ctx) => {
          const pollResult = await runRepositoryProgressPoll(sql, ctx);
          const hadSkips = pollResult.tenantsSkipped > 0;
          const hadErrors = pollResult.tenantsErrored > 0;
          return {
            status: hadSkips || hadErrors ? "partial" : "success",
            itemCounts: {
              tenantsChecked: pollResult.tenantsChecked,
              tenantsConfigured: pollResult.tenantsConfigured,
              tenantsUpdated: pollResult.tenantsUpdated,
              tenantsUnchanged: pollResult.tenantsUnchanged,
              tenantsErrored: pollResult.tenantsErrored,
              tenantsSkipped: pollResult.tenantsSkipped
            },
            detail:
              `Checked ${pollResult.tenantsChecked} tenant(s), ${pollResult.tenantsConfigured} configured, ` +
              `${pollResult.tenantsUpdated} updated, ${pollResult.tenantsUnchanged} unchanged, ` +
              `${pollResult.tenantsErrored} errored, ${pollResult.tenantsSkipped} skipped (database busy).`
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
