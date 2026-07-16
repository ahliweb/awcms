/**
 * email-dispatch.ts — `bun run email:dispatch`.
 *
 * Issue #495 (epic #492). Internal worker entrypoint for the email
 * dispatcher (`src/modules/email/application/email-dispatch.ts`) — intended
 * to run on a schedule (cron/systemd timer/k8s CronJob), not exposed over
 * HTTP. Mirrors `scripts/object-sync-dispatch.ts` exactly: iterates every
 * `active` tenant and drains its due `awcms_email_messages` backlog in
 * batches, looping per tenant until a batch claims nothing or
 * `MAX_PASSES_PER_TENANT` is hit.
 *
 * No-op (claims nothing, exits 0) when `EMAIL_ENABLED` is not `"true"` —
 * see `dispatchEmailQueue`'s own early return.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { dispatchEmailQueue } from "../src/modules/email/application/email-dispatch";

const MAX_PASSES_PER_TENANT = 20;

type TenantRow = { id: string };

async function main() {
  // `getWorkerDatabaseClient` connects as the least-privilege worker role
  // when configured, falling back to DATABASE_URL otherwise.
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
        const result = await dispatchEmailQueue(sql, tenant.id, {
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
      `email:dispatch complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} claimed=${totalClaimed} sent=${totalSent} ` +
        `retried=${totalRetried} failed=${totalFailed}`
    );
  } catch (error) {
    logScriptFailure("email:dispatch FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
