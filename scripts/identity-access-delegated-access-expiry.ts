/**
 * identity-access-delegated-access-expiry.ts — `bun run
 * identity-access:delegated-access:expiry`.
 *
 * ADR-0090, finding A1 of the 17 August 2026 audit round. Scheduled worker
 * entrypoint for `runDelegatedAccessExpiry`
 * (`src/modules/identity-access/application/delegated-access-expiry-job.ts`) —
 * same shape as `scripts/identity-access-business-scope-expiry.ts`: built on
 * the shared worker runner (advisory lock, timeout, SIGTERM/SIGINT-aware
 * cancellation, JSON telemetry), not exposed over HTTP.
 *
 * The sweep is CLEANUP, not the gate. An expired grant is refused at the
 * chokepoint from the instant on its row whether this has run or not; what this
 * adds is ending the membership and its sessions, so a customer's user list
 * stops showing a partner's person as an active member of their tenant.
 *
 * `--dry-run`: counts the backlog per tenant and mutates nothing — safe to run
 * in production to see how many engagements are past their date before
 * scheduling this for real.
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
import { runDelegatedAccessExpiry } from "../src/modules/identity-access/application/delegated-access-expiry-job";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "identity-access:delegated-access:expiry",
        description:
          "Ends delegated support episodes whose grant has run out: the grant is revoked with reason `expired` and no actor, its delegated tenant user goes inactive, and its live sessions are revoked.",
        handler: async (ctx) => {
          const expiry = await runDelegatedAccessExpiry(sql, ctx);
          const hitPassLimit = expiry.tenantsHitPassLimit.length > 0;

          console.log(
            `identity-access:delegated-access:expiry complete — correlationId=${ctx.correlationId} ` +
              `tenants=${expiry.tenantsChecked} grantsExpired=${expiry.grantsExpired}` +
              (ctx.dryRun ? " (dry-run: nothing was swept)" : "") +
              (hitPassLimit
                ? ` (WARNING: ${expiry.tenantsHitPassLimit.length} tenant(s) still had backlog remaining after the pass-count safety bound)`
                : "")
          );

          return {
            // An aborted run is PARTIAL, not success. The backlog it left is
            // memberships that still read as active in a customer's user list,
            // and a green line over that is the shape `site-search:reconcile`
            // is on the backlog for.
            status: hitPassLimit || expiry.aborted ? "partial" : "success",
            itemCounts: {
              tenantsChecked: expiry.tenantsChecked,
              grantsExpired: expiry.grantsExpired,
              tenantsHitPassLimit: expiry.tenantsHitPassLimit.length
            },
            detail: hitPassLimit
              ? `Backlog not fully drained for: ${expiry.tenantsHitPassLimit.join(", ")}`
              : expiry.aborted
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
