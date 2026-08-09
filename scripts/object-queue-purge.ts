/**
 * object-queue-purge.ts — `bun run sync:objects:purge`.
 *
 * Issue #468, ADR-0072. Internal worker entrypoint — not exposed over HTTP, run
 * on a schedule. Drives
 * `src/modules/sync-storage/application/object-queue-purge.ts` per tenant in
 * bounded batches until a pass deletes nothing or `MAX_PASSES_PER_TENANT` is
 * hit, the same safety bound `form-draft-purge.ts`, `push:queue:purge` and
 * `email:queue:purge` use.
 *
 * Like those jobs, this one does NOT go through `runJob`
 * (`src/lib/jobs/job-runner.ts`), so it has no advisory lock, no `JobResult`
 * telemetry, and no cooperative cancellation — schedule it from ONE cron entry.
 *
 * Runs regardless of `STORAGE_DRIVER`, unlike `sync:objects:dispatch`. A
 * deployment that switched back to local storage still holds rows from when R2
 * was on, and those are exactly the ones nothing else will ever clean up.
 *
 * `--dry-run` for the same reason `email:queue:purge` has one: this table has
 * accumulated since `sql/012` with no retention at all, so the FIRST run on a
 * live deployment is the largest delete this job will ever do, against rows
 * nobody has counted.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import {
  OBJECT_QUEUE_DEFAULT_RETENTION_DAYS,
  purgeObjectSyncQueue,
  resolveObjectQueueRetentionCutoff
} from "../src/modules/sync-storage/application/object-queue-purge";

const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };
type CountRow = { total: number };

/**
 * Counts what a real run WOULD delete, with the same predicate.
 *
 * Deliberately re-states the terminal statuses rather than sharing a fragment:
 * a preview that can disagree with the delete is worse than no preview, and
 * this repo has no shared SQL builder to make the two provably identical.
 * `tests/object-queue-purge.test.ts` pins the two lists against each other.
 */
async function previewTenant(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<number> {
  const cutoff = resolveObjectQueueRetentionCutoff(
    now,
    OBJECT_QUEUE_DEFAULT_RETENTION_DAYS
  );

  const rows = (await sql`
    SELECT count(*)::int AS total
    FROM awcms_object_sync_queue
    WHERE tenant_id = ${tenantId}
      AND status IN ('sent', 'failed')
      AND created_at < ${cutoff}
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
        const result = await purgeObjectSyncQueue(
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
      `sync:objects:purge ${dryRun ? "DRY RUN" : "complete"} — ` +
        `correlationId=${correlationId} tenants=${tenants.length} rows=${total}`
    );
  } catch (error) {
    logScriptFailure("sync:objects:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
