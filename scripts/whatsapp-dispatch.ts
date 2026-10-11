/**
 * whatsapp-dispatch.ts — `bun run whatsapp:dispatch`.
 *
 * Issue #963 (ADR-0133). Internal worker entrypoint for the WhatsApp dispatcher
 * (`src/modules/whatsapp-delivery/application/whatsapp-dispatch.ts`) — run on a
 * schedule, never exposed over HTTP. Mirrors `scripts/push-dispatch.ts`:
 * iterates every `active` tenant and drains its due `awcms_whatsapp_messages`
 * backlog in batches, looping per tenant until a batch claims nothing or
 * `MAX_PASSES_PER_TENANT` is hit.
 *
 * No-op (claims nothing, exits 0) when `WHATSAPP_ENABLED` is not `"true"` — see
 * `dispatchWhatsappQueue`'s own early return — which is what makes it safe to
 * schedule on every deployment profile including offline/LAN.
 *
 * A pass that throws for one tenant is recorded as a `whatsapp.dispatch.failed`
 * event for THAT tenant and does not stop the other tenants.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  dispatchWhatsappQueue,
  recordWhatsappDispatchFailure
} from "../src/modules/whatsapp-delivery/application/whatsapp-dispatch";

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
    let totalSuppressed = 0;
    let failedTenants = 0;

    for (const tenant of tenants) {
      try {
        for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
          const result = await dispatchWhatsappQueue(sql, tenant.id, {
            correlationId
          });

          totalClaimed += result.claimed;
          totalSent += result.sent;
          totalRetried += result.retried;
          totalFailed += result.failed;
          totalExpired += result.expired;
          totalCancelled += result.cancelled;
          totalSuppressed += result.recipientsSuppressed;

          if (result.claimed === 0) {
            break;
          }
        }
      } catch (error) {
        failedTenants += 1;
        logScriptFailure("whatsapp:dispatch tenant pass FAILED", error);

        try {
          await recordWhatsappDispatchFailure(sql, tenant.id, "dispatch_error");
        } catch (recordError) {
          logScriptFailure(
            "whatsapp:dispatch could not record the failure event",
            recordError
          );
        }
      }
    }

    console.log(
      `whatsapp:dispatch complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} claimed=${totalClaimed} sent=${totalSent} ` +
        `retried=${totalRetried} failed=${totalFailed} expired=${totalExpired} ` +
        `cancelled=${totalCancelled} recipientsSuppressed=${totalSuppressed} ` +
        `failedTenants=${failedTenants}`
    );
  } catch (error) {
    logScriptFailure("whatsapp:dispatch FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
