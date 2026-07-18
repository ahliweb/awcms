/**
 * reporting-exports-dispatch.ts — `bun run reporting:exports:dispatch`.
 *
 * Issue #753 (epic #738 platform-evolution, Wave 3). Scheduled worker
 * entrypoint for `dispatchDueScheduledExports` — generates a fresh export
 * artifact for every enabled scheduled export config whose interval has
 * elapsed, for every active tenant. Local filesystem write under
 * `REPORTING_EXPORT_ROOT_PATH` — no external network egress, safe in
 * offline/LAN deployments. Runs as the least-privilege `awcms_worker` role
 * (`sql/022`) when `WORKER_DATABASE_URL` is configured, else via the
 * `DATABASE_URL` fallback (opt-in — see `src/lib/database/client.ts`).
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
import { dispatchDueScheduledExports } from "../src/modules/reporting/application/scheduled-export-dispatch";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "reporting:exports:dispatch",
        description:
          "Generates a fresh export artifact for every enabled scheduled export config whose interval has elapsed, for every active tenant.",
        handler: async () => {
          if (cliOptions.dryRun) {
            return {
              status: "success",
              detail: "dry-run: no export generated."
            };
          }

          const result = await dispatchDueScheduledExports(sql);

          console.log(
            `reporting:exports:dispatch complete — tenants=${result.tenantsChecked} ` +
              `attempted=${result.exportsAttempted} failed=${result.exportsFailed}`
          );

          return {
            status: result.exportsFailed > 0 ? "partial" : "success",
            itemCounts: {
              tenantsChecked: result.tenantsChecked,
              exportsAttempted: result.exportsAttempted,
              exportsFailed: result.exportsFailed
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
