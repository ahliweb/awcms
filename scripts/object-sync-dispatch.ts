/**
 * object-sync-dispatch.ts — `bun run sync:objects:dispatch`.
 *
 * Internal worker entrypoint for the object sync queue dispatcher
 * (`src/modules/sync-storage/application/object-dispatch.ts`) — intended to
 * be run on a schedule (cron/systemd timer/k8s CronJob), not exposed over
 * HTTP (see `src/modules/sync-storage/README.md` "Belum tersedia": only a
 * trusted internal worker may transition queue rows to `sent`/`failed`).
 *
 * Iterates every `active` tenant (`awcms_tenants` has no RLS — it is the
 * root table, not tenant-scoped data) and drains its due
 * `awcms_object_sync_queue` backlog in batches
 * (`OBJECT_DISPATCH_DEFAULT_LIMIT` rows per call), looping per tenant until a
 * batch claims nothing (backlog drained or fully gated by backoff/circuit
 * breaker) or `MAX_PASSES_PER_TENANT` is hit — a safety bound so one huge
 * backlog cannot make a single scheduled run run forever.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { dispatchObjectSyncQueue } from "../src/modules/sync-storage/application/object-dispatch";

const MAX_PASSES_PER_TENANT = 20;

type TenantRow = { id: string };

async function main() {
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];

    let totalClaimed = 0;
    let totalSent = 0;
    let totalRetried = 0;
    let totalFailed = 0;

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await dispatchObjectSyncQueue(sql, tenant.id, {
          correlationId
        });

        totalClaimed += result.claimed;
        totalSent += result.sent;
        totalRetried += result.retried;
        totalFailed += result.failed;

        if (result.claimed === 0) {
          break;
        }
      }
    }

    console.log(
      `sync:objects:dispatch complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} claimed=${totalClaimed} sent=${totalSent} ` +
        `retried=${totalRetried} failed=${totalFailed}`
    );
  } catch (error) {
    logScriptFailure("sync:objects:dispatch FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
