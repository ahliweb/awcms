/**
 * reporting-projections-refresh.ts — `bun run reporting:projections:refresh`.
 *
 * Issue #753 (epic #738 platform-evolution, Wave 3). Scheduled worker
 * entrypoint for the `cursor_table`-strategy incremental engine
 * (`runIncrementalUpdateForAllTenants`) and rebuild-continuation
 * (`continueAllRunningRebuilds`) — same shape as `scripts/data-lifecycle-
 * archive-purge.ts`: built on the shared worker runner (advisory lock,
 * timeout, SIGTERM/SIGINT-aware cancellation, JSON telemetry), pure
 * PostgreSQL operation, safe in offline/LAN deployments. Runs as the
 * least-privilege `awcms_worker` role (`sql/022`) when `WORKER_DATABASE_URL`
 * is configured, else via the `DATABASE_URL` fallback (opt-in — see
 * `src/lib/database/client.ts`).
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import {
  applyJobExitCode,
  formatJobOutcomeLine,
  isJobResultOk,
  parseJobCliArgs,
  printJobTelemetry,
  runJob,
  writeJobTelemetry
} from "../src/lib/jobs/job-runner";
import { listModules } from "../src/modules";
import { runIncrementalUpdateForAllTenants } from "../src/modules/reporting/application/projection-incremental-worker";
import { continueAllRunningRebuilds } from "../src/modules/reporting/application/projection-rebuild";
import { collectProjectionDescriptors } from "../src/modules/reporting/domain/projection-registry";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));
  const descriptors = collectProjectionDescriptors(listModules()).filter(
    (descriptor) => descriptor.scope === "tenant"
  );

  try {
    const result = await runJob(
      {
        name: "reporting:projections:refresh",
        description:
          "Incrementally updates every cursor_table-strategy projection for every active tenant, and continues any in-progress rebuild's bounded passes.",
        handler: async () => {
          if (cliOptions.dryRun) {
            return {
              status: "success",
              detail:
                "dry-run: no incremental update or rebuild continuation performed."
            };
          }

          const incrementalOutcomes = await runIncrementalUpdateForAllTenants(
            sql,
            descriptors
          );
          const rebuildOutcomes = await continueAllRunningRebuilds(
            sql,
            descriptors
          );

          const failedTenants = incrementalOutcomes.filter(
            (o) => o.failed
          ).length;
          const skippedForRebuild = incrementalOutcomes.filter(
            (o) => o.skippedRebuildInProgress
          ).length;
          const rowsProcessed = incrementalOutcomes.reduce(
            (sum, o) => sum + o.rowsProcessed,
            0
          );
          const rebuildsAdvanced = rebuildOutcomes.length;
          const rebuildsCompleted = rebuildOutcomes.filter(
            (o) => o.status === "completed"
          ).length;

          console.log(
            `reporting:projections:refresh complete — descriptors=${descriptors.length} ` +
              `rowsProcessed=${rowsProcessed} skippedForRebuild=${skippedForRebuild} ` +
              `rebuildsAdvanced=${rebuildsAdvanced} rebuildsCompleted=${rebuildsCompleted} ` +
              `failedTenantDescriptorPairs=${failedTenants}`
          );

          return {
            status: failedTenants > 0 ? "partial" : "success",
            itemCounts: {
              rowsProcessed,
              skippedForRebuild,
              rebuildsAdvanced,
              rebuildsCompleted,
              failedTenantDescriptorPairs: failedTenants
            }
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
