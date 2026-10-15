/**
 * booking-reminders-dispatch.ts -- `bun run booking:reminders:dispatch`.
 *
 * Issue #943, ADR-0131, ADR-0133 (docs/awcms/booking.md section 7.5). Scheduled
 * worker entrypoint for `runBookingReminderDispatch`
 * (`src/modules/booking/application/booking-reminder-job.ts`), built on the
 * shared worker runner (advisory lock, timeout, SIGTERM/SIGINT-aware
 * cancellation, JSON telemetry). Not exposed over HTTP.
 *
 * This file is the COMPOSITION ROOT for the job: the only place that joins
 * `booking` to the `whatsapp_delivery` capability (its port adapter) and to the
 * deployment's recipient resolver. It performs no network call: the delivery
 * port's `enqueue` is one INSERT, and `whatsapp:dispatch` is what talks to a
 * provider, in another process, outside any transaction.
 *
 * Inert (exit 0, nothing created) until a deployment registers a
 * `BookingReminderRecipientPort` with `registerBookingReminderRecipients`: no
 * implementation ships here because the customer authority is downstream.
 *
 * `--dry-run` counts the intents due now and mutates nothing.
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
import { runBookingReminderDispatch } from "../src/modules/booking/application/booking-reminder-job";
import { getBookingReminderRecipients } from "../src/modules/booking/application/booking-reminder-recipients";
import { registerBookingWhatsappTemplates } from "../src/modules/booking/infrastructure/booking-whatsapp-templates";
import { whatsappDeliveryPortAdapter } from "../src/modules/whatsapp-delivery/application/whatsapp-enqueue";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  registerBookingWhatsappTemplates();

  try {
    const result = await runJob(
      {
        name: "booking:reminders:dispatch",
        description:
          "Creates the booking confirmation and reminder intents owed for confirmed reservations and hands each to the WhatsApp delivery queue through its port, once per (reservation, kind, occurrence); cancels what a cancelled reservation no longer needs. Database-only: no provider call.",
        handler: async (ctx) => {
          const recipients = getBookingReminderRecipients();
          const run = await runBookingReminderDispatch(sql, ctx, {
            whatsapp: whatsappDeliveryPortAdapter,
            ...(recipients ? { recipients } : {})
          });
          const hitPassLimit = run.tenantsHitPassLimit.length > 0;

          console.log(
            `booking:reminders:dispatch complete -- correlationId=${ctx.correlationId} ` +
              (run.inert
                ? "inert (no recipient resolver registered: nothing created or sent)"
                : `tenants=${run.tenantsChecked} created=${run.totals.created} ` +
                  `enqueued=${run.totals.enqueued} suppressed=${run.totals.suppressed} ` +
                  `refused=${run.totals.refused} skipped=${run.totals.skipped} ` +
                  `cancelled=${run.totals.cancelled} expired=${run.totals.expired} ` +
                  `retried=${run.totals.retried}`) +
              (ctx.dryRun ? " (dry-run: nothing was settled)" : "") +
              (hitPassLimit
                ? ` (WARNING: ${run.tenantsHitPassLimit.length} tenant(s) still had backlog remaining after the pass-count safety bound)`
                : "")
          );

          return {
            status: hitPassLimit || run.aborted ? "partial" : "success",
            itemCounts: {
              tenantsChecked: run.tenantsChecked,
              ...run.totals,
              tenantsHitPassLimit: run.tenantsHitPassLimit.length
            },
            detail: run.inert
              ? "Inert: no recipient resolver is registered."
              : hitPassLimit
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
