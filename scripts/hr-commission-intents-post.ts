/**
 * hr-commission-intents-post.ts -- `bun run hr-commission:intents:post`.
 *
 * Issue #1189, ADR-0147 section 3 (docs/awcms/hr-payroll.md section 6.4).
 * Scheduled entrypoint that drains the `hr_commission` intake queue into the
 * accrual ledger through the one existing posting core
 * (`src/modules/hr-commission/application/hr-commission-intake-poster.ts`), built
 * on the shared job runner (advisory lock, timeout, SIGTERM/SIGINT-aware
 * cancellation, JSON telemetry). Not exposed over HTTP.
 *
 * ## It runs as `awcms_app`, on purpose
 *
 * It opens the APP client (`getDatabaseClient()`, `DATABASE_URL`), NOT the worker
 * client: it posts accruals, and the payroll boundary lets only `awcms_app` touch
 * them (`PAYROLL_ALLOWED_GRANTEES`). `ops/run-job.sh` derives from this file's
 * import closure that the job keeps `DATABASE_URL` (Issue #1132): there is no
 * hand-kept list to update. The event consumer that FEEDS the queue is the
 * worker, and it can only INSERT.
 *
 * The job's environment also carries `WORKER_DATABASE_URL`, which it never uses:
 * it is a GLOBAL name (every job gets it), the runner has no per-job exclusion
 * for a global name, and this job's import closure reaches the resolver in
 * `src/lib/database/client.ts` that reads it. It is the least-privilege worker
 * login, so carrying it adds no authority to this job. Documented, not scoped
 * out (`tests/jobs-runner-env-and-volume.test.ts` pins that it stays present).
 *
 * ## What it does
 *
 * For each active tenant whose `hr_commission` module and `commission_intake_
 * enabled` switch are on: claim due intake rows (`FOR UPDATE SKIP LOCKED`, with a
 * lease), post each in its own transaction, retry transient errors with a bounded
 * back-off, end poison as `failed`; then purge terminal rows past retention.
 * With the switch off a tenant's queue is not touched.
 *
 * `--dry-run` counts the rows that are due and the terminal rows past retention
 * and changes nothing. Never prints an amount, a source reference or a message.
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
import { runIntakePosterJob } from "../src/modules/hr-commission/application/hr-commission-intake-job";

async function main() {
  const sql = getDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "hr-commission:intents:post",
        description:
          "Drains the hr_commission commission intake queue into the accrual ledger through the one existing posting core, as awcms_app; retries transient errors with a bounded back-off, ends poison as failed, purges terminal rows past retention.",
        handler: async (ctx) => {
          const run = await runIntakePosterJob(sql, {
            correlationId: ctx.correlationId,
            dryRun: ctx.dryRun,
            signal: ctx.signal
          });
          const partial = run.tenantsErrored > 0 || run.aborted;

          console.log(
            `hr-commission:intents:post complete -- correlationId=${ctx.correlationId} ` +
              `tenants=${run.tenantsChecked} skipped=${run.tenantsSkipped} ` +
              `claimed=${run.totals.claimed} posted=${run.totals.posted} ` +
              `refused=${run.totals.refused} failed=${run.totals.failed} ` +
              `retried=${run.totals.retried} deferred=${run.totals.deferred} ` +
              `purged=${run.totals.purged} stalledTenants=${run.totals.stalledTenants}` +
              (ctx.dryRun ? " (dry-run: nothing was posted or purged)" : "")
          );

          return {
            status: partial ? "partial" : "success",
            itemCounts: {
              tenantsChecked: run.tenantsChecked,
              tenantsSkipped: run.tenantsSkipped,
              tenantsErrored: run.tenantsErrored,
              ...run.totals
            },
            detail: run.aborted
              ? "Cancelled before every tenant was visited."
              : run.tenantsErrored > 0
                ? `${run.tenantsErrored} tenant(s) errored; see the error log.`
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
