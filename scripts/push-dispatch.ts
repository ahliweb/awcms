/**
 * push-dispatch.ts — `bun run push:dispatch`.
 *
 * Issue #465 (epic #463, ADR-0074). Internal worker entrypoint for the push
 * dispatcher (`src/modules/push-delivery/application/push-dispatch.ts`) —
 * intended to run on a schedule (cron/systemd timer/k8s CronJob), never exposed
 * over HTTP. Mirrors `scripts/email-dispatch.ts`: iterates every `active`
 * tenant and drains its due `awcms_push_messages` backlog in batches, looping
 * per tenant until a batch claims nothing or `MAX_PASSES_PER_TENANT` is hit.
 *
 * No-op (claims nothing, exits 0) when `PUSH_ENABLED` is not `"true"` — see
 * `dispatchPushQueue`'s own early return. That is what makes it safe to
 * schedule on every deployment profile including offline/LAN.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { dispatchPushQueue } from "../src/modules/push-delivery/application/push-dispatch";

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
    let totalDisabled = 0;

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await dispatchPushQueue(sql, tenant.id, {
          correlationId
        });

        totalClaimed += result.claimed;
        totalSent += result.sent;
        totalRetried += result.retried;
        totalFailed += result.failed;
        totalDisabled += result.subscriptionsDisabled;

        if (result.claimed === 0) {
          break;
        }
      }
    }

    console.log(
      `push:dispatch complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} claimed=${totalClaimed} sent=${totalSent} ` +
        `retried=${totalRetried} failed=${totalFailed} ` +
        `subscriptionsDisabled=${totalDisabled}`
    );
  } catch (error) {
    logScriptFailure("push:dispatch FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
