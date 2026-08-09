/**
 * domain-event-deliveries-purge.ts — `bun run domain-events:deliveries:purge`.
 *
 * Issue #468, ADR-0072. Internal worker entrypoint — not exposed over HTTP, run
 * on a schedule. Drives
 * `src/modules/domain-event-runtime/application/delivery-retention-purge.ts`
 * per tenant in bounded batches until a pass deletes nothing or
 * `MAX_PASSES_PER_TENANT` is hit, the same safety bound the three sibling
 * purges use.
 *
 * Like those jobs, this one does NOT go through `runJob`
 * (`src/lib/jobs/job-runner.ts`), so it has no advisory lock, no `JobResult`
 * telemetry, and no cooperative cancellation — schedule it from ONE cron entry.
 *
 * `--dry-run` for the same reason `email:queue:purge` has one: this table has
 * accumulated since `sql/009` with no retention at all, so the FIRST run on a
 * live deployment is the largest delete this job will ever do, against rows
 * nobody has counted. It is also the table where a surprise is most likely —
 * one row per (event x consumer), so its size is a product, not a sum.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import {
  DELIVERY_DEFAULT_RETENTION_DAYS,
  purgeSettledDeliveries,
  resolveDeliveryRetentionCutoff
} from "../src/modules/domain-event-runtime/application/delivery-retention-purge";

const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };
type CountRow = { total: number };

/**
 * Counts what a real run WOULD delete, with the same three predicates.
 *
 * Deliberately re-states them rather than sharing a fragment: a preview that
 * can disagree with the delete is worse than no preview, and this repo has no
 * shared SQL builder to make the two provably identical.
 * `tests/domain-event-deliveries-purge.test.ts` pins them against each other.
 */
async function previewTenant(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<number> {
  const cutoff = resolveDeliveryRetentionCutoff(
    now,
    DELIVERY_DEFAULT_RETENTION_DAYS
  );

  const rows = (await sql`
    SELECT count(*)::int AS total
    FROM awcms_domain_event_deliveries d
    WHERE d.tenant_id = ${tenantId}
      AND d.status IN ('delivered', 'skipped')
      AND d.updated_at < ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM awcms_domain_event_replays r
        WHERE r.original_delivery_id = d.id
           OR r.replay_delivery_id = d.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM awcms_domain_event_deliveries child
        WHERE child.replay_of_delivery_id = d.id
      )
  `) as CountRow[];

  return rows[0]?.total ?? 0;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();
  const now = new Date();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    let total = 0;

    for (const tenant of tenants) {
      if (dryRun) {
        // No `withTenantOrThrow`, and therefore no RLS session variable: this
        // runs as `awcms_worker`, which the policies bind, and the query above
        // carries its own `tenant_id = ?`. Counting is the one operation where
        // that is enough — it writes nothing.
        total += await previewTenant(sql, tenant.id, now);
        continue;
      }

      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await purgeSettledDeliveries(
          sql,
          tenant.id,
          legalHoldGuardPortAdapter,
          { correlationId }
        );

        total += result.purgedRows;

        if (result.purgedRows === 0) break;
      }
    }

    console.log(
      `domain-events:deliveries:purge ${dryRun ? "DRY RUN" : "complete"} — ` +
        `correlationId=${correlationId} tenants=${tenants.length} rows=${total}`
    );
  } catch (error) {
    logScriptFailure("domain-events:deliveries:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
