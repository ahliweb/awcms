/**
 * channel-accounts-oauth-state-sweep.ts -- `bun run channel-accounts:oauth-state:sweep`.
 *
 * Issue #1215 N2. Scheduled entrypoint for `runOAuthStateSweepJob`
 * (`src/modules/channel-accounts/application/oauth-state-sweep-job.ts`), built on
 * the shared job runner (advisory lock, timeout, SIGTERM/SIGINT-aware
 * cancellation, JSON telemetry). Not exposed over HTTP.
 *
 * ## It runs as `awcms_app`, on purpose
 *
 * No worker role holds any privilege on the channel tables, so it opens the APP
 * client (`getDatabaseClient()`, `DATABASE_URL`), like
 * `channel-accounts:secrets:rekey`. It decrypts nothing and calls no provider:
 * it deletes expired authorisation state and the ciphertext hanging off it.
 *
 * Runs whether or not `CHANNEL_ACCOUNTS_ENABLED` is on: switching the module off
 * must not freeze abandoned material in place. `--dry-run` counts what is due
 * and changes nothing.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import {
  applyJobExitCode,
  formatJobOutcomeLine,
  isJobResultOk,
  parseJobCliArgs,
  printJobTelemetry,
  runJob,
  writeJobTelemetry
} from "../src/lib/jobs/job-runner";
import { runOAuthStateSweepJob } from "../src/modules/channel-accounts/application/oauth-state-sweep-job";

async function main() {
  const sql = getDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "channel-accounts:oauth-state:sweep",
        description:
          "Deletes expired OAuth authorisation state and fails abandoned pending connections, erasing their PKCE verifier and hand-off ciphertext. Database-only: no provider call, no decryption.",
        handler: async (ctx) => {
          const run = await runOAuthStateSweepJob(sql, {
            dryRun: ctx.dryRun,
            signal: ctx.signal
          });

          console.log(
            `channel-accounts:oauth-state:sweep complete -- correlationId=${ctx.correlationId} ` +
              `tenants=${run.tenantsChecked} errored=${run.tenantsErrored} ` +
              `backlogged=${run.tenantsBacklogged} ` +
              (ctx.dryRun
                ? `statesDue=${run.statesDue} connectionsDue=${run.connectionsDue} (dry-run: nothing was changed)`
                : `statesDeleted=${run.statesDeleted} connectionsFailed=${run.connectionsFailed}`)
          );

          return {
            status:
              run.tenantsErrored > 0 || run.aborted ? "partial" : "success",
            itemCounts: {
              tenantsChecked: run.tenantsChecked,
              tenantsErrored: run.tenantsErrored,
              tenantsBacklogged: run.tenantsBacklogged,
              statesDeleted: run.statesDeleted,
              connectionsFailed: run.connectionsFailed
            },
            detail: run.aborted
              ? "Cancelled before every tenant was visited."
              : run.tenantsErrored > 0
                ? `${run.tenantsErrored} tenant(s) failed; the others were processed.`
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
