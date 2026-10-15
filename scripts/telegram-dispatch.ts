/**
 * telegram-dispatch.ts — `bun run telegram:dispatch`.
 *
 * Issue #965 (ADR-0140). Internal worker entrypoint for the Telegram dispatcher
 * (`src/modules/telegram-delivery/application/telegram-dispatch.ts`) — run on a
 * schedule, never exposed over HTTP. Mirrors `scripts/whatsapp-dispatch.ts`:
 * iterates every `active` tenant and drains its due `awcms_telegram_messages`
 * backlog in batches, looping per tenant until a batch claims nothing or
 * `MAX_PASSES_PER_TENANT` is hit.
 *
 * No-op (claims nothing, exits 0) when `TELEGRAM_ENABLED` is not `"true"` — see
 * `dispatchTelegramQueue`'s own early return — which is what makes it safe to
 * schedule on every deployment profile including offline/LAN.
 *
 * One bot means one rate budget: the adapter's pacer is shared by every tenant of
 * this run (one provider instance), so the global ceiling under 30 messages a
 * second holds across tenants. Run it from ONE cron entry (`flock`); two
 * concurrent runs would each pace themselves and could together exceed it.
 *
 * A pass that throws for one tenant does not stop the other tenants.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { dispatchTelegramQueue } from "../src/modules/telegram-delivery/application/telegram-dispatch";

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
    let totalExpired = 0;
    let totalCancelled = 0;
    let totalDeferred = 0;
    let totalRateLimited = 0;
    let totalBindingsEnded = 0;
    let failedTenants = 0;

    for (const tenant of tenants) {
      try {
        for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
          const result = await dispatchTelegramQueue(sql, tenant.id, {
            correlationId
          });

          totalClaimed += result.claimed;
          totalSent += result.sent;
          totalRetried += result.retried;
          totalFailed += result.failed;
          totalExpired += result.expired;
          totalCancelled += result.cancelled;
          totalDeferred += result.deferred;
          totalRateLimited += result.rateLimited;
          totalBindingsEnded += result.bindingsEnded;

          // A deferred or rate-limited row is due LATER, not now: claiming again
          // in the same run would find nothing, so stop rather than spin.
          if (
            result.claimed === 0 ||
            result.rateLimited > 0 ||
            result.deferred > 0
          ) {
            break;
          }
        }
      } catch (error) {
        failedTenants += 1;
        logScriptFailure("telegram:dispatch tenant pass FAILED", error);
      }
    }

    console.log(
      `telegram:dispatch complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} claimed=${totalClaimed} sent=${totalSent} ` +
        `retried=${totalRetried} failed=${totalFailed} expired=${totalExpired} ` +
        `cancelled=${totalCancelled} deferred=${totalDeferred} ` +
        `rateLimited=${totalRateLimited} bindingsEnded=${totalBindingsEnded} ` +
        `failedTenants=${failedTenants}`
    );
  } catch (error) {
    logScriptFailure("telegram:dispatch FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
