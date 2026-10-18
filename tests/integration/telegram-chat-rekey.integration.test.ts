/**
 * Telegram chat-ciphertext key rotation (Issue #1098), against a real database.
 *
 * The re-key runs as `awcms_app`: the binding guard trigger (sql/216) refuses
 * the worker role any live ciphertext write, and that refusal is asserted here so
 * nobody "fixes" the job by moving it to the worker and loosening the guard.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  countTelegramChatsByKeyId,
  rekeyTelegramChatsBatch,
  rekeyTelegramChatsForTenant
} from "../../src/modules/telegram-delivery/application/telegram-chat-rekey";
import {
  decryptChatId,
  encryptChatId
} from "../../src/modules/telegram-delivery/domain/telegram-chat";
import { resolveTelegramEncryptionRingUnchecked } from "../../src/modules/telegram-delivery/domain/telegram-config";

const TENANT = "a1098000-0000-4000-8000-000000000001";
const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 3) % 251)
  ).toString("base64");
const K1 = bytes(7);
const K2 = bytes(13);
const K3 = bytes(17);

function ringOf(spec: string) {
  const ring = resolveTelegramEncryptionRingUnchecked({
    TELEGRAM_CHAT_ENCRYPTION_KEYS: spec
  } as unknown as NodeJS.ProcessEnv);

  if (!ring.ok) throw new Error(ring.reason);

  return ring;
}

const OLD_RING = ringOf(`k1:${K1}`);
const ROTATED = ringOf(`k2:${K2},k1:${K1}`);
const USERS = [1, 2, 3, 4].map(
  (n) => `a1098000-0000-4000-8000-00000000010${n}`
);

async function seed(): Promise<string[]> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'tg-rekey', 'Telegram Rekey')
  `;

  const bindingIds: string[] = [];

  for (const [index, userId] of USERS.entries()) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', ${`u${index}`}) RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, ${`u${index}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${userId}, ${TENANT}, ${identity[0]!.id})
    `;

    const bindingId = crypto.randomUUID();
    const chatId = String(5550000000 + index);

    // The activation guard (sql/216) lets only awcms_app make a binding
    // `active`, and only from `pending_confirmation`: seed it the same way.
    await admin`
      INSERT INTO awcms_telegram_bindings
        (id, tenant_id, principal_id, status, chat_ciphertext, chat_hash,
         hash_key_id, chat_masked, pending_expires_at)
      VALUES (${bindingId}, ${TENANT}, ${userId}, 'pending_confirmation',
              ${encryptChatId(chatId, TENANT, bindingId, OLD_RING)},
              ${`k1:hash${index}`}, 'k1', ${`***${index}`},
              now() + interval '1 hour')
    `;
    await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      (tx) => tx`
        UPDATE awcms_telegram_bindings
        SET status = 'active', pending_expires_at = NULL, confirmed_at = now()
        WHERE tenant_id = ${TENANT} AND id = ${bindingId}
      `
    );
    bindingIds.push(bindingId);
  }

  return bindingIds;
}

async function ciphertextOf(id: string): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT chat_ciphertext FROM awcms_telegram_bindings WHERE id = ${id}
  `) as { chat_ciphertext: string }[];

  return rows[0]!.chat_ciphertext;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("telegram chat ciphertext re-key (#1098)", () => {
  let ids: string[] = [];

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    ids = await seed();
  });

  test("re-key is batched, resumable and idempotent, and the chat id round-trips", async () => {
    const sql = getRuntimeSql();

    expect(await countTelegramChatsByKeyId(sql, TENANT)).toEqual({ k1: 4 });

    const first = await rekeyTelegramChatsBatch(sql, TENANT, ROTATED, {
      limit: 3
    });

    expect(first).toMatchObject({ converted: 3, failed: 0, complete: false });
    expect(await countTelegramChatsByKeyId(sql, TENANT)).toEqual({
      k1: 1,
      k2: 3
    });

    const rest = await rekeyTelegramChatsForTenant(sql, TENANT, ROTATED, {
      limit: 3
    });

    expect(rest).toEqual({ converted: 1, failed: 0, complete: true });
    expect(await countTelegramChatsByKeyId(sql, TENANT)).toEqual({ k2: 4 });

    const before = await Promise.all(ids.map(ciphertextOf));

    expect(await rekeyTelegramChatsForTenant(sql, TENANT, ROTATED)).toEqual({
      converted: 0,
      failed: 0,
      complete: true
    });
    expect(await Promise.all(ids.map(ciphertextOf))).toEqual(before);

    // Readable with the NEW key alone, same AAD, same chat id.
    const newOnly = ringOf(`k2:${K2}`);

    for (const [index, id] of ids.entries()) {
      expect(decryptChatId(await ciphertextOf(id), TENANT, id, newOnly)).toBe(
        String(5550000000 + index)
      );
    }
  });

  test("erased and revoked bindings are not touched, and undecryptable ones are counted", async () => {
    const admin = getAdminSql();

    await admin`
      UPDATE awcms_telegram_bindings
      SET status = 'revoked', chat_ciphertext = NULL, revoked_at = now(),
          revoke_cause = 'admin'
      WHERE id = ${ids[0]!}
    `;

    const sql = getRuntimeSql();
    const wrong = ringOf(`k3:${K3}`);
    const result = await rekeyTelegramChatsForTenant(sql, TENANT, wrong);

    expect(result).toEqual({ converted: 0, failed: 3, complete: true });
    expect(await countTelegramChatsByKeyId(sql, TENANT)).toEqual({ k1: 3 });
  });

  test("a concurrent erasure is not resurrected (compare-and-swap)", async () => {
    const sql = getRuntimeSql();
    const target = ids[1]!;
    const stale = await ciphertextOf(target);
    const admin = getAdminSql();

    // The row is erased AFTER being read but before the UPDATE would run: model
    // it by running the swap statement against the old ciphertext directly.
    await admin`
      UPDATE awcms_telegram_bindings
      SET status = 'revoked', chat_ciphertext = NULL, revoked_at = now(),
          revoke_cause = 'self_stop'
      WHERE id = ${target}
    `;

    const swapped = await withTenantOrThrow(
      sql,
      TENANT,
      (tx) => tx`
        UPDATE awcms_telegram_bindings
        SET chat_ciphertext = 'v2:k2:x:y:z'
        WHERE tenant_id = ${TENANT} AND id = ${target}
          AND chat_ciphertext = ${stale}
        RETURNING id
      `
    );

    expect((swapped as unknown[]).length).toBe(0);
    expect(await rekeyTelegramChatsForTenant(sql, TENANT, ROTATED)).toEqual({
      converted: 3,
      failed: 0,
      complete: true
    });
  });

  test("the worker role cannot write a live ciphertext (why this job runs as the app role)", async () => {
    if (!workerRoleActivated) return;

    await assertRejected(
      withTenantOrThrow(
        getWorkerRoleSql(),
        TENANT,
        (tx) => tx`
          UPDATE awcms_telegram_bindings
          SET chat_ciphertext = ${encryptChatId("5551112223", TENANT, ids[0]!, ROTATED)}
          WHERE tenant_id = ${TENANT} AND id = ${ids[0]!}
        `
      ),
      "the worker writing a live chat ciphertext"
    );
  });
});
