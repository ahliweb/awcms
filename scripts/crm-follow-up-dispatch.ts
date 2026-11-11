/**
 * crm-follow-up-dispatch.ts -- `bun run crm-follow-up:dispatch`.
 *
 * Issue #1165, ADR-0159 section 6. Scheduled worker entrypoint for
 * `runCrmFollowUpDispatch` (`src/modules/crm-follow-up/application/
 * follow-up-dispatch.ts`), built on the shared worker runner (advisory lock,
 * timeout, SIGTERM/SIGINT-aware cancellation, JSON telemetry). Not exposed
 * over HTTP.
 *
 * This file is the COMPOSITION ROOT that joins `crm_follow_up` to the
 * `workflow_notification` capability (the `email` adapter). It performs no
 * network call: the port's `enqueueNotification` is one INSERT into the e-mail
 * outbox, and `email:dispatch` talks to the provider, in another process,
 * outside any transaction.
 *
 * Inert (exit 0, nothing visited) unless `CRM_FOLLOW_UP_ENABLED=true`, and a
 * tenant is visited only when Module Management and its own switch are on.
 * `--dry-run` counts the escalations and notices due now and settles nothing.
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
import { runCrmFollowUpDispatch } from "../src/modules/crm-follow-up/application/follow-up-dispatch";
import { createEmailWorkflowNotificationAdapter } from "../src/modules/email/application/workflow-notification-port-adapter";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "crm-follow-up:dispatch",
        description:
          "Escalates overdue follow-up tasks and hands due staff notices to the e-mail outbox through the workflow_notification port, after re-checking the task, the lead's stop signals, the recipient, working hours and the hourly cap. Database-only: no provider call.",
        handler: async (ctx) => {
          const run = await runCrmFollowUpDispatch(
            sql,
            ctx,
            createEmailWorkflowNotificationAdapter()
          );
          const hitPassLimit = run.tenantsHitPassLimit.length > 0;

          console.log(
            `crm-follow-up:dispatch complete -- correlationId=${ctx.correlationId} ` +
              `tenants=${run.tenantsChecked} escalated=${run.totals.escalated} ` +
              `enqueued=${run.totals.enqueued} cancelled=${run.totals.cancelled} ` +
              `suppressed=${run.totals.suppressed} deferred=${run.totals.deferred} ` +
              `failed=${run.totals.failed} failedTenants=${run.failedTenants.length}` +
              (ctx.dryRun ? " (dry-run: nothing was settled)" : "") +
              (hitPassLimit
                ? ` (WARNING: ${run.tenantsHitPassLimit.length} tenant(s) still had backlog remaining after the pass-count safety bound)`
                : "")
          );

          return {
            status:
              hitPassLimit || run.aborted || run.failedTenants.length > 0
                ? "partial"
                : "success",
            itemCounts: {
              tenantsChecked: run.tenantsChecked,
              ...run.totals,
              tenantsHitPassLimit: run.tenantsHitPassLimit.length,
              failedTenants: run.failedTenants.length
            },
            detail: hitPassLimit
              ? `Backlog not fully drained for: ${run.tenantsHitPassLimit.join(", ")}`
              : run.aborted
                ? "Cancelled before every tenant was visited; the remaining backlog is unknown."
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
