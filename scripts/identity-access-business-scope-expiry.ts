/**
 * identity-access-business-scope-expiry.ts — `bun run
 * identity-access:business-scope:expiry`.
 *
 * Issue #180 (epic #177 Wave 2 authorization). Scheduled worker entrypoint
 * for `runBusinessScopeExpiry`
 * (`src/modules/identity-access/application/business-scope-expiry-job.ts`) —
 * same shape as `scripts/audit-log-purge.ts`: built on the shared worker
 * runner (advisory lock, timeout, SIGTERM/SIGINT-aware cancellation, JSON
 * telemetry), not exposed over HTTP.
 *
 * Ported from awcms-mini (`scripts/identity-access-business-scope-expiry.ts`,
 * Issue #746), reduced to the business-scope-assignment sweep only (mini also
 * expired SoD conflict exceptions — that table is #181's, not ported here).
 *
 * `--dry-run`: reports the backlog count only, no mutation — safe to run in
 * production to preview the expiry backlog before scheduling for real.
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
import { runBusinessScopeExpiry } from "../src/modules/identity-access/application/business-scope-expiry-job";

async function main() {
  const sql = getWorkerDatabaseClient();
  const cliOptions = parseJobCliArgs(process.argv.slice(2));

  try {
    const result = await runJob(
      {
        name: "identity-access:business-scope:expiry",
        description:
          "Transitions business-scope assignments past their effective_to to expired, recording lifecycle events and an aggregate audit entry per tenant.",
        handler: async (ctx) => {
          const expiryResult = await runBusinessScopeExpiry(sql, ctx);
          const hitPassLimit = expiryResult.tenantsHitPassLimit.length > 0;

          console.log(
            `identity-access:business-scope:expiry complete — correlationId=${ctx.correlationId} ` +
              `tenants=${expiryResult.tenantsChecked} assignmentsExpired=${expiryResult.assignmentsExpired} ` +
              `exceptionsExpired=${expiryResult.exceptionsExpired}` +
              (ctx.dryRun ? " (dry-run: nothing was transitioned)" : "") +
              (hitPassLimit
                ? ` (WARNING: ${expiryResult.tenantsHitPassLimit.length} tenant(s) still had backlog remaining after the pass-count safety bound)`
                : "")
          );

          return {
            status: hitPassLimit ? "partial" : "success",
            itemCounts: {
              tenantsChecked: expiryResult.tenantsChecked,
              assignmentsExpired: expiryResult.assignmentsExpired,
              exceptionsExpired: expiryResult.exceptionsExpired,
              tenantsHitPassLimit: expiryResult.tenantsHitPassLimit.length
            },
            detail: hitPassLimit
              ? `Backlog not fully drained for: ${expiryResult.tenantsHitPassLimit.join(", ")}`
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
