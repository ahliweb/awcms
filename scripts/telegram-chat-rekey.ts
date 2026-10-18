/**
 * telegram-chat-rekey.ts — `bun run telegram:chat:rekey`.
 *
 * Issue #1098. Manual key-rotation job: re-encrypts every live
 * `awcms_telegram_bindings.chat_ciphertext` that is not under the ACTIVE (first)
 * key of `TELEGRAM_CHAT_ENCRYPTION_KEYS`, so an old key can be retired. The ring
 * must still contain the old key. See
 * `src/modules/telegram-delivery/application/telegram-chat-rekey.ts` for the
 * contract and for why this runs as `awcms_app` (the binding guard trigger
 * refuses the worker role any ciphertext write, sql/216).
 *
 * Exits 1 without a valid ring (nothing converted must never read as success),
 * 2 when a tenant did not finish, 3 when rows could not be decrypted under the
 * ring. Never prints key material, ciphertext or a chat id.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { rekeyTelegramChatsForTenant } from "../src/modules/telegram-delivery/application/telegram-chat-rekey";
import { resolveTelegramEncryptionRing } from "../src/modules/telegram-delivery/domain/telegram-config";

async function main() {
  const ring = resolveTelegramEncryptionRing(process.env);

  if (!ring.ok) {
    console.error(
      `telegram:chat:rekey REFUSED — ${ring.reason} Set TELEGRAM_CHAT_ENCRYPTION_KEYS first.`
    );
    process.exitCode = 1;

    return;
  }

  const sql = getDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants ORDER BY id
    `) as { id: string }[];

    let converted = 0;
    let failed = 0;
    let incomplete = 0;

    for (const tenant of tenants) {
      const result = await rekeyTelegramChatsForTenant(sql, tenant.id, ring, {
        correlationId
      });

      converted += result.converted;
      failed += result.failed;

      if (!result.complete) {
        incomplete += 1;
      }
    }

    console.log(
      `telegram:chat:rekey complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} converted=${converted} undecryptable=${failed} incompleteTenants=${incomplete}`
    );

    if (incomplete > 0) {
      process.exitCode = 2;
    } else if (failed > 0) {
      process.exitCode = 3;
    }
  } catch (error) {
    logScriptFailure("telegram:chat:rekey FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
