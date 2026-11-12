/**
 * omnichannel-inbox-sla.ts -- `bun run omnichannel-inbox:sla`.
 *
 * Issue #1164, ADR-0160 sections 3 and 4. Scheduled entrypoint for
 * `runSlaJob` (`src/modules/omnichannel-inbox/application/sla-job.ts`), built on
 * the shared job runner (advisory lock, timeout, SIGTERM/SIGINT-aware
 * cancellation, JSON telemetry). Not exposed over HTTP.
 *
 * ## It runs as `awcms_app`, on purpose
 *
 * It opens the APP client (`getDatabaseClient()`, `DATABASE_URL`), NOT the
 * worker client, like `hr-commission:intents:post`: deciding whether an assignee
 * is still eligible reads role grants and business-scope assignments, and the
 * breach notice is an e-mail enqueue, and only the runtime role may do those.
 * It decrypts nothing and calls no provider.
 *
 * This file is the COMPOSITION ROOT: the only place that joins the inbox to the
 * `workflow_notification` port's e-mail adapter and to the business-scope
 * hierarchy adapter.
 *
 * Inert (exit 0, nothing touched) while `OMNICHANNEL_INBOX_ENABLED` is not
 * "true". `--dry-run` counts the breaches due now and changes nothing.
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
import { createEmailWorkflowNotificationAdapter } from "../src/modules/email/application/workflow-notification-port-adapter";
import { runSlaJob } from "../src/modules/omnichannel-inbox/application/sla-job";
import { officeScopeHierarchyPortAdapter } from "../src/modules/tenant-admin/application/office-scope-hierarchy-port-adapter";

async function main() {
  const sql = getDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "omnichannel-inbox:sla",
        description:
          "Unassigns inbox assignees who are no longer eligible, stamps SLA breaches once and notifies each affected assignee through the e-mail outbox. Database-only: no provider call.",
        handler: async (ctx) => {
          const run = await runSlaJob(
            sql,
            {
              hierarchy: officeScopeHierarchyPortAdapter,
              notifier: createEmailWorkflowNotificationAdapter()
            },
            {
              correlationId: ctx.correlationId,
              dryRun: ctx.dryRun,
              signal: ctx.signal
            }
          );

          console.log(
            `omnichannel-inbox:sla complete -- correlationId=${ctx.correlationId} ` +
              (run.inert
                ? "inert (OMNICHANNEL_INBOX_ENABLED is off: nothing touched)"
                : `tenants=${run.tenantsChecked} skipped=${run.tenantsSkipped} ` +
                  `errored=${run.tenantsErrored} revoked=${run.totals.revoked} ` +
                  `breached=${run.totals.breached} notified=${run.totals.notified}`) +
              (ctx.dryRun ? " (dry-run: nothing was changed)" : "")
          );

          return {
            status:
              run.tenantsErrored > 0 || run.aborted ? "partial" : "success",
            itemCounts: {
              tenantsChecked: run.tenantsChecked,
              tenantsSkipped: run.tenantsSkipped,
              tenantsErrored: run.tenantsErrored,
              ...run.totals
            },
            detail: run.inert
              ? "Inert: OMNICHANNEL_INBOX_ENABLED is off."
              : run.aborted
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
