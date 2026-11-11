/**
 * social-publishing-retention-purge.ts — `bun run social-publishing:retention:purge`.
 *
 * Issue #1145 (ADR-0157, an admission condition before the first connector).
 * Internal worker entrypoint — not exposed over HTTP, run on a schedule. Drives
 * `src/modules/social-publishing/application/social-publishing-retention-purge.ts`
 * per tenant in bounded passes until a pass deletes nothing or
 * `MAX_PASSES_PER_TENANT` is hit. Like `whatsapp:queue:purge` it does NOT go
 * through `runJob`, so it has no advisory lock — schedule it from ONE cron
 * entry.
 *
 * Runs regardless of `SOCIAL_PUBLISHING_ENABLED`: a deployment that switched the
 * module off still holds rows from when it was on. It removes only whole
 * publications whose every job is terminal and older than the retention window
 * (default 730 days, never under 365: `sql/357` refuses the worker anything
 * younger). It never removes a waiting job, a job an operator must reconcile or
 * a publication waiting for approval.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import { purgeSocialPublishing } from "../src/modules/social-publishing/application/social-publishing-retention-purge";

const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };

async function main() {
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    // EVERY tenant, not only active ones: a suspended tenant's history ages too.
    const tenants = (await sql`SELECT id FROM awcms_tenants`) as TenantRow[];

    let totalPublications = 0;
    let totalJobs = 0;
    let totalAttempts = 0;
    let heldTenants = 0;
    let failedTenants = 0;

    for (const tenant of tenants) {
      try {
        for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
          const result = await purgeSocialPublishing(
            sql,
            tenant.id,
            legalHoldGuardPortAdapter,
            { correlationId }
          );

          totalPublications += result.purgedPublications;
          totalJobs += result.purgedJobs;
          totalAttempts += result.purgedAttempts;

          if (result.held) {
            heldTenants += 1;
            break;
          }

          if (
            result.purgedPublications +
              result.purgedJobs +
              result.purgedAttempts ===
            0
          ) {
            break;
          }
        }
      } catch (error) {
        failedTenants += 1;
        logScriptFailure(
          "social-publishing:retention:purge tenant pass FAILED",
          error
        );
      }
    }

    console.log(
      `social-publishing:retention:purge complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} publications=${totalPublications} ` +
        `jobs=${totalJobs} attempts=${totalAttempts} ` +
        `heldTenants=${heldTenants} failedTenants=${failedTenants}`
    );
  } catch (error) {
    logScriptFailure("social-publishing:retention:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
