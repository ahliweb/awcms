/**
 * Key rotation for `awcms_telegram_bindings.chat_ciphertext` (Issue #1098).
 *
 * The runbook says to keep an old `TELEGRAM_CHAT_ENCRYPTION_KEYS` key "until no
 * row carries it", but nothing ever re-keyed a row: a binding is written once
 * (at confirmation) and never re-encrypted, so after a key compromise the old key
 * could not be retired. This moves every live binding whose ciphertext key id is
 * not the ring's ACTIVE (first) key onto it; all ring keys still read.
 *
 * ## Which role runs it
 *
 * `awcms_app`, NOT `awcms_worker`. `awcms_telegram_bindings_activation_guard`
 * (sql/216, audit N2) deliberately refuses any role but `awcms_app` writing a
 * live ciphertext, so a worker that holds the key ring cannot re-point a binding
 * at another chat. The guard cannot tell a re-key from a swap, and loosening it
 * would reopen exactly that hole, so this job is the one place the operator
 * runs a tool with the app connection (`DATABASE_URL`). It is manual, bounded
 * and audited-by-count only (no chat id, hash or ciphertext leaves it).
 *
 * Contract (same as the push auth-secret backfill): idempotent (a re-keyed row
 * no longer matches), resumable (progress is the data, keyset cursor within a
 * run), batched (one transaction per batch), race-safe (`FOR UPDATE` plus a
 * compare-and-swap on the exact old ciphertext, so a concurrent revocation that
 * erased the ciphertext is never resurrected). A row that cannot be decrypted is
 * counted in `failed` and left untouched. The AAD (purpose, tenant, binding id)
 * is unchanged, so only the key id and IV/tag differ.
 */
import type { KeyRing } from "../../../lib/security/field-encryption";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { decryptChatId, encryptChatId } from "../domain/telegram-chat";

const MODULE_KEY = "telegram_delivery";

export const TELEGRAM_CHAT_REKEY_DEFAULT_LIMIT = 200;

export type RekeyTelegramChatsResult = {
  converted: number;
  failed: number;
  complete: boolean;
  lastId: string | null;
};

type BindingRow = { id: string; chat_ciphertext: string };

export async function rekeyTelegramChatsBatch(
  sql: Bun.SQL,
  tenantId: string,
  ring: KeyRing,
  options: { afterId?: string | null; limit?: number } = {}
): Promise<RekeyTelegramChatsResult> {
  const limit = options.limit ?? TELEGRAM_CHAT_REKEY_DEFAULT_LIMIT;
  const afterId = options.afterId ?? null;
  const activeKeyId = ring.keys[0]!.id;

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT id, chat_ciphertext
        FROM awcms_telegram_bindings
        WHERE tenant_id = ${tenantId}
          AND chat_ciphertext IS NOT NULL
          AND chat_ciphertext NOT LIKE '[erased]%'
          AND split_part(chat_ciphertext, ':', 2) <> ${activeKeyId}
          AND (${afterId}::uuid IS NULL OR id > ${afterId}::uuid)
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE
      `) as BindingRow[];

      let converted = 0;
      let failed = 0;

      for (const row of rows) {
        let fresh: string;

        try {
          fresh = encryptChatId(
            decryptChatId(row.chat_ciphertext, tenantId, row.id, ring),
            tenantId,
            row.id,
            ring
          );
        } catch {
          failed += 1;
          continue;
        }

        const updated = (await tx`
          UPDATE awcms_telegram_bindings
          SET chat_ciphertext = ${fresh}, updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
            AND chat_ciphertext = ${row.chat_ciphertext}
          RETURNING id
        `) as { id: string }[];

        converted += updated.length;
      }

      return {
        converted,
        failed,
        complete: rows.length < limit,
        lastId: rows.length > 0 ? rows[rows.length - 1]!.id : afterId
      };
    },
    { workClass: "maintenance" }
  );
}

export async function rekeyTelegramChatsForTenant(
  sql: Bun.SQL,
  tenantId: string,
  ring: KeyRing,
  options: { limit?: number; maxBatches?: number; correlationId?: string } = {}
): Promise<{ converted: number; failed: number; complete: boolean }> {
  const maxBatches = options.maxBatches ?? 1000;
  let converted = 0;
  let failed = 0;
  let afterId: string | null = null;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result: RekeyTelegramChatsResult = await rekeyTelegramChatsBatch(
      sql,
      tenantId,
      ring,
      {
        afterId,
        ...(options.limit === undefined ? {} : { limit: options.limit })
      }
    );

    converted += result.converted;
    failed += result.failed;
    afterId = result.lastId;

    if (result.complete) {
      if (converted > 0 || failed > 0) {
        log("info", "telegram.chat_ciphertext.rekeyed", {
          tenantId,
          moduleKey: MODULE_KEY,
          converted,
          failed,
          ...(options.correlationId
            ? { correlationId: options.correlationId }
            : {})
        });
      }

      return { converted, failed, complete: true };
    }
  }

  return { converted, failed, complete: false };
}

/** Rows per ciphertext key id for one tenant (counts only). Non-`v2` values are bucketed under `"?"`. */
export async function countTelegramChatsByKeyId(
  sql: Bun.SQL,
  tenantId: string
): Promise<Record<string, number>> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT CASE WHEN chat_ciphertext ~ '^v2:[a-z0-9]{1,8}:' THEN split_part(chat_ciphertext, ':', 2) ELSE '?' END AS key_id,
               count(*)::int AS rows
        FROM awcms_telegram_bindings
        WHERE tenant_id = ${tenantId}
          AND chat_ciphertext IS NOT NULL
          AND chat_ciphertext NOT LIKE '[erased]%'
        GROUP BY 1
      `) as { key_id: string; rows: number }[];

      return Object.fromEntries(rows.map((row) => [row.key_id, row.rows]));
    },
    { workClass: "maintenance" }
  );
}
