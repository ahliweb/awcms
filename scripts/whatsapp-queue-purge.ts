/**
 * whatsapp-queue-purge.ts — `bun run whatsapp:queue:purge`.
 *
 * Issue #963 (ADR-0133). Internal worker entrypoint — not exposed over HTTP, run
 * on a schedule. Drives
 * `src/modules/whatsapp-delivery/application/whatsapp-queue-purge.ts` per tenant
 * in bounded batches until a pass deletes nothing or `MAX_PASSES_PER_TENANT` is
 * hit. Like `push:queue:purge` it does NOT go through `runJob`, so it has no
 * advisory lock — schedule it from ONE cron entry.
 *
 * Runs regardless of `WHATSAPP_ENABLED`: a deployment that turned WhatsApp OFF
 * still has rows from when it was on, and those are precisely the rows nothing
 * else will clean up. It deletes only TERMINAL messages and spent attempts —
 * never a waiting message, a consent or a suppression — and it EXPIRES any
 * non-terminal message past its `expires_at` (clearing an OTP) for every tenant.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import { purgeWhatsappQueue } from "../src/modules/whatsapp-delivery/application/whatsapp-queue-purge";

const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };

async function main() {
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    // EVERY tenant, not only active ones: expiring a stale security message and
    // clearing its secret must not depend on the tenant still being dispatched.
    const tenants = (await sql`SELECT id FROM awcms_tenants`) as TenantRow[];

    let totalAttempts = 0;
    let totalMessages = 0;
    let totalExpired = 0;

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await purgeWhatsappQueue(
          sql,
          tenant.id,
          legalHoldGuardPortAdapter,
          { correlationId }
        );

        totalAttempts += result.purgedAttempts;
        totalMessages += result.purgedMessages;
        totalExpired += result.expiredMessages;

        if (
          result.purgedAttempts +
            result.purgedMessages +
            result.expiredMessages ===
          0
        ) {
          break;
        }
      }
    }

    console.log(
      `whatsapp:queue:purge complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} attempts=${totalAttempts} ` +
        `messages=${totalMessages} expired=${totalExpired}`
    );
  } catch (error) {
    logScriptFailure("whatsapp:queue:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
