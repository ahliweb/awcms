/**
 * booking-holds-expire.ts -- `bun run booking:holds:expire`.
 *
 * Issue #939, ADR-0131 (docs/awcms/booking.md section 5.1). Scheduled worker
 * entrypoint for `runBookingHoldExpiry`
 * (`src/modules/booking/application/booking-hold-expiry-job.ts`), built on the
 * shared worker runner (advisory lock, timeout, SIGTERM/SIGINT-aware
 * cancellation, JSON telemetry). Not exposed over HTTP.
 *
 * The sweep is HOUSEKEEPING, not the gate. A hold that has run out is reclaimed
 * by the next claim on its units whether this has run or not, so a stopped job
 * costs stale `held` rows, never a double booking; its health is read from the
 * data by the booking reconciliation (`hold_overdue_unswept`).
 *
 * Runs as `awcms_worker` under a per-tenant context, like the other scheduled
 * jobs. The worker holds no privilege on the booking tables; the sweep goes
 * through the narrow SECURITY DEFINER function `awcms_booking_expire_due_holds`
 * (`sql/200`, following `sql/142` / ADR-0090), which can only expire an elapsed
 * hold of the session's own tenant. The `held -> expired` trigger refuses an
 * expiry before the hold has elapsed, a second time, by the same clock.
 *
 * `--dry-run` counts the elapsed holds per tenant and mutates nothing.
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
import { runBookingHoldExpiry } from "../src/modules/booking/application/booking-hold-expiry-job";

async function main() {
  // Connects as the least-privilege worker role when configured, falling back to
  // DATABASE_URL otherwise (the same posture as every other scheduled job).
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "booking:holds:expire",
        description:
          "Expires booking holds whose lifetime has elapsed on the database clock: the reservation becomes `expired`, its units are released and an `expired` history row is written. Housekeeping -- the allocator already reclaims an elapsed hold on the units it claims.",
        handler: async (ctx) => {
          const sweep = await runBookingHoldExpiry(sql, ctx);
          const hitPassLimit = sweep.tenantsHitPassLimit.length > 0;

          console.log(
            `booking:holds:expire complete -- correlationId=${ctx.correlationId} ` +
              `tenants=${sweep.tenantsChecked} holdsExpired=${sweep.holdsExpired} ` +
              `allocationsReleased=${sweep.allocationsReleased}` +
              (ctx.dryRun ? " (dry-run: nothing was swept)" : "") +
              (hitPassLimit
                ? ` (WARNING: ${sweep.tenantsHitPassLimit.length} tenant(s) still had backlog remaining after the pass-count safety bound)`
                : "")
          );

          return {
            // An aborted or capped run is PARTIAL: the holds it left are exactly
            // the stale `held` rows the sweep exists to clear.
            status: hitPassLimit || sweep.aborted ? "partial" : "success",
            itemCounts: {
              tenantsChecked: sweep.tenantsChecked,
              holdsExpired: sweep.holdsExpired,
              allocationsReleased: sweep.allocationsReleased,
              tenantsHitPassLimit: sweep.tenantsHitPassLimit.length
            },
            detail: hitPassLimit
              ? `Backlog not fully drained for: ${sweep.tenantsHitPassLimit.join(", ")}`
              : sweep.aborted
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
