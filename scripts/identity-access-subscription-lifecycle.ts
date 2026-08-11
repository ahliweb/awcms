/**
 * identity-access-subscription-lifecycle.ts — `bun run
 * identity-access:subscription-lifecycle`.
 *
 * ADR-0084, Gelombang 5 PR 5.2 of Issue #423. Scheduled worker entrypoint for
 * `runSubscriptionLifecycle` — same shape as
 * `scripts/identity-access-business-scope-expiry.ts`: built on the shared worker
 * runner (advisory lock, timeout, SIGTERM/SIGINT-aware cancellation, JSON
 * telemetry), not exposed over HTTP.
 *
 * `--dry-run`: reports what WOULD move and applies nothing — safe against
 * production, and worth running before the first real schedule, because the
 * first run after a backfill is the one that finds out whether every tenant's
 * dates mean what the operator thought.
 *
 * A run that would cost more than `MAX_ENTITLEMENT_LOSSES_PER_RUN` tenants their
 * plan entitlements applies NONE of those, reports `partial`, and names them.
 * That is a bug detector, not a rate limit: real attrition trickles, and every
 * failure mode that matters arrives as a cliff.
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
import { runSubscriptionLifecycle } from "../src/modules/identity-access/application/subscription-lifecycle-job";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "identity-access:subscription-lifecycle",
        description:
          "Walks each tenant's subscription one rung down the trialing -> active -> past_due -> grace -> suspended ladder when its own dates say so, auditing every transition in the tenant's own trail. Never moves a subscription up, and never writes awcms_tenants.",
        handler: async (ctx) => {
          const ladderResult = await runSubscriptionLifecycle(sql, ctx);
          const withheld = ladderResult.withheldTenantIds.length > 0;

          console.log(
            `identity-access:subscription-lifecycle complete — correlationId=${ctx.correlationId} ` +
              `tenants=${ladderResult.tenantsChecked} transitions=${ladderResult.transitionsApplied} ` +
              `entitlementLosses=${ladderResult.entitlementLosses}` +
              (ctx.dryRun ? " (dry-run: nothing was transitioned)" : "") +
              (withheld
                ? ` (WITHHELD: ${ladderResult.withheldTenantIds.length} tenant(s) would have lost plan entitlements in one run — above the safety bound, so NONE were applied)`
                : "")
          );

          return {
            status: withheld ? "partial" : "success",
            itemCounts: {
              tenantsChecked: ladderResult.tenantsChecked,
              transitionsApplied: ladderResult.transitionsApplied,
              entitlementLosses: ladderResult.entitlementLosses,
              withheld: ladderResult.withheldTenantIds.length
            },
            detail: withheld
              ? `Entitlement losses withheld for: ${ladderResult.withheldTenantIds.join(", ")}. Investigate before re-running — a cliff of lapses in one run is far more often a data or clock defect than genuine attrition.`
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
    await sql.close();
  }
}

await main();
