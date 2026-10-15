/**
 * telegram-queue-purge.ts — `bun run telegram:queue:purge`.
 *
 * Issue #965 (ADR-0140). Internal worker entrypoint — not exposed over HTTP, run
 * on a schedule. Drives
 * `src/modules/telegram-delivery/application/telegram-queue-purge.ts` per tenant
 * in bounded batches until a pass changes nothing or `MAX_PASSES_PER_TENANT` is
 * hit. Like `whatsapp:queue:purge` it does NOT go through `runJob`, so it has no
 * advisory lock — schedule it from ONE cron entry.
 *
 * Runs regardless of `TELEGRAM_ENABLED`: a deployment that turned Telegram OFF
 * still has rows and ENCRYPTED CHAT IDS from when it was on, and those are
 * precisely the rows nothing else will clean up. It EXPIRES any non-terminal
 * message past its `expires_at` (the backstop for a dispatcher that is not
 * draining), ends unconfirmed bindings past their window and every binding whose
 * module/tenant switch is off or whose person left (erasing the ciphertext),
 * and deletes only TERMINAL messages, spent attempts, revoked bindings and expired
 * codes past their retention — never a waiting message or a live binding.
 *
 * Retention windows are settings (`TELEGRAM_MESSAGE_RETENTION_DAYS`,
 * `TELEGRAM_BINDING_RETENTION_DAYS`, `TELEGRAM_LINK_CODE_RETENTION_DAYS`) inside
 * the descriptors' bounds.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";
import { purgeTelegramQueue } from "../src/modules/telegram-delivery/application/telegram-queue-purge";
import {
  resolveTelegramBindingRetentionDays,
  resolveTelegramLinkCodeRetentionDays,
  resolveTelegramMessageRetentionDays
} from "../src/modules/telegram-delivery/domain/telegram-config";

const MAX_PASSES_PER_TENANT = 50;

type TenantRow = { id: string };

async function main() {
  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    // EVERY tenant, not only active ones: erasing a chat id and expiring a stale
    // message must not depend on the tenant still being dispatched.
    const tenants = (await sql`SELECT id FROM awcms_tenants`) as TenantRow[];

    const totals = {
      expiredMessages: 0,
      expiredBindings: 0,
      sweptBindings: 0,
      purgedAttempts: 0,
      purgedMessages: 0,
      purgedBindings: 0,
      purgedLinkCodes: 0
    };

    for (const tenant of tenants) {
      for (let pass = 0; pass < MAX_PASSES_PER_TENANT; pass += 1) {
        const result = await purgeTelegramQueue(
          sql,
          tenant.id,
          legalHoldGuardPortAdapter,
          {
            correlationId,
            messageRetentionDays: resolveTelegramMessageRetentionDays(),
            bindingRetentionDays: resolveTelegramBindingRetentionDays(),
            linkCodeRetentionDays: resolveTelegramLinkCodeRetentionDays()
          }
        );
        const changed = Object.values(result).reduce((a, b) => a + b, 0);

        totals.expiredMessages += result.expiredMessages;
        totals.expiredBindings += result.expiredBindings;
        totals.sweptBindings += result.sweptBindings;
        totals.purgedAttempts += result.purgedAttempts;
        totals.purgedMessages += result.purgedMessages;
        totals.purgedBindings += result.purgedBindings;
        totals.purgedLinkCodes += result.purgedLinkCodes;

        if (changed === 0) {
          break;
        }
      }
    }

    console.log(
      `telegram:queue:purge complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} ` +
        Object.entries(totals)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")
    );
  } catch (error) {
    logScriptFailure("telegram:queue:purge FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
