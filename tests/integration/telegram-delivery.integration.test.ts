/**
 * `telegram_delivery` against a real PostgreSQL, as the least-privilege runtime
 * role (enqueue, bindings, webhook) and as `awcms_worker` (dispatch, purge), with
 * FORCE RLS in force (Issue #965, ADR-0140).
 *
 * The properties that live in the database and in the claim/send/finalise and
 * handshake choreography, and that a mock could not prove:
 *
 *   * THE HANDSHAKE: a chat that merely sends the bot a message cannot be
 *     messaged; a code is consumed atomically (two parallel uses, one binding); a
 *     code forwarded to another chat yields at most `pending_confirmation`, which
 *     receives nothing until the owner confirms in their own session; a group or
 *     channel never binds; an unknown, expired and consumed code get the same
 *     reply; one chat belongs to one principal per tenant; `/stop` finds its
 *     binding across tenants by keyed hash, including across a ring rotation.
 *   * ERASURE: revocation (self, administrator, `/stop`, deactivation, module off,
 *     tenant off, 403) nulls the ciphertext, cancels the queue, and leaves the
 *     hash as a tombstone; the schema itself refuses a revoked row that holds a
 *     ciphertext.
 *   * NO LEAK: the chat id appears in no table but `chat_ciphertext` (and then
 *     only encrypted), no audit row, no attempt row, no queue row; the bot token
 *     in a provider error is stored nowhere.
 *   * DISPATCH: no network I/O inside a transaction; a deactivated or roleless
 *     principal is not messaged and loses its binding; a closed tenant gate sends
 *     nothing; `429` reschedules to `retry_after` without spending the retry
 *     budget and releases the rest of the batch; the per-chat spacing defers.
 *   * PURGE: expiry is enforced without the dispatcher, a waiting message and a
 *     live binding are never deleted, retention follows the settings.
 *   * GRANTS: the worker cannot create a binding or a code, or write the switch.
 *
 * Gated on `DATABASE_URL` (harness, Gating).
 */
import {
  afterAll,
  afterEach,
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
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import { issueMachineCredential } from "../../src/modules/identity-access/application/machine-credential-directory";
import { refuseNonInteractive } from "../../src/modules/telegram-delivery/application/telegram-interactive-guard";
import { resetProviderCircuitBreakersForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  confirmOwnBinding,
  endBindings,
  getOwnBinding,
  listBindings,
  rejectOwnBinding
} from "../../src/modules/telegram-delivery/application/telegram-bindings";
import { dispatchTelegramQueue } from "../../src/modules/telegram-delivery/application/telegram-dispatch";
import {
  cancelTelegramByCorrelation,
  enqueueActivationNotice,
  enqueueTelegramMessage,
  getTelegramStatusByCorrelation,
  telegramDeliveryPortAdapter
} from "../../src/modules/telegram-delivery/application/telegram-enqueue";
import { createLinkCode } from "../../src/modules/telegram-delivery/application/telegram-link-codes";
import { purgeTelegramQueue } from "../../src/modules/telegram-delivery/application/telegram-queue-purge";
import { setTelegramEnabled } from "../../src/modules/telegram-delivery/application/telegram-settings";
import { handleTelegramWebhookUpdate } from "../../src/modules/telegram-delivery/application/telegram-webhook";
import {
  flushWebhookRejections,
  recordWebhookRejection,
  resetWebhookRejectionsForTests
} from "../../src/modules/telegram-delivery/application/telegram-webhook-guard";
import {
  runTelegramIdempotent,
  TELEGRAM_BINDING_REVOKE_IDEMPOTENCY_SCOPE
} from "../../src/modules/telegram-delivery/application/telegram-idempotency";
import {
  resolveTelegramEncryptionRing,
  resolveTelegramHashRing
} from "../../src/modules/telegram-delivery/domain/telegram-config";
import {
  TELEGRAM_REPLY_CODE_NOT_VALID,
  telegramReplyAlreadyLinked,
  telegramReplyLinked,
  TELEGRAM_REPLY_STOPPED,
  generateLinkCode
} from "../../src/modules/telegram-delivery/domain/telegram-link-code";
import type {
  TelegramProvider,
  TelegramSendRequest,
  TelegramSendResult
} from "../../src/modules/telegram-delivery/domain/telegram-provider-contract";
import { registerTelegramTemplate } from "../../src/modules/telegram-delivery/domain/telegram-templates";

const TENANT_A = "a9650000-0000-4000-8000-00000000000a";
const TENANT_B = "a9650000-0000-4000-8000-00000000000b";
const USER_1 = "c9650000-0000-4000-8000-000000000001";
const USER_2 = "c9650000-0000-4000-8000-000000000002";
const USER_3 = "c9650000-0000-4000-8000-000000000003";
const USER_B1 = "c9650000-0000-4000-8000-0000000000b1";
const ROLE_A = "d9650000-0000-4000-8000-00000000000a";
const ROLE_B = "d9650000-0000-4000-8000-00000000000b";

const CHAT_1 = 5551234567;
const CHAT_2 = 5559876543;
const GROUP_CHAT = -1001234567890;

const TOKEN = "123456789:AAH_fake_token_value_for_tests_0123456789";
const KEY_ENC = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const KEY_HASH = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 251)
).toString("base64");
const KEY_HASH_2 = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 9) % 251)
).toString("base64");

const ENV = {
  TELEGRAM_ENABLED: "true",
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_BOT_USERNAME: "Awcms_staff_bot",
  TELEGRAM_WEBHOOK_SECRET:
    "w".repeat(8) + "0123456789abcdefghijklmnopABCDEFGH_-",
  TELEGRAM_CHAT_ENCRYPTION_KEYS: `k1:${KEY_ENC}`,
  TELEGRAM_CHAT_HASH_KEYS: `k1:${KEY_HASH}`
} as NodeJS.ProcessEnv;

registerTelegramTemplate({
  ownerModuleKey: "booking",
  key: "booking.it965_alert",
  version: 1,
  purpose: "staff_ops",
  body: "Count {{count}} for {{ref}}",
  variables: [
    { name: "count", kind: "count" },
    { name: "ref", kind: "reference" }
  ]
});

const runtime = () => getRuntimeSql();
const inTenant = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(runtime(), tenantId, fn);

let sequence = 0;
const nextKey = () => `key-${(sequence += 1)}`;
const soon = () => new Date(Date.now() + 60 * 60_000);

const startUpdate = (code: string, chatId: number, over: object = {}) => ({
  update_id: (sequence += 1),
  message: {
    text: `/start ${code}`,
    chat: { id: chatId, type: "private" },
    from: {
      id: chatId,
      is_bot: false,
      first_name: "Sari",
      last_name: "Wulan",
      username: "sari_wulan"
    },
    ...over
  }
});

const stopUpdate = (chatId: number) => ({
  update_id: (sequence += 1),
  message: {
    text: "/stop",
    chat: { id: chatId, type: "private" },
    from: { id: chatId, is_bot: false }
  }
});

/** The PIN in the last `/start` reply (Issue #1008): what the person would read in their chat. */
let lastPin = "";

async function webhook(update: unknown, env: NodeJS.ProcessEnv = ENV) {
  const result = await handleTelegramWebhookUpdate(() => runtime(), update, {
    env
  });
  const pin = /PIN is (\d{6})/.exec(result.reply ?? "")?.[1];

  if (pin) {
    lastPin = pin;
  }

  return result;
}

const HASH_RING = (() => {
  const ring = resolveTelegramHashRing(ENV);

  if (!ring.ok) {
    throw new Error("test hash ring must resolve");
  }

  return ring;
})();

/** `confirmOwnBinding` with the PIN the bot last sent, unless the test says otherwise. */
function confirmWithPin(
  tx: Bun.SQL,
  tenantId: string,
  userId: string,
  bindingId: string,
  pin: string = lastPin
) {
  return confirmOwnBinding(tx, tenantId, userId, bindingId, pin, HASH_RING);
}

async function requestCode(tenantId: string, userId: string): Promise<string> {
  const result = await inTenant(tenantId, (tx) =>
    createLinkCode(tx, tenantId, userId)
  );

  if (result.outcome !== "created") {
    throw new Error("expected a code");
  }

  return result.code;
}

/** The id of the chat now waiting for this person's confirmation (what the screen shows and sends back). */
async function pendingBindingId(
  tenantId: string,
  userId: string
): Promise<string> {
  const own = await inTenant(tenantId, (tx) =>
    getOwnBinding(tx, tenantId, userId)
  );

  if (!own) {
    throw new Error("expected a pending binding");
  }

  return own.id;
}

/** The whole happy path: request a code, open it in the chat, confirm in the session. */
async function activate(
  tenantId: string,
  userId: string,
  chatId: number,
  env: NodeJS.ProcessEnv = ENV
): Promise<string> {
  const code = await requestCode(tenantId, userId);
  const linked = await webhook(startUpdate(code, chatId), env);

  expect(linked.outcome).toBe("linked");

  const confirmed = await inTenant(tenantId, async (tx) =>
    confirmWithPin(
      tx,
      tenantId,
      userId,
      (await getOwnBinding(tx, tenantId, userId))!.id
    )
  );

  if (confirmed.outcome !== "confirmed") {
    throw new Error("expected confirmation");
  }

  return confirmed.bindingId;
}

function enqueue(
  tenantId: string,
  principalId: string,
  over: Partial<Parameters<typeof enqueueTelegramMessage>[1]> = {},
  env: NodeJS.ProcessEnv = ENV
) {
  return inTenant(tenantId, (tx) =>
    enqueueTelegramMessage(
      tx,
      {
        templateKey: "booking.it965_alert",
        recipientPrincipalId: principalId,
        variables: { count: "3", ref: "R-12" },
        idempotencyKey: nextKey(),
        expiresAt: soon(),
        ...over
      },
      { env }
    )
  );
}

type Fake = TelegramProvider & {
  requests: TelegramSendRequest[];
  openWorkerTransactions: number[];
};

/** A fake provider that records what it was given and, at the instant of `send`, how many transactions the WORKER role has open. */
function fakeProvider(
  script: (
    request: TelegramSendRequest,
    call: number
  ) => TelegramSendResult | Promise<TelegramSendResult>
): Fake {
  const requests: TelegramSendRequest[] = [];
  const openWorkerTransactions: number[] = [];

  return {
    requests,
    openWorkerTransactions,
    async send(request) {
      const rows = (await getAdminSql()`
        SELECT count(*)::int AS open
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND usename = 'awcms_worker'
          AND state LIKE 'idle in transaction%'
      `) as { open: number }[];

      openWorkerTransactions.push(rows[0]!.open);
      requests.push(request);

      return await script(request, requests.length);
    },
    async healthCheck() {
      return { ok: true };
    }
  };
}

const OK: TelegramSendResult = { ok: true, providerMessageId: "9001" };

function dispatch(
  tenantId: string,
  provider: TelegramProvider,
  over: { now?: Date; env?: NodeJS.ProcessEnv; limit?: number } = {}
) {
  return dispatchTelegramQueue(getWorkerRoleSql(), tenantId, {
    resolveProvider: () => provider,
    now: over.now ?? new Date(),
    env: over.env ?? ENV,
    ...(over.limit ? { limit: over.limit } : {})
  });
}

async function message(id: string) {
  const rows = (await getAdminSql()`
    SELECT * FROM awcms_telegram_messages WHERE id = ${id}
  `) as Record<string, unknown>[];

  return rows[0]!;
}

async function bindingRow(id: string) {
  const rows = (await getAdminSql()`
    SELECT * FROM awcms_telegram_bindings WHERE id = ${id}
  `) as Record<string, unknown>[];

  return rows[0]!;
}

async function bindingsOf(tenantId: string) {
  return (await getAdminSql()`
    SELECT * FROM awcms_telegram_bindings WHERE tenant_id = ${tenantId}
    ORDER BY created_at
  `) as Record<string, unknown>[];
}

async function count(table: string): Promise<number> {
  const rows = (await getAdminSql().unsafe(
    `SELECT count(*)::int AS n FROM ${table}`
  )) as { n: number }[];

  return rows[0]!.n;
}

/** Every awcms_telegram_* table plus the audit log, as one searchable string. */
async function everythingStored(): Promise<string> {
  const admin = getAdminSql();
  const parts: unknown[] = [];

  for (const table of [
    "awcms_telegram_settings",
    "awcms_telegram_link_codes",
    "awcms_telegram_bindings",
    "awcms_telegram_messages",
    "awcms_telegram_delivery_attempts",
    "awcms_audit_events",
    "awcms_abac_decision_logs"
  ]) {
    parts.push(await admin.unsafe(`SELECT * FROM ${table}`));
  }

  return JSON.stringify(parts);
}

async function auditActions(tenantId: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT action FROM awcms_audit_events
    WHERE tenant_id = ${tenantId} AND module_key = 'telegram_delivery'
    ORDER BY created_at, id
  `) as { action: string }[];

  return rows.map((row) => row.action);
}

async function seedTenants(): Promise<void> {
  const admin = getAdminSql();

  for (const [id, code] of [
    [TENANT_A, "tg965-a"],
    [TENANT_B, "tg965-b"]
  ] as const) {
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name)
    VALUES (${ROLE_A}, ${TENANT_A}, 'it965-staff', 'Staff'),
           (${ROLE_B}, ${TENANT_B}, 'it965-staff-b', 'Staff B')
  `;

  for (const [userId, tenantId, roleId, label] of [
    [USER_1, TENANT_A, ROLE_A, "u1"],
    [USER_2, TENANT_A, ROLE_A, "u2"],
    [USER_3, TENANT_A, ROLE_A, "u3"],
    [USER_B1, TENANT_B, ROLE_B, "b1"]
  ] as const) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', ${`P ${label}`}) RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
    `;
    await admin`
      INSERT INTO awcms_access_policies
        (tenant_id, tenant_user_id, role_id, scope_type, scope_id, status, effective_from)
      VALUES (${tenantId}, ${userId}, ${roleId}, 'tenant', ${tenantId}, 'active',
              now() - interval '1 minute')
    `;
  }
}

async function turnOn(tenantId: string, actor: string): Promise<void> {
  await inTenant(tenantId, (tx) =>
    setTelegramEnabled(tx, tenantId, true, actor)
  );
}

/**
 * `workerRoleActivated` is a live binding that `setupIntegrationDatabase` flips
 * in `beforeAll`, so it must be read when the test RUNS — reading it while the
 * suite is being collected would skip every worker test unconditionally.
 */
function workerTest(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    if (!workerRoleActivated) return;

    await fn();
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("telegram_delivery against PostgreSQL", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetProviderCircuitBreakersForTests();
    resetWebhookRejectionsForTests();
    await seedTenants();
    await turnOn(TENANT_A, USER_1);
    await turnOn(TENANT_B, USER_B1);
  });

  afterEach(() => {
    delete process.env.PLATFORM_TENANT_ID;
  });

  // -------------------------------------------------------------------------
  describe("the handshake", () => {
    test("a chat that merely sends the bot a message cannot be messaged", async () => {
      const bare = await webhook({
        message: {
          text: "hello",
          chat: { id: CHAT_1, type: "private" },
          from: { id: CHAT_1, is_bot: false }
        }
      });

      expect(bare).toMatchObject({ reply: null, outcome: "ignored" });
      expect(await count("awcms_telegram_bindings")).toBe(0);
      expect(await enqueue(TENANT_A, USER_1)).toEqual({
        status: "refused",
        reason: "NO_BINDING"
      });
    });

    test("a code stores only its hash; the link is shown once", async () => {
      const result = await inTenant(TENANT_A, (tx) =>
        createLinkCode(tx, TENANT_A, USER_1)
      );

      expect(result.outcome).toBe("created");

      const code = (result as { code: string }).code;
      const rows = (await getAdminSql()`
        SELECT code_hash FROM awcms_telegram_link_codes
      `) as { code_hash: string }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await everythingStored()).not.toContain(code);
    });

    test("a newer code invalidates the previous one, and requests are rate limited", async () => {
      const first = await requestCode(TENANT_A, USER_1);
      const second = await requestCode(TENANT_A, USER_1);

      expect((await webhook(startUpdate(first, CHAT_1))).outcome).toBe(
        "code_not_valid"
      );
      expect((await webhook(startUpdate(second, CHAT_1))).outcome).toBe(
        "linked"
      );

      // 2 requested so far for USER_1; three more are allowed, then the limit.
      for (let i = 0; i < 3; i += 1) {
        await requestCode(TENANT_A, USER_1);
      }

      expect(
        await inTenant(TENANT_A, (tx) => createLinkCode(tx, TENANT_A, USER_1))
      ).toEqual({ outcome: "rate_limited" });
    });

    test("/start creates a PENDING binding; the chat is ciphertext and the reply asks for confirmation", async () => {
      const code = await requestCode(TENANT_A, USER_1);
      const result = await webhook(startUpdate(code, CHAT_1));

      expect(result).toMatchObject({
        reply: telegramReplyLinked("tg965-a", lastPin),
        replyChatId: String(CHAT_1),
        outcome: "linked"
      });

      const [row] = await bindingsOf(TENANT_A);

      expect(row).toMatchObject({
        status: "pending_confirmation",
        principal_id: USER_1,
        chat_masked: "***567",
        display_name: "Sari Wulan",
        username_masked: "@s******n"
      });
      expect(String(row!.chat_ciphertext)).toMatch(/^v2:k1:/);
      expect(String(row!.chat_hash)).toMatch(/^k1:[0-9a-f]{64}$/);
      expect(row!.pending_expires_at).not.toBeNull();
      expect(await everythingStored()).not.toContain(String(CHAT_1));
      expect(await everythingStored()).not.toContain(code);
    });

    test("the tenant and principal come from the code row, never from the payload", async () => {
      const code = await requestCode(TENANT_A, USER_1);

      // Whatever the sender writes, the binding lands on the code's owner.
      await webhook(
        startUpdate(code, CHAT_1, {
          from: { id: CHAT_1, is_bot: false, first_name: USER_2 }
        })
      );

      const rows = await bindingsOf(TENANT_A);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.principal_id).toBe(USER_1);
      expect(await bindingsOf(TENANT_B)).toHaveLength(0);
    });

    test("a code forwarded to another chat binds at most PENDING: nothing is delivered until the owner confirms", async () => {
      const code = await requestCode(TENANT_A, USER_1);

      // The attacker's chat redeems the forwarded code first.
      expect((await webhook(startUpdate(code, CHAT_2))).outcome).toBe("linked");

      const [row] = await bindingsOf(TENANT_A);

      expect(row!.status).toBe("pending_confirmation");
      expect(await enqueue(TENANT_A, USER_1)).toEqual({
        status: "refused",
        reason: "NO_BINDING"
      });

      // The victim sees the attacker's chat in THEIR session and rejects it.
      const own = await inTenant(TENANT_A, (tx) =>
        getOwnBinding(tx, TENANT_A, USER_1)
      );

      expect(own?.status).toBe("pending_confirmation");
      expect(own?.chatMasked).toBe("***543");

      const rejected = await inTenant(TENANT_A, (tx) =>
        rejectOwnBinding(tx, TENANT_A, USER_1, own!.id)
      );

      expect(rejected).toEqual({ rejected: true, mismatch: false });

      const [after] = await bindingsOf(TENANT_A);

      expect(after).toMatchObject({
        status: "revoked",
        revoke_cause: "rejected",
        chat_ciphertext: null,
        display_name: null,
        username_masked: null
      });
      expect(await auditActions(TENANT_A)).toContain(
        "telegram_binding.rejected"
      );
    });

    test("a consumed code cannot be used again, and a parallel pair yields ONE binding", async () => {
      const code = await requestCode(TENANT_A, USER_1);
      const [one, two] = await Promise.all([
        webhook(startUpdate(code, CHAT_1)),
        webhook(startUpdate(code, CHAT_2))
      ]);

      expect([one.outcome, two.outcome].sort()).toEqual([
        "code_not_valid",
        "linked"
      ]);
      expect(await bindingsOf(TENANT_A)).toHaveLength(1);
      expect((await webhook(startUpdate(code, CHAT_1))).outcome).toBe(
        "code_not_valid"
      );
    });

    test("an unknown, expired, consumed and malformed code get the SAME reply", async () => {
      const used = await requestCode(TENANT_A, USER_1);
      await webhook(startUpdate(used, CHAT_1));

      const expired = await requestCode(TENANT_A, USER_2);
      await getAdminSql()`
        UPDATE awcms_telegram_link_codes
        SET expires_at = now() - interval '1 minute'
        WHERE principal_id = ${USER_2}
      `;

      const replies = await Promise.all([
        webhook(startUpdate(generateLinkCode(), CHAT_2)),
        webhook(startUpdate(expired, CHAT_2)),
        webhook(startUpdate(used, CHAT_2)),
        webhook({
          message: {
            text: "/start not-a-code",
            chat: { id: CHAT_2, type: "private" },
            from: { id: CHAT_2, is_bot: false }
          }
        })
      ]);

      for (const reply of replies) {
        expect(reply.reply).toBe(TELEGRAM_REPLY_CODE_NOT_VALID);
        expect(reply.outcome).toBe("code_not_valid");
      }

      expect(await bindingsOf(TENANT_A)).toHaveLength(1);
    });

    test("groups, supergroups and channels never bind, and say nothing", async () => {
      const code = await requestCode(TENANT_A, USER_1);

      for (const type of ["group", "supergroup", "channel"]) {
        const result = await webhook(
          startUpdate(code, GROUP_CHAT, {
            chat: { id: GROUP_CHAT, type },
            from: { id: CHAT_1, is_bot: false }
          })
        );

        expect(result).toMatchObject({ reply: null, outcome: "ignored" });
      }

      expect(await count("awcms_telegram_bindings")).toBe(0);
      // The code is untouched: ignoring a group did not burn it.
      expect((await webhook(startUpdate(code, CHAT_1))).outcome).toBe("linked");
    });

    test("with the tenant switch off, or the module off, nobody binds and the code is left alone", async () => {
      const code = await requestCode(TENANT_A, USER_1);

      await inTenant(TENANT_A, (tx) =>
        setTelegramEnabled(tx, TENANT_A, false, USER_1)
      );
      expect((await webhook(startUpdate(code, CHAT_1))).outcome).toBe(
        "code_not_valid"
      );
      expect(await count("awcms_telegram_bindings")).toBe(0);

      await turnOn(TENANT_A, USER_1);
      await getAdminSql()`
        INSERT INTO awcms_modules (module_key, module_name, version)
        VALUES ('telegram_delivery', 'Telegram Delivery', '0.1.0')
        ON CONFLICT DO NOTHING
      `;
      await getAdminSql()`
        INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
        VALUES (${TENANT_A}, 'telegram_delivery', false)
      `;
      expect((await webhook(startUpdate(code, CHAT_1))).outcome).toBe(
        "code_not_valid"
      );
    });

    test("a deactivated or roleless person cannot be bound", async () => {
      const code = await requestCode(TENANT_A, USER_3);

      await getAdminSql()`
        UPDATE awcms_access_policies SET status = 'revoked', revoked_at = now()
        WHERE tenant_user_id = ${USER_3}
      `;
      expect((await webhook(startUpdate(code, CHAT_1))).outcome).toBe(
        "code_not_valid"
      );
      expect(await count("awcms_telegram_bindings")).toBe(0);
    });

    test("fail closed: with no usable key ring no binding is created", async () => {
      const code = await requestCode(TENANT_A, USER_1);
      const noEncryption = {
        ...ENV,
        TELEGRAM_CHAT_ENCRYPTION_KEYS: ""
      } as NodeJS.ProcessEnv;
      const noHash = {
        ...ENV,
        TELEGRAM_CHAT_HASH_KEYS: ""
      } as NodeJS.ProcessEnv;

      for (const env of [noEncryption, noHash]) {
        expect(await webhook(startUpdate(code, CHAT_1), env)).toMatchObject({
          reply: null,
          outcome: "misconfigured"
        });
      }

      expect(await count("awcms_telegram_bindings")).toBe(0);
      // ... and the code was not burned by the failed attempt.
      expect((await webhook(startUpdate(code, CHAT_1))).outcome).toBe("linked");
    });
  });

  // -------------------------------------------------------------------------
  describe("confirmation, re-binding and one chat per principal", () => {
    test("confirming activates, clears the captured name, and audits", async () => {
      const bindingId = await activate(TENANT_A, USER_1, CHAT_1);
      const row = await bindingRow(bindingId);

      expect(row).toMatchObject({
        status: "active",
        display_name: null,
        username_masked: null,
        pending_expires_at: null
      });
      expect(row.confirmed_at).not.toBeNull();
      expect(await auditActions(TENANT_A)).toEqual(
        expect.arrayContaining([
          "telegram_link.requested",
          "telegram_binding.created",
          "telegram_binding.confirmed"
        ])
      );
    });

    test("a confirmation that was never requested, or has expired, is refused", async () => {
      expect(
        await inTenant(TENANT_A, (tx) =>
          confirmWithPin(tx, TENANT_A, USER_1, crypto.randomUUID())
        )
      ).toEqual({ outcome: "none" });

      const code = await requestCode(TENANT_A, USER_1);
      await webhook(startUpdate(code, CHAT_1));
      const pendingId = await pendingBindingId(TENANT_A, USER_1);
      await inTenant(
        TENANT_A,
        (tx) => tx`
        UPDATE awcms_telegram_bindings
        SET pending_expires_at = now() - interval '1 minute'
      `
      );

      expect(
        await inTenant(TENANT_A, (tx) =>
          confirmWithPin(tx, TENANT_A, USER_1, pendingId)
        )
      ).toEqual({ outcome: "none" });
    });

    test("re-binding replaces the earlier chat: the old one is revoked and erased, audited", async () => {
      const first = await activate(TENANT_A, USER_1, CHAT_1);
      const second = await activate(TENANT_A, USER_1, CHAT_2);

      expect(await bindingRow(first)).toMatchObject({
        status: "revoked",
        revoke_cause: "rebound",
        chat_ciphertext: null
      });
      expect(await bindingRow(second)).toMatchObject({ status: "active" });
      expect(await auditActions(TENANT_A)).toEqual(
        expect.arrayContaining([
          "telegram_binding.revoked",
          "telegram_binding.rebound"
        ])
      );
    });

    test("a second /start from the same principal supersedes a pending one", async () => {
      const code1 = await requestCode(TENANT_A, USER_1);
      await webhook(startUpdate(code1, CHAT_1));
      const code2 = await requestCode(TENANT_A, USER_1);
      await webhook(startUpdate(code2, CHAT_2));

      const rows = await bindingsOf(TENANT_A);

      expect(rows.map((row) => row.status)).toEqual([
        "revoked",
        "pending_confirmation"
      ]);
      expect(rows[0]!.revoke_cause).toBe("superseded");
      expect(rows[0]!.chat_ciphertext).toBeNull();
    });

    test("a chat that is live for one principal cannot be claimed by another in the same tenant", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);

      const code = await requestCode(TENANT_A, USER_2);
      const result = await webhook(startUpdate(code, CHAT_1));

      expect(result.outcome).toBe("code_not_valid");
      expect(
        (await bindingsOf(TENANT_A)).filter((r) => r.principal_id === USER_2)
      ).toHaveLength(0);
      expect(await auditActions(TENANT_A)).toContain(
        "telegram_binding.rejected"
      );
    });

    test("the same chat may be bound in a different tenant (the hash is tenant-bound)", async () => {
      const a = await bindingRow(await activate(TENANT_A, USER_1, CHAT_1));
      const b = await bindingRow(await activate(TENANT_B, USER_B1, CHAT_1));

      expect(a.chat_hash).not.toBe(b.chat_hash);
      expect(a.status).toBe("active");
      expect(b.status).toBe("active");
    });

    test("the schema refuses a non-live binding that still holds a ciphertext", async () => {
      const id = await activate(TENANT_A, USER_1, CHAT_1);

      const error = await assertRejected(
        getAdminSql()`
          UPDATE awcms_telegram_bindings
          SET status = 'revoked', revoked_at = now(), revoke_cause = 'admin'
          WHERE id = ${id}
        `,
        "a revoked binding that keeps its ciphertext"
      );

      expect(String(error)).toContain(
        "awcms_telegram_bindings_ciphertext_check"
      );
    });

    test("tenant isolation: another tenant sees none of these rows", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);

      const seenByB = await inTenant(TENANT_B, (tx) =>
        listBindings(tx, TENANT_B, { limit: 50 })
      );
      const direct = await inTenant(
        TENANT_B,
        (tx) => tx`SELECT count(*)::int AS n FROM awcms_telegram_bindings`
      );

      expect(seenByB.bindings).toHaveLength(0);
      expect((direct as { n: number }[])[0]!.n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("revocation erases the chat and stops delivery at once", () => {
    test("/stop revokes by the chat's keyed hash, cancels the queue, and answers the same whether or not it found one", async () => {
      const id = await activate(TENANT_A, USER_1, CHAT_1);
      await enqueue(TENANT_A, USER_1, { correlationId: "c1" });

      const stopped = await webhook(stopUpdate(CHAT_1));

      expect(stopped).toMatchObject({
        reply: TELEGRAM_REPLY_STOPPED,
        outcome: "stopped"
      });
      expect(await bindingRow(id)).toMatchObject({
        status: "revoked",
        revoke_cause: "self_stop",
        chat_ciphertext: null
      });
      expect(await count("awcms_telegram_messages")).toBe(1);
      expect(
        (
          await getAdminSql()`SELECT status, failure_code FROM awcms_telegram_messages`
        )[0]
      ).toMatchObject({ status: "cancelled", failure_code: "binding_revoked" });

      // A chat nobody bound gets the very same answer.
      expect(await webhook(stopUpdate(CHAT_2))).toMatchObject({
        reply: TELEGRAM_REPLY_STOPPED,
        outcome: "stopped"
      });
      // A replayed /stop is a no-op.
      expect((await webhook(stopUpdate(CHAT_1))).outcome).toBe("stopped");
      expect(await enqueue(TENANT_A, USER_1)).toEqual({
        status: "refused",
        reason: "NO_BINDING"
      });
    });

    test("/stop from a group does nothing", async () => {
      const id = await activate(TENANT_A, USER_1, CHAT_1);
      const result = await webhook({
        message: {
          text: "/stop",
          chat: { id: GROUP_CHAT, type: "group" },
          from: { id: CHAT_1, is_bot: false }
        }
      });

      expect(result.outcome).toBe("ignored");
      expect((await bindingRow(id)).status).toBe("active");
    });

    test("/stop still finds a binding hashed under an older key after a ring rotation", async () => {
      const id = await activate(TENANT_A, USER_1, CHAT_1);
      const rotated = {
        ...ENV,
        TELEGRAM_CHAT_HASH_KEYS: `k2:${KEY_HASH_2},k1:${KEY_HASH}`
      } as NodeJS.ProcessEnv;

      expect((await webhook(stopUpdate(CHAT_1), rotated)).outcome).toBe(
        "stopped"
      );
      expect((await bindingRow(id)).status).toBe("revoked");
    });

    test("the staff member unlinks from the admin; an administrator revokes anyone, audited at warning", async () => {
      const id1 = await activate(TENANT_A, USER_1, CHAT_1);
      const id2 = await activate(TENANT_A, USER_2, CHAT_2);

      const own = await inTenant(TENANT_A, (tx) =>
        endBindings(tx, TENANT_A, { principalId: USER_1 }, "self_admin", {
          actorTenantUserId: USER_1
        })
      );

      expect(own.ended).toHaveLength(1);
      expect((await bindingRow(id1)).chat_ciphertext).toBeNull();

      await inTenant(TENANT_A, async (tx) => {
        const ended = await endBindings(
          tx,
          TENANT_A,
          { bindingId: id2 },
          "admin",
          {
            actorTenantUserId: USER_1
          }
        );

        const { auditEndedBindings } =
          await import("../../src/modules/telegram-delivery/application/telegram-bindings");
        await auditEndedBindings(tx, TENANT_A, ended, "admin", {
          actorTenantUserId: USER_1
        });
      });

      expect(await bindingRow(id2)).toMatchObject({
        status: "revoked",
        revoke_cause: "admin",
        revoked_by: USER_1,
        chat_ciphertext: null
      });

      const warning = (await getAdminSql()`
        SELECT severity FROM awcms_audit_events
        WHERE action = 'telegram_binding.revoked'
          AND attributes->>'cause' = 'admin'
      `) as { severity: string }[];

      expect(warning[0]!.severity).toBe("warning");
    });

    test("turning the tenant switch off ends every binding in the same transaction, once, with one audit row", async () => {
      const id1 = await activate(TENANT_A, USER_1, CHAT_1);
      const id2 = await activate(TENANT_A, USER_2, CHAT_2);
      await enqueue(TENANT_A, USER_1);

      const result = await inTenant(TENANT_A, (tx) =>
        setTelegramEnabled(tx, TENANT_A, false, USER_1)
      );

      expect(result).toMatchObject({
        changed: true,
        revokedBindings: 2,
        cancelledMessages: 1
      });
      expect(await bindingRow(id1)).toMatchObject({
        status: "revoked",
        revoke_cause: "tenant_disabled",
        chat_ciphertext: null
      });
      expect((await bindingRow(id2)).chat_ciphertext).toBeNull();

      const again = await inTenant(TENANT_A, (tx) =>
        setTelegramEnabled(tx, TENANT_A, false, USER_1)
      );

      expect(again.changed).toBe(false);
      expect(
        (await auditActions(TENANT_A)).filter(
          (a) => a === "telegram_setting.changed"
        )
      ).toHaveLength(2); // on, then off; the repeat wrote nothing
    });

    test("another tenant is untouched by this tenant's switch", async () => {
      const b = await activate(TENANT_B, USER_B1, CHAT_1);

      await inTenant(TENANT_A, (tx) =>
        setTelegramEnabled(tx, TENANT_A, false, USER_1)
      );

      expect((await bindingRow(b)).status).toBe("active");
    });

    test("an unconfirmed binding past its window is ended by the sweep, ciphertext erased", async () => {
      const code = await requestCode(TENANT_A, USER_1);
      await webhook(startUpdate(code, CHAT_1));
      await inTenant(
        TENANT_A,
        (tx) => tx`
        UPDATE awcms_telegram_bindings
        SET pending_expires_at = now() - interval '1 minute'
      `
      );

      const { expirePendingBindings } =
        await import("../../src/modules/telegram-delivery/application/telegram-bindings");
      const swept = await inTenant(TENANT_A, (tx) =>
        expirePendingBindings(tx, TENANT_A, new Date())
      );

      expect(swept).toBe(1);
      expect((await bindingsOf(TENANT_A))[0]).toMatchObject({
        status: "revoked",
        revoke_cause: "confirmation_expired",
        chat_ciphertext: null,
        display_name: null
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("enqueue", () => {
    test("disabled at the deployment: refused, and not one row is written", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);

      expect(
        await enqueue(TENANT_A, USER_1, {}, {} as NodeJS.ProcessEnv)
      ).toEqual({
        status: "refused",
        reason: "DISABLED"
      });
      expect(await count("awcms_telegram_messages")).toBe(0);
    });

    test("the tenant switch and the module each answer DISABLED", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);
      await getAdminSql()`
        UPDATE awcms_telegram_settings SET enabled = false WHERE tenant_id = ${TENANT_A}
      `;

      expect(await enqueue(TENANT_A, USER_1)).toEqual({
        status: "refused",
        reason: "DISABLED"
      });

      await getAdminSql()`
        UPDATE awcms_telegram_settings SET enabled = true WHERE tenant_id = ${TENANT_A}
      `;
      await getAdminSql()`
        INSERT INTO awcms_modules (module_key, module_name, version)
        VALUES ('telegram_delivery', 'Telegram Delivery', '0.1.0')
        ON CONFLICT DO NOTHING
      `;
      await getAdminSql()`
        INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
        VALUES (${TENANT_A}, 'telegram_delivery', false)
      `;

      expect(await enqueue(TENANT_A, USER_1)).toEqual({
        status: "refused",
        reason: "DISABLED"
      });
    });

    test("unknown template, missing expiry, and no binding are returned, never thrown, and trigger nothing else", async () => {
      expect(
        await enqueue(TENANT_A, USER_1, { templateKey: "nope.missing" })
      ).toEqual({
        status: "refused",
        reason: "TEMPLATE_UNKNOWN"
      });
      expect(
        await enqueue(TENANT_A, USER_1, {
          expiresAt: undefined as unknown as Date
        })
      ).toEqual({ status: "refused", reason: "EXPIRY_REQUIRED" });
      expect(await enqueue(TENANT_A, USER_1)).toEqual({
        status: "refused",
        reason: "NO_BINDING"
      });
      expect(await count("awcms_telegram_messages")).toBe(0);
      // NO_BINDING touched no other channel's queue.
      expect(await count("awcms_email_messages")).toBe(0);
      expect(await count("awcms_whatsapp_messages")).toBe(0);
      expect(await count("awcms_push_messages")).toBe(0);
    });

    test("queues one row addressed to the BINDING; the row carries no chat id and renders only allow-listed typed values", async () => {
      const bindingId = await activate(TENANT_A, USER_1, CHAT_1);
      const result = await enqueue(TENANT_A, USER_1, {
        correlationId: "shift-1",
        variables: {
          count: "3",
          ref: "R-12",
          customerName: "Sari",
          netSalary: "12000000"
        }
      });

      expect(result.status).toBe("queued");

      const row = await message((result as { messageId: string }).messageId);

      expect(row).toMatchObject({
        status: "queued",
        purpose: "staff_ops",
        binding_id: bindingId,
        principal_id: USER_1,
        body: "Count 3 for R-12"
      });
      expect(JSON.stringify(row)).not.toContain(String(CHAT_1));
      expect(JSON.stringify(row)).not.toContain("12000000");
      expect(JSON.stringify(row)).not.toContain("Sari");
    });

    test("an idempotent replay returns the existing message, even after the binding was revoked", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);

      const first = await enqueue(TENANT_A, USER_1, { idempotencyKey: "same" });

      await webhook(stopUpdate(CHAT_1));

      expect(
        await enqueue(TENANT_A, USER_1, { idempotencyKey: "same" })
      ).toEqual({
        status: "duplicate",
        messageId: (first as { messageId: string }).messageId
      });
    });

    test("a per-binding rate limit refuses the excess", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);

      const env = {
        ...ENV,
        TELEGRAM_RATE_PER_BINDING_PER_HOUR: "2"
      } as NodeJS.ProcessEnv;

      expect((await enqueue(TENANT_A, USER_1, {}, env)).status).toBe("queued");
      expect((await enqueue(TENANT_A, USER_1, {}, env)).status).toBe("queued");
      expect(await enqueue(TENANT_A, USER_1, {}, env)).toEqual({
        status: "refused",
        reason: "RATE_LIMITED"
      });
    });

    test("the port reads status back and cancels by correlation, and cannot see another tenant's messages", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);
      await activate(TENANT_B, USER_B1, CHAT_1);
      await enqueue(TENANT_A, USER_1, { correlationId: "shift-9" });
      await enqueue(TENANT_A, USER_1, { correlationId: "shift-9" });
      await enqueue(TENANT_B, USER_B1, { correlationId: "shift-9" });

      const statuses = await inTenant(TENANT_A, (tx) =>
        telegramDeliveryPortAdapter.getStatusByCorrelation(tx, "shift-9")
      );

      expect(statuses).toHaveLength(2);
      expect(JSON.stringify(statuses)).not.toContain(String(CHAT_1));
      expect(
        await inTenant(TENANT_A, (tx) =>
          cancelTelegramByCorrelation(tx, "shift-9")
        )
      ).toBe(2);
      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            getTelegramStatusByCorrelation(tx, "shift-9")
          )
        ).every((status) => status.status === "cancelled")
      ).toBe(true);
      // Tenant B's row was untouched.
      expect(
        (
          await getAdminSql()`
          SELECT status FROM awcms_telegram_messages WHERE tenant_id = ${TENANT_B}
        `
        )[0]
      ).toMatchObject({ status: "queued" });
    });

    test("enqueue outside a tenant transaction is a programming error", async () => {
      await expect(
        enqueueTelegramMessage(
          // A plain connection has the all-zero placeholder tenant.
          runtime() as unknown as Bun.TransactionSQL,
          {
            templateKey: "booking.it965_alert",
            recipientPrincipalId: USER_1,
            variables: {},
            idempotencyKey: "x",
            expiresAt: soon()
          },
          { env: ENV }
        )
      ).rejects.toThrow(/tenant transaction/);
    });
  });

  // -------------------------------------------------------------------------
  describe("dispatch", () => {
    workerTest(
      "sends with the chat id decrypted in memory, outside any transaction, and clears the row",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        const queued = await enqueue(TENANT_A, USER_1, {
          correlationId: "c-1"
        });
        const provider = fakeProvider(() => OK);
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0]).toMatchObject({
          chatId: String(CHAT_1),
          text: "Count 3 for R-12",
          templateKey: "booking.it965_alert"
        });
        // No network I/O inside a database transaction (ADR-0006).
        expect(provider.openWorkerTransactions).toEqual([0]);

        const row = await message((queued as { messageId: string }).messageId);

        expect(row).toMatchObject({
          status: "sent",
          provider_message_id: "9001",
          body: "",
          variables: {}
        });
        expect(row.next_attempt_at).toBeNull();
        expect(await everythingStored()).not.toContain(String(CHAT_1));
      }
    );

    workerTest(
      "a disabled deployment claims nothing; a missing encryption ring claims nothing",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);

        const provider = fakeProvider(() => OK);

        expect(
          await dispatch(TENANT_A, provider, { env: {} as NodeJS.ProcessEnv })
        ).toMatchObject({ claimed: 0 });
        expect(
          await dispatch(TENANT_A, provider, {
            env: {
              ...ENV,
              TELEGRAM_CHAT_ENCRYPTION_KEYS: ""
            } as NodeJS.ProcessEnv
          })
        ).toMatchObject({ claimed: 0 });
        expect(provider.requests).toHaveLength(0);
        expect(
          (await getAdminSql()`SELECT status FROM awcms_telegram_messages`)[0]
        ).toMatchObject({ status: "queued" });
      }
    );

    workerTest(
      "a deactivated principal is not messaged and loses the binding",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);
        const queued = await enqueue(TENANT_A, USER_1);

        await getAdminSql()`
        UPDATE awcms_tenant_users SET status = 'inactive' WHERE id = ${USER_1}
      `;

        const provider = fakeProvider(() => OK);
        const result = await dispatch(TENANT_A, provider);

        // M3: the eligibility sweep at the top of the pass ends the binding (and
        // cancels what was queued for it) before anything is claimed.
        expect(result).toMatchObject({ claimed: 0, sent: 0, bindingsEnded: 1 });
        expect(provider.requests).toHaveLength(0);
        expect(await bindingRow(id)).toMatchObject({
          status: "revoked",
          revoke_cause: "principal_deactivated",
          chat_ciphertext: null
        });
        expect(
          await message((queued as { messageId: string }).messageId)
        ).toMatchObject({
          status: "cancelled",
          failure_code: "binding_revoked"
        });
      }
    );

    workerTest(
      "a principal who lost every role is not messaged either, and a group grant counts",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);
        const id2 = await activate(TENANT_A, USER_2, CHAT_2);

        // USER_2 keeps access only through a GROUP grant.
        const admin = getAdminSql();
        const group = (await admin`
        INSERT INTO awcms_user_groups (tenant_id, group_code, group_name)
        VALUES (${TENANT_A}, 'it965-g', 'G') RETURNING id
      `) as { id: string }[];

        await admin`
        INSERT INTO awcms_user_group_members (tenant_id, user_group_id, tenant_user_id)
        VALUES (${TENANT_A}, ${group[0]!.id}, ${USER_2})
      `;
        await admin`
        INSERT INTO awcms_access_policies
          (tenant_id, subject_type, tenant_user_id, user_group_id, role_id,
           scope_type, scope_id, status, effective_from)
        VALUES (${TENANT_A}, 'user_group', NULL, ${group[0]!.id}, ${ROLE_A},
                'tenant', ${TENANT_A}, 'active', now() - interval '1 minute')
      `;
        await admin`
        UPDATE awcms_access_policies
        SET status = 'revoked', revoked_at = now()
        WHERE subject_type = 'tenant_user'
      `;

        await enqueue(TENANT_A, USER_1);
        await enqueue(TENANT_A, USER_2);

        const provider = fakeProvider(() => OK);
        const result = await dispatch(TENANT_A, provider);

        // The sweep ended USER_1's binding (cancelling its queued notice) before the claim.
        expect(result).toMatchObject({
          claimed: 1,
          sent: 1,
          bindingsEnded: 1
        });
        expect(provider.requests.map((r) => r.chatId)).toEqual([
          String(CHAT_2)
        ]);
        expect((await bindingRow(id)).status).toBe("revoked");
        expect((await bindingRow(id2)).status).toBe("active");
      }
    );

    workerTest(
      "a closed tenant gate sends nothing and ends every binding; so does the module being switched off",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);
        await getAdminSql()`
        UPDATE awcms_telegram_settings SET enabled = false WHERE tenant_id = ${TENANT_A}
      `;

        const provider = fakeProvider(() => OK);
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 0, bindingsEnded: 1 });
        expect(provider.requests).toHaveLength(0);
        expect(await bindingRow(id)).toMatchObject({
          status: "revoked",
          revoke_cause: "tenant_disabled",
          chat_ciphertext: null
        });
        expect(
          (await getAdminSql()`SELECT status FROM awcms_telegram_messages`)[0]
        ).toMatchObject({ status: "cancelled" });

        // The module switched off in Module Management revokes too.
        await getAdminSql()`
        UPDATE awcms_telegram_settings SET enabled = true WHERE tenant_id = ${TENANT_A}
      `;
        const id2 = await activate(TENANT_A, USER_2, CHAT_2);

        await getAdminSql()`
        INSERT INTO awcms_modules (module_key, module_name, version)
        VALUES ('telegram_delivery', 'Telegram Delivery', '0.1.0')
        ON CONFLICT DO NOTHING
      `;
        await getAdminSql()`
        INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
        VALUES (${TENANT_A}, 'telegram_delivery', false)
      `;

        expect(await dispatch(TENANT_A, provider)).toMatchObject({
          bindingsEnded: 1
        });
        expect((await bindingRow(id2)).revoke_cause).toBe("module_disabled");
      }
    );

    workerTest(
      "403 suspends the binding, erases the chat id, cancels the rest of its queue and is never retried",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);
        await enqueue(TENANT_A, USER_1);

        const provider = fakeProvider(() => ({
          ok: false,
          error: "Forbidden: bot was blocked by the user",
          retryable: false,
          failureCode: "chat_unreachable",
          bindingUnreachable: true
        }));
        const result = await dispatch(TENANT_A, provider, { limit: 1 });

        expect(result).toMatchObject({
          claimed: 1,
          failed: 1,
          bindingsEnded: 1
        });
        expect(await bindingRow(id)).toMatchObject({
          status: "suspended",
          revoke_cause: "provider_blocked",
          chat_ciphertext: null
        });

        const statuses = (await getAdminSql()`
        SELECT status, failure_code FROM awcms_telegram_messages ORDER BY created_at
      `) as { status: string; failure_code: string }[];

        expect(statuses[0]).toMatchObject({
          status: "failed",
          failure_code: "chat_unreachable"
        });
        expect(statuses[1]).toMatchObject({
          status: "cancelled",
          failure_code: "binding_revoked"
        });
        // Nothing left to claim, now or later.
        expect(await dispatch(TENANT_A, provider)).toMatchObject({
          claimed: 0
        });
        expect(provider.requests).toHaveLength(1);
      }
    );

    workerTest(
      "429 reschedules to retry_after without spending the retry budget, and releases the rest of the batch",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        await activate(TENANT_A, USER_2, CHAT_2);
        await enqueue(TENANT_A, USER_1);
        await enqueue(TENANT_A, USER_2);

        const provider = fakeProvider(() => ({
          ok: false,
          error: "Too Many Requests: retry after 30",
          retryable: true,
          failureCode: "rate_limited",
          retryAfterSeconds: 30
        }));
        const before = Date.now();
        const result = await dispatch(TENANT_A, provider);

        // One call went out; the second row was never sent into the rate limit.
        expect(provider.requests).toHaveLength(1);
        expect(result).toMatchObject({ claimed: 2, sent: 0, rateLimited: 2 });

        const rows = (await getAdminSql()`
        SELECT status, retry_count, next_attempt_at, failure_code
        FROM awcms_telegram_messages ORDER BY created_at
      `) as {
          status: string;
          retry_count: number;
          next_attempt_at: Date;
          failure_code: string;
        }[];

        for (const row of rows) {
          expect(row.status).toBe("retry_wait");
          expect(row.retry_count).toBe(0);
          expect(row.failure_code).toBe("rate_limited");
          expect(
            new Date(row.next_attempt_at).getTime()
          ).toBeGreaterThanOrEqual(before + 29_000);
          expect(new Date(row.next_attempt_at).getTime()).toBeLessThan(
            before + 60_000
          );
        }

        // No attempt row for a message that was never accepted or rejected.
        expect(await count("awcms_telegram_delivery_attempts")).toBe(0);
        // Inside the window nothing is claimed; after it, delivery resumes.
        expect(await dispatch(TENANT_A, provider)).toMatchObject({
          claimed: 0
        });

        const healthy = fakeProvider(() => OK);

        expect(
          await dispatch(TENANT_A, healthy, {
            now: new Date(Date.now() + 40_000)
          })
        ).toMatchObject({ claimed: 2, sent: 2 });
      }
    );

    workerTest(
      "a hostile retry_after is capped by the configured ceiling",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);

        const provider = fakeProvider(() => ({
          ok: false,
          error: "slow down",
          retryable: true,
          failureCode: "rate_limited",
          retryAfterSeconds: 99_999_999
        }));
        const before = Date.now();

        await dispatch(TENANT_A, provider, {
          env: {
            ...ENV,
            TELEGRAM_RETRY_AFTER_CAP_SECONDS: "120"
          } as NodeJS.ProcessEnv
        });

        const row = (
          await getAdminSql()`
        SELECT next_attempt_at FROM awcms_telegram_messages
      `
        )[0] as { next_attempt_at: Date };

        expect(new Date(row.next_attempt_at).getTime()).toBeLessThan(
          before + 130_000
        );
      }
    );

    workerTest(
      "a retryable failure backs off exponentially and records the attempt; exhausted retries fail",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);

        const provider = fakeProvider(() => ({
          ok: false,
          error: "Telegram answered HTTP 502.",
          retryable: true,
          failureCode: "provider_error"
        }));
        const env = {
          ...ENV,
          TELEGRAM_SEND_MAX_RETRIES: "1"
        } as NodeJS.ProcessEnv;
        const t0 = new Date();

        expect(
          await dispatch(TENANT_A, provider, { env, now: t0 })
        ).toMatchObject({
          retried: 1
        });

        const waiting = (
          await getAdminSql()`
        SELECT status, retry_count, next_attempt_at FROM awcms_telegram_messages
      `
        )[0] as { status: string; retry_count: number; next_attempt_at: Date };

        expect(waiting.status).toBe("retry_wait");
        expect(waiting.retry_count).toBe(1);
        expect(new Date(waiting.next_attempt_at).getTime()).toBeGreaterThan(
          t0.getTime() + 50_000
        );

        const later = new Date(t0.getTime() + 5 * 60_000);

        expect(
          await dispatch(TENANT_A, provider, { env, now: later })
        ).toMatchObject({ failed: 1 });
        expect(await count("awcms_telegram_delivery_attempts")).toBe(2);
        expect(
          (
            await getAdminSql()`SELECT status, body FROM awcms_telegram_messages`
          )[0]
        ).toMatchObject({ status: "failed", body: "" });
      }
    );

    workerTest(
      "a 400-style rejection is terminal and leaves the binding alone",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);

        const provider = fakeProvider(() => ({
          ok: false,
          error: "Bad Request: message is too long",
          retryable: false,
          failureCode: "rejected"
        }));

        expect(await dispatch(TENANT_A, provider)).toMatchObject({ failed: 1 });
        expect((await bindingRow(id)).status).toBe("active");
      }
    );

    workerTest(
      "the bot token in a provider error is stored nowhere",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);

        const provider = fakeProvider(() => ({
          ok: false,
          error: `request to https://api.telegram.org/bot${TOKEN}/sendMessage failed for chat ${CHAT_1}`,
          retryable: false,
          failureCode: "rejected"
        }));

        await dispatch(TENANT_A, provider);

        const stored = await everythingStored();

        expect(stored).not.toContain(TOKEN);
        expect(stored).not.toContain("AAH_fake_token");
        expect(stored).not.toContain(String(CHAT_1));
        expect(stored).toContain("redacted-token");
      }
    );

    workerTest("an expired message is expired, never sent late", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);
      const queued = await enqueue(TENANT_A, USER_1, {
        expiresAt: new Date(Date.now() + 1500)
      });
      const provider = fakeProvider(() => OK);

      expect(
        await dispatch(TENANT_A, provider, {
          now: new Date(Date.now() + 5000)
        })
      ).toMatchObject({ claimed: 1, expired: 1, sent: 0 });
      expect(provider.requests).toHaveLength(0);
      expect(
        (await message((queued as { messageId: string }).messageId)).status
      ).toBe("expired");
    });

    workerTest(
      "per-chat spacing: a second message to the same chat within the interval is deferred, not slept on",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);
        await enqueue(TENANT_A, USER_1);

        const provider = fakeProvider(() => OK);
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 2, sent: 1, deferred: 1 });
        expect(provider.requests).toHaveLength(1);

        const waiting = (await getAdminSql()`
        SELECT status, retry_count, next_attempt_at FROM awcms_telegram_messages
        WHERE status = 'retry_wait'
      `) as { retry_count: number; next_attempt_at: Date }[];

        expect(waiting).toHaveLength(1);
        expect(waiting[0]!.retry_count).toBe(0);

        // The spacing is measured on the DATABASE clock (the one `sent_at` was
        // stamped with), so the interval has to really pass.
        await Bun.sleep(1100);

        expect(
          await dispatch(TENANT_A, provider, {
            now: new Date(Date.now() + 3000)
          })
        ).toMatchObject({ sent: 1 });
      }
    );

    workerTest(
      "a ciphertext that cannot be decrypted fails THAT message and leaves the binding",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);

        const otherRing = {
          ...ENV,
          TELEGRAM_CHAT_ENCRYPTION_KEYS: `k9:${KEY_HASH_2}`
        } as NodeJS.ProcessEnv;
        const provider = fakeProvider(() => OK);

        expect(
          await dispatch(TENANT_A, provider, { env: otherRing })
        ).toMatchObject({ failed: 1 });
        expect(provider.requests).toHaveLength(0);
        expect((await bindingRow(id)).status).toBe("active");
      }
    );

    workerTest("a throwing provider fails that row, not the pass", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);
      await activate(TENANT_A, USER_2, CHAT_2);
      await enqueue(TENANT_A, USER_1);
      await enqueue(TENANT_A, USER_2);

      const provider = fakeProvider((request) => {
        if (request.chatId === String(CHAT_1)) {
          throw new Error("boom");
        }

        return OK;
      });
      const result = await dispatch(TENANT_A, provider);

      expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
    });

    workerTest("tenants are dispatched independently", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);
      await activate(TENANT_B, USER_B1, CHAT_2);
      await enqueue(TENANT_B, USER_B1);

      const provider = fakeProvider(() => OK);

      expect(await dispatch(TENANT_A, provider)).toMatchObject({ claimed: 0 });
      expect(await dispatch(TENANT_B, provider)).toMatchObject({ sent: 1 });
    });

    workerTest(
      "the worker holds no right to create a binding or a code, or to write the switch",
      async () => {
        const worker = getWorkerRoleSql();

        await assertRejected(
          withTenantOrThrow(
            worker,
            TENANT_A,
            (tx) => tx`
            INSERT INTO awcms_telegram_bindings
              (tenant_id, principal_id, status, chat_ciphertext, chat_hash, hash_key_id, chat_masked, pending_expires_at)
            VALUES (${TENANT_A}, ${USER_1}, 'pending_confirmation', 'v2:x', 'k1:x', 'k1', '***1', now())
          `
          ),
          "the worker inserting a binding"
        );
        await assertRejected(
          withTenantOrThrow(
            worker,
            TENANT_A,
            (tx) => tx`
            INSERT INTO awcms_telegram_link_codes (tenant_id, principal_id, code_hash, expires_at)
            VALUES (${TENANT_A}, ${USER_1}, ${"a".repeat(64)}, now())
          `
          ),
          "the worker inserting a link code"
        );
        await assertRejected(
          withTenantOrThrow(
            worker,
            TENANT_A,
            (tx) => tx`UPDATE awcms_telegram_settings SET enabled = true`
          ),
          "the worker writing the tenant switch"
        );
        // ... and may not call the webhook's bootstrap lookups.
        await assertRejected(
          worker`SELECT * FROM awcms_telegram_resolve_link_code(${"a".repeat(64)})`,
          "the worker calling the webhook's code lookup"
        );
      }
    );
  });

  // -------------------------------------------------------------------------
  describe("the narrow bootstrap functions", () => {
    test("the runtime role can resolve a code to a tenant id and nothing else, and cannot read the table directly", async () => {
      const code = await requestCode(TENANT_A, USER_1);
      const { hashLinkCode } =
        await import("../../src/modules/telegram-delivery/domain/telegram-link-code");

      const resolved = (await runtime()`
        SELECT * FROM awcms_telegram_resolve_link_code(${hashLinkCode(code)})
      `) as Record<string, unknown>[];

      expect(resolved).toEqual([{ tenant_id: TENANT_A }]);
      expect(
        await runtime()`SELECT * FROM awcms_telegram_resolve_link_code(${hashLinkCode(generateLinkCode())})`
      ).toHaveLength(0);

      // Without a tenant context the table itself is invisible.
      expect(
        (
          await runtime()`SELECT count(*)::int AS n FROM awcms_telegram_link_codes`
        )[0]
      ).toMatchObject({ n: 0 });
    });

    test("a consumed or expired code no longer resolves", async () => {
      const code = await requestCode(TENANT_A, USER_1);
      const { hashLinkCode } =
        await import("../../src/modules/telegram-delivery/domain/telegram-link-code");

      await webhook(startUpdate(code, CHAT_1));

      expect(
        await runtime()`SELECT * FROM awcms_telegram_resolve_link_code(${hashLinkCode(code)})`
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("purge", () => {
    workerTest(
      "expires a waiting message past its expiry WITHOUT the dispatcher, even when Telegram is off",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        const queued = await enqueue(TENANT_A, USER_1);

        await getAdminSql()`
        UPDATE awcms_telegram_messages SET expires_at = now() - interval '1 minute'
      `;

        const result = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => false
        } as never);

        expect(result.expiredMessages).toBe(1);
        expect(
          (await message((queued as { messageId: string }).messageId)).status
        ).toBe("expired");
      }
    );

    workerTest(
      "ends an unconfirmed binding past its window and erases its ciphertext",
      async () => {
        const code = await requestCode(TENANT_A, USER_1);
        await webhook(startUpdate(code, CHAT_1));
        await inTenant(
          TENANT_A,
          (tx) => tx`
        UPDATE awcms_telegram_bindings
        SET pending_expires_at = now() - interval '1 minute'
      `
        );

        const result = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => false
        } as never);

        expect(result.expiredBindings).toBe(1);
        expect((await bindingsOf(TENANT_A))[0]).toMatchObject({
          status: "revoked",
          chat_ciphertext: null
        });
      }
    );

    workerTest(
      "deletes only terminal messages past retention, revoked bindings past their window, and old codes; never a waiting message or a live binding",
      async () => {
        const live = await activate(TENANT_A, USER_1, CHAT_1);
        const gone = await activate(TENANT_A, USER_2, CHAT_2);
        const waiting = await enqueue(TENANT_A, USER_1);
        const sent = await enqueue(TENANT_A, USER_1);

        await webhook(stopUpdate(CHAT_2));

        const admin = getAdminSql();

        await admin`
        UPDATE awcms_telegram_messages SET status = 'sent', sent_at = now(),
          updated_at = now() - interval '20 days'
        WHERE id = ${(sent as { messageId: string }).messageId}
      `;
        // The waiting one is just as old, and must survive.
        await admin`
        UPDATE awcms_telegram_messages SET updated_at = now() - interval '400 days'
        WHERE id = ${(waiting as { messageId: string }).messageId}
      `;
        await admin`
        UPDATE awcms_telegram_bindings SET updated_at = now() - interval '100 days'
        WHERE id = ${gone}
      `;
        await admin`
        UPDATE awcms_telegram_link_codes SET expires_at = now() - interval '3 days'
      `;

        const result = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => false
        } as never);

        expect(result).toMatchObject({
          purgedMessages: 1,
          purgedBindings: 1,
          purgedLinkCodes: 2
        });
        expect(await count("awcms_telegram_messages")).toBe(1);
        expect((await bindingRow(live)).status).toBe("active");
        expect(
          await getAdminSql()`SELECT id FROM awcms_telegram_bindings WHERE id = ${gone}`
        ).toHaveLength(0);
      }
    );

    workerTest(
      "a revoked binding that a message still references is kept",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);
        await enqueue(TENANT_A, USER_1);
        await webhook(stopUpdate(CHAT_1));
        await getAdminSql()`
        UPDATE awcms_telegram_bindings SET updated_at = now() - interval '100 days'
      `;

        const result = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => false
        } as never);

        expect(result.purgedBindings).toBe(0);
        expect((await bindingRow(id)).status).toBe("revoked");
      }
    );

    workerTest(
      "a legal hold stops the deletes but not the expiry or the erasure",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        const queued = await enqueue(TENANT_A, USER_1);

        await getAdminSql()`
        UPDATE awcms_telegram_messages SET status = 'sent', sent_at = now(),
          updated_at = now() - interval '40 days'
      `;

        const held = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => true
        } as never);

        expect(held.purgedMessages).toBe(0);
        expect(
          (await message((queued as { messageId: string }).messageId)).status
        ).toBe("sent");
      }
    );

    workerTest("retention is a setting inside its bounds", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);
      const queued = await enqueue(TENANT_A, USER_1);

      await getAdminSql()`
        UPDATE awcms_telegram_messages SET status = 'sent', sent_at = now(),
          updated_at = now() - interval '5 days'
      `;

      const kept = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
        isDescriptorHeld: async () => false
      } as never);

      expect(kept.purgedMessages).toBe(0);

      const shorter = await purgeTelegramQueue(
        getWorkerRoleSql(),
        TENANT_A,
        { isDescriptorHeld: async () => false } as never,
        { messageRetentionDays: 3 }
      );

      expect(shorter.purgedMessages).toBe(1);
      expect(
        await getAdminSql()`SELECT id FROM awcms_telegram_messages WHERE id = ${(queued as { messageId: string }).messageId}`
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("subject-data erasure (ADR-0094)", () => {
    test("the erasure sentinel is accepted on live AND revoked bindings, so the executor cannot abort", async () => {
      const live = await activate(TENANT_A, USER_1, CHAT_1);
      const ended = await activate(TENANT_A, USER_2, CHAT_2);

      await webhook(stopUpdate(CHAT_2));

      // Exactly what the generic executor writes for the descriptor's columns. It
      // runs from an API route, so as the application role, in the tenant.
      await inTenant(TENANT_A, (tx) =>
        tx.unsafe(
          `UPDATE awcms_telegram_bindings
         SET chat_ciphertext = '[erased]' || ':' || gen_random_uuid()::text,
             chat_hash = '[erased]' || ':' || gen_random_uuid()::text,
             chat_masked = '[erased]', display_name = '[erased]',
             username_masked = '[erased]'
         WHERE principal_id IN ('${USER_1}', '${USER_2}')`
        )
      );

      for (const id of [live, ended]) {
        const row = await bindingRow(id);

        expect(String(row.chat_ciphertext)).toStartWith("[erased]");
        expect(String(row.chat_hash)).toStartWith("[erased]");
      }

      // A live binding with its ciphertext overwritten can no longer be sent to.
      await enqueue(TENANT_A, USER_1);

      if (workerRoleActivated) {
        const provider = fakeProvider(() => OK);

        expect(await dispatch(TENANT_A, provider)).toMatchObject({ failed: 1 });
        expect(provider.requests).toHaveLength(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("the aggregated webhook rejection record", () => {
    test("one warning audit row on the platform tenant, with counts and no address, header or body", async () => {
      process.env.PLATFORM_TENANT_ID = TENANT_A;

      const t0 = 1_000_000;

      for (let i = 0; i < 5; i += 1) {
        recordWebhookRejection("header_mismatch", t0 + i);
      }

      recordWebhookRejection("header_absent", t0 + 6);

      // Not due yet: nothing is written.
      const auditBefore = await count("awcms_audit_events");

      expect(await flushWebhookRejections(() => runtime(), t0 + 1000)).toBe(
        false
      );
      expect(await count("awcms_audit_events")).toBe(auditBefore);

      expect(await flushWebhookRejections(() => runtime(), t0 + 61_000)).toBe(
        true
      );

      const rows = (await getAdminSql()`
        SELECT severity, attributes, tenant_id
        FROM awcms_audit_events WHERE action = 'telegram_webhook.rejected'
      `) as {
        severity: string;
        attributes: { counts: Record<string, number>; windowSeconds: number };
        tenant_id: string;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        severity: "warning",
        tenant_id: TENANT_A
      });
      expect(rows[0]!.attributes.counts).toEqual({
        header_mismatch: 5,
        header_absent: 1
      });

      // The counters were cleared: a second flush has nothing to write.
      expect(await flushWebhookRejections(() => runtime(), t0 + 200_000)).toBe(
        false
      );
    });

    test("without a platform tenant it logs instead and still clears its counters", async () => {
      process.env.PLATFORM_TENANT_ID = "00000000-0000-4000-8000-0000000000ff";

      recordWebhookRejection("header_mismatch", 1);

      expect(await flushWebhookRejections(() => runtime(), 70_000)).toBe(false);
      expect(
        (
          await getAdminSql()`SELECT count(*)::int AS n FROM awcms_audit_events WHERE action = 'telegram_webhook.rejected'`
        )[0]
      ).toMatchObject({ n: 0 });
    });
  });

  // -------------------------------------------------------------------------
  describe("what the audit trail and the list projections hold", () => {
    test("every action is recorded without the chat id, the code, the token or a body", async () => {
      const code = await requestCode(TENANT_A, USER_1);
      await webhook(startUpdate(code, CHAT_1));
      await inTenant(TENANT_A, async (tx) =>
        confirmWithPin(
          tx,
          TENANT_A,
          USER_1,
          (await getOwnBinding(tx, TENANT_A, USER_1))!.id
        )
      );
      await enqueue(TENANT_A, USER_1);
      await webhook(stopUpdate(CHAT_1));

      const stored = await everythingStored();

      expect(stored).not.toContain(String(CHAT_1));
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(TOKEN);
      expect(await auditActions(TENANT_A)).toEqual(
        expect.arrayContaining([
          "telegram_setting.changed",
          "telegram_link.requested",
          "telegram_binding.created",
          "telegram_binding.confirmed",
          "telegram_binding.revoked"
        ])
      );
    });

    test("the list shows the masked chat and a masked login, never the ciphertext or the hash", async () => {
      await activate(TENANT_A, USER_1, CHAT_1);

      const page = await inTenant(TENANT_A, (tx) =>
        listBindings(tx, TENANT_A, { limit: 10 })
      );
      const serialised = JSON.stringify(page);

      expect(page.bindings[0]).toMatchObject({
        chatMasked: "***567",
        principalLabel: "u*@example.test"
      });
      expect(serialised).not.toContain("v2:");
      expect(serialised).not.toMatch(/k1:[0-9a-f]{20}/);
      expect(serialised).not.toContain(String(CHAT_1));
    });
  });

  // -------------------------------------------------------------------------
  describe("audit fixes (M1, M3, M5, L1, L2, L6, L7)", () => {
    test("L1: confirm and reject name the chat they were shown; another pending chat is a mismatch and is left alone", async () => {
      const code = await requestCode(TENANT_A, USER_1);
      await webhook(startUpdate(code, CHAT_1));
      const shown = await pendingBindingId(TENANT_A, USER_1);
      const other = crypto.randomUUID();

      expect(
        await inTenant(TENANT_A, (tx) =>
          confirmWithPin(tx, TENANT_A, USER_1, other)
        )
      ).toEqual({ outcome: "mismatch" });
      expect(
        await inTenant(TENANT_A, (tx) =>
          rejectOwnBinding(tx, TENANT_A, USER_1, other)
        )
      ).toEqual({ rejected: false, mismatch: true });
      expect((await bindingRow(shown)).status).toBe("pending_confirmation");

      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            confirmWithPin(tx, TENANT_A, USER_1, shown)
          )
        ).outcome
      ).toBe("confirmed");
    });

    test("L2/M5: /start names the tenant; a chat already active for the same person is told so, not asked to confirm", async () => {
      const first = await activate(TENANT_A, USER_1, CHAT_1);
      const code = await requestCode(TENANT_A, USER_1);
      const again = await webhook(startUpdate(code, CHAT_1));

      expect(again).toMatchObject({
        outcome: "already_linked",
        reply: telegramReplyAlreadyLinked("tg965-a")
      });
      expect(again.reply).not.toMatch(/confirm/i);
      expect(again.reply).toContain("tg965-a");
      expect((await bindingRow(first)).status).toBe("active");
      expect(await bindingsOf(TENANT_A)).toHaveLength(1);
    });

    workerTest(
      "M5: confirming queues one notice through the normal queue that names the tenant and /stop",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        const bindingId = (await bindingsOf(TENANT_A))[0]!.id as string;

        await inTenant(TENANT_A, (tx) =>
          enqueueActivationNotice(
            tx,
            {
              tenantId: TENANT_A,
              principalId: USER_1,
              bindingId
            },
            { env: ENV }
          )
        );
        // A replay of the same confirmation does not queue a second one.
        await inTenant(TENANT_A, (tx) =>
          enqueueActivationNotice(
            tx,
            { tenantId: TENANT_A, principalId: USER_1, bindingId },
            { env: ENV }
          )
        );

        const provider = fakeProvider(() => OK);
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 1, sent: 1 });
        expect(provider.requests[0]!.text).toContain("Alerts for tg965-a");
        expect(provider.requests[0]!.text).toContain("/stop");
        expect(provider.requests[0]!.templateKey).toBe(
          "system.binding_activated"
        );
      }
    );

    workerTest(
      "M3: the purge ends the binding of a deactivated person, with TELEGRAM_ENABLED off",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);

        await getAdminSql()`
          UPDATE awcms_tenant_users SET status = 'inactive' WHERE id = ${USER_1}
        `;

        // No env is passed or read: the purge runs whatever the flag says.
        const result = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => false
        } as never);

        expect(result.sweptBindings).toBe(1);
        expect(await bindingRow(id)).toMatchObject({
          status: "revoked",
          revoke_cause: "principal_deactivated",
          chat_ciphertext: null
        });
      }
    );

    workerTest(
      "M3: a person who lost every role loses the binding, but one who keeps a role does not",
      async () => {
        const kept = await activate(TENANT_A, USER_1, CHAT_1);
        const lost = await activate(TENANT_A, USER_2, CHAT_2);

        await getAdminSql()`
          DELETE FROM awcms_access_policies WHERE tenant_user_id = ${USER_2}
        `;

        const result = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => false
        } as never);

        expect(result.sweptBindings).toBe(1);
        expect((await bindingRow(kept)).status).toBe("active");
        expect(await bindingRow(lost)).toMatchObject({
          status: "revoked",
          revoke_cause: "principal_deactivated",
          chat_ciphertext: null
        });
      }
    );

    workerTest(
      "M3: a tenant that switched the module off loses every stored chat id at the next purge, flag or no flag",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);

        await getAdminSql()`
          INSERT INTO awcms_modules (module_key, module_name)
          VALUES ('telegram_delivery', 'Telegram Delivery')
          ON CONFLICT (module_key) DO NOTHING
        `;
        await getAdminSql()`
          INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
          VALUES (${TENANT_A}, 'telegram_delivery', false)
        `;

        const result = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => false
        } as never);

        expect(result.sweptBindings).toBe(1);
        expect(await bindingRow(id)).toMatchObject({
          status: "revoked",
          revoke_cause: "module_disabled",
          chat_ciphertext: null
        });
      }
    );

    workerTest(
      "L7: the worker role can end a binding but can never promote one to active; neither can the app role revive a revoked one",
      async () => {
        const code = await requestCode(TENANT_A, USER_1);
        await webhook(startUpdate(code, CHAT_1));
        const pending = await pendingBindingId(TENANT_A, USER_1);

        await expect(
          withTenantOrThrow(
            getWorkerRoleSql(),
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_telegram_bindings
              SET status = 'active', confirmed_at = now(), pending_expires_at = NULL
              WHERE id = ${pending}
            `
          )
        ).rejects.toThrow(/permission denied/);

        // Even with only the columns it IS allowed to write, the trigger refuses.
        await expect(
          withTenantOrThrow(
            getWorkerRoleSql(),
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_telegram_bindings
              SET status = 'active', pending_expires_at = NULL
              WHERE id = ${pending}
            `
          )
        ).rejects.toThrow(/only the authenticated application role/);
        expect((await bindingRow(pending)).status).toBe("pending_confirmation");

        // The app role confirms through the real path.
        await inTenant(TENANT_A, (tx) =>
          confirmWithPin(tx, TENANT_A, USER_1, pending)
        );
        expect((await bindingRow(pending)).status).toBe("active");

        // And a revoked row cannot be revived, even by the app role.
        await inTenant(TENANT_A, (tx) =>
          endBindings(tx, TENANT_A, { bindingId: pending }, "admin")
        );
        await expect(
          inTenant(
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_telegram_bindings SET status = 'active'
              WHERE id = ${pending}
            `
          )
        ).rejects.toThrow(/only from pending_confirmation/);
      }
    );

    workerTest(
      "N2: the worker can end a binding but cannot redirect a live one (no chat_hash write, no ciphertext swap)",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);
        const before = await bindingRow(id);

        await expect(
          withTenantOrThrow(
            getWorkerRoleSql(),
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_telegram_bindings
              SET chat_hash = ${`k1:${"f".repeat(64)}`} WHERE id = ${id}
            `
          )
        ).rejects.toThrow(/permission denied/);
        await expect(
          withTenantOrThrow(
            getWorkerRoleSql(),
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_telegram_bindings
              SET chat_ciphertext = 'v2:k1:attacker-chosen' WHERE id = ${id}
            `
          )
        ).rejects.toThrow(/may write a Telegram chat ciphertext/);

        const after = await bindingRow(id);

        expect(after.chat_ciphertext).toBe(before.chat_ciphertext);
        expect(after.chat_hash).toBe(before.chat_hash);
        expect(after.status).toBe("active");
      }
    );

    workerTest(
      "L2: the worker cannot dress a pending binding with another name or extend its window, but may NULL them",
      async () => {
        const code = await requestCode(TENANT_A, USER_1);
        await webhook(startUpdate(code, CHAT_1));
        const pending = await pendingBindingId(TENANT_A, USER_1);

        await expect(
          withTenantOrThrow(
            getWorkerRoleSql(),
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_telegram_bindings SET display_name = 'Mallory'
              WHERE id = ${pending}
            `
          )
        ).rejects.toThrow(/may write Telegram binding display data/);
        await expect(
          withTenantOrThrow(
            getWorkerRoleSql(),
            TENANT_A,
            (tx) => tx`
              UPDATE awcms_telegram_bindings
              SET pending_expires_at = now() + interval '30 days'
              WHERE id = ${pending}
            `
          )
        ).rejects.toThrow(/may write Telegram binding display data/);
        expect((await bindingRow(pending)).display_name).toBe("Sari Wulan");

        // NULLing the display name alone is allowed (pending needs no name).
        await withTenantOrThrow(
          getWorkerRoleSql(),
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_telegram_bindings SET display_name = NULL
            WHERE id = ${pending}
          `
        );
        expect((await bindingRow(pending)).display_name).toBeNull();
      }
    );

    workerTest(
      "L3: the worker cannot bring a revoked binding back (to pending or active) but may write the erasure sentinel on it",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);

        await inTenant(TENANT_A, (tx) =>
          endBindings(tx, TENANT_A, { bindingId: id }, "admin")
        );

        for (const target of ["pending_confirmation", "active"]) {
          await expect(
            withTenantOrThrow(
              getWorkerRoleSql(),
              TENANT_A,
              (tx) => tx`
                UPDATE awcms_telegram_bindings SET status = ${target}
                WHERE id = ${id}
              `
            )
          ).rejects.toThrow();
        }

        expect((await bindingRow(id)).status).toBe("revoked");

        await withTenantOrThrow(
          getWorkerRoleSql(),
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_telegram_bindings SET chat_ciphertext = '[erased]'
            WHERE id = ${id}
          `
        );
        expect((await bindingRow(id)).chat_ciphertext).toBe("[erased]");
      }
    );

    workerTest(
      "N4: a suspended tenant keeps no stored chat id after the next purge",
      async () => {
        const id = await activate(TENANT_A, USER_1, CHAT_1);

        await getAdminSql()`
          UPDATE awcms_tenants SET status = 'suspended' WHERE id = ${TENANT_A}
        `;

        const result = await purgeTelegramQueue(getWorkerRoleSql(), TENANT_A, {
          isDescriptorHeld: async () => false
        } as never);

        expect(result.sweptBindings).toBe(1);
        expect(await bindingRow(id)).toMatchObject({
          status: "revoked",
          revoke_cause: "tenant_suspended",
          chat_ciphertext: null
        });
      }
    );

    workerTest(
      "N4: the liveness function answers false for a person of a suspended tenant",
      async () => {
        await activate(TENANT_A, USER_1, CHAT_1);
        await getAdminSql()`
          UPDATE awcms_tenants SET status = 'inactive' WHERE id = ${TENANT_A}
        `;

        const rows = (await withTenantOrThrow(
          getWorkerRoleSql(),
          TENANT_A,
          (tx) => tx`
            SELECT awcms_telegram_principal_active(${TENANT_A}::uuid, ${USER_1}::uuid) AS active
          `
        )) as { active: boolean }[];

        expect(rows[0]!.active).toBe(false);
      }
    );

    test("L6: the bootstrap role reads three identity columns, not the login identifier or the password hash", async () => {
      const privilege = async (column: string) =>
        (
          (await getAdminSql()`
            SELECT has_column_privilege(
              'awcms_telegram_bootstrap', 'awcms_identities', ${column}, 'SELECT'
            ) AS allowed
          `) as { allowed: boolean }[]
        )[0]!.allowed;

      expect(await privilege("status")).toBe(true);
      expect(await privilege("login_identifier")).toBe(false);
      expect(await privilege("password_hash")).toBe(false);
    });

    test("M1: a write-class machine credential authorizes as machine, and the interactive guard refuses it", async () => {
      const admin = getAdminSql();
      const permission = (await admin`
        SELECT id FROM awcms_permissions
        WHERE module_key = 'telegram_delivery' AND activity_code = 'links'
          AND action = 'create'
      `) as { id: string }[];

      await admin`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${TENANT_A}, ${ROLE_A}, ${permission[0]!.id})
      `;

      const issued = await inTenant(TENANT_A, (tx) =>
        issueMachineCredential(
          tx,
          TENANT_A,
          USER_1,
          {
            name: "bot-linker",
            tenantUserId: USER_1,
            allowedPermissionKeys: ["telegram_delivery.links.create"],
            allowedWriteActions: ["create"],
            allowedIpCidrs: ["10.0.0.0/8"],
            expiresAt: new Date(Date.now() + 60 * 60 * 1000)
          },
          new Date()
        )
      );

      if (issued.outcome !== "issued") {
        throw new Error(`credential fixture failed: ${issued.outcome}`);
      }

      const decision = await inTenant(TENANT_A, (tx) =>
        authorizeInTransaction(
          tx,
          TENANT_A,
          hashSessionToken(issued.token),
          new Date(),
          {
            moduleKey: "telegram_delivery",
            activityCode: "links",
            action: "create"
          },
          { clientIp: "10.1.2.3" }
        )
      );

      if (!decision.allowed) {
        throw new Error(
          "expected the credential to be allowed by the chokepoint"
        );
      }

      expect(decision.context.viaMachineCredential).toBe(true);

      const refusal = refuseNonInteractive(decision.context);

      expect(refusal?.status).toBe(403);
      expect(
        ((await refusal!.json()) as { error: { code: string } }).error.code
      ).toBe("INTERACTIVE_SESSION_REQUIRED");
      // A person's own session is not refused.
      expect(refuseNonInteractive({})).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("Issue #1008: proof of possession, runtime ring check, idempotency", () => {
    /** Starts a handshake and returns the binding id the screen would show plus the PIN the chat received. */
    async function pending(chat = CHAT_1, user = USER_1) {
      const code = await requestCode(TENANT_A, user);
      const result = await webhook(startUpdate(code, chat));
      const pin = /PIN is (\d{6})/.exec(result.reply ?? "")?.[1];

      if (!pin) {
        throw new Error("the /start reply carried no PIN");
      }

      return { bindingId: await pendingBindingId(TENANT_A, user), pin, code };
    }

    const wrongPin = (pin: string) => (pin === "000000" ? "000001" : "000000");

    test("M5: /start answers with a PIN; only its keyed hash is stored, nowhere in the clear", async () => {
      const { bindingId, pin, code } = await pending();
      const row = await bindingRow(bindingId);

      expect(String(row.pin_hash)).toMatch(/^k1:[0-9a-f]{64}$/);
      expect(Number(row.pin_attempts)).toBe(0);
      expect(String(row.pin_hash)).not.toContain(pin);

      const stored = await everythingStored();

      expect(stored).not.toContain(`"${pin}"`);
      expect(stored).not.toContain(`PIN is ${pin}`);
      expect(stored).not.toContain(code);
    });

    test("M5: confirming needs the PIN; a wrong one is refused, counted and the binding stays pending", async () => {
      const { bindingId, pin } = await pending();
      const refused = await inTenant(TENANT_A, (tx) =>
        confirmWithPin(tx, TENANT_A, USER_1, bindingId, wrongPin(pin))
      );

      expect(refused).toEqual({ outcome: "pin_invalid", attemptsLeft: 4 });
      expect((await bindingRow(bindingId)).status).toBe("pending_confirmation");
      // The count survives the transaction: it is what bounds guessing.
      expect(Number((await bindingRow(bindingId)).pin_attempts)).toBe(1);
      expect(await auditActions(TENANT_A)).toContain(
        "telegram_binding.pin_failed"
      );

      const accepted = await inTenant(TENANT_A, (tx) =>
        confirmWithPin(tx, TENANT_A, USER_1, bindingId, pin)
      );

      expect(accepted.outcome).toBe("confirmed");
      expect(await bindingRow(bindingId)).toMatchObject({
        status: "active",
        pin_hash: null,
        pin_attempts: 1
      });
    });

    test("M5: the fifth wrong PIN ends the pending binding and erases the chat; even the right PIN is then refused", async () => {
      const { bindingId, pin } = await pending();
      let last: unknown;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        last = await inTenant(TENANT_A, (tx) =>
          confirmWithPin(tx, TENANT_A, USER_1, bindingId, wrongPin(pin))
        );
      }

      expect(last).toEqual({ outcome: "pin_locked" });
      expect(await bindingRow(bindingId)).toMatchObject({
        status: "revoked",
        revoke_cause: "rejected",
        chat_ciphertext: null,
        pin_hash: null
      });
      expect(await auditActions(TENANT_A)).toEqual(
        expect.arrayContaining([
          "telegram_binding.pin_failed",
          "telegram_binding.pin_locked"
        ])
      );
      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            confirmWithPin(tx, TENANT_A, USER_1, bindingId, pin)
          )
        ).outcome
      ).toBe("none");
    });

    test("M5: the attempt bound is the database's, so parallel guesses cannot exceed it", async () => {
      const { bindingId, pin } = await pending();
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          inTenant(TENANT_A, (tx) =>
            confirmWithPin(tx, TENANT_A, USER_1, bindingId, wrongPin(pin))
          )
        )
      );

      expect(results.filter((r) => r.outcome === "pin_invalid")).toHaveLength(
        4
      );
      expect(results.filter((r) => r.outcome === "pin_locked")).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "none")).toHaveLength(7);
      expect((await bindingRow(bindingId)).status).toBe("revoked");
    });

    test("M5: a PIN belongs to ONE binding: the earlier chat's PIN does not confirm the one that superseded it", async () => {
      const first = await pending(CHAT_1);
      const second = await pending(CHAT_2);

      expect(second.bindingId).not.toBe(first.bindingId);

      const attempt = await inTenant(TENANT_A, (tx) =>
        confirmWithPin(tx, TENANT_A, USER_1, second.bindingId, first.pin)
      );

      // Only by a 1-in-a-million coincidence of two random PINs is this not refused.
      if (first.pin !== second.pin) {
        expect(attempt.outcome).toBe("pin_invalid");
      }
    });

    test("M5: a pending binding that predates the PIN (no hash) can never be confirmed", async () => {
      const { bindingId, pin } = await pending();

      await getAdminSql()`
        UPDATE awcms_telegram_bindings SET pin_hash = NULL WHERE id = ${bindingId}
      `;

      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            confirmWithPin(tx, TENANT_A, USER_1, bindingId, pin)
          )
        ).outcome
      ).toBe("pin_invalid");
      expect((await bindingRow(bindingId)).status).toBe("pending_confirmation");
    });

    test("M5: confirm, reject, expiry and revoke all clear the PIN hash", async () => {
      const rejected = await pending(CHAT_1, USER_1);

      await inTenant(TENANT_A, (tx) =>
        rejectOwnBinding(tx, TENANT_A, USER_1, rejected.bindingId)
      );
      expect((await bindingRow(rejected.bindingId)).pin_hash).toBeNull();

      const expired = await pending(CHAT_2, USER_2);

      await inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_telegram_bindings
          SET pending_expires_at = now() - interval '1 minute'
          WHERE id = ${expired.bindingId}
        `
      );
      await inTenant(TENANT_A, (tx) =>
        endBindings(
          tx,
          TENANT_A,
          { pendingExpiredBefore: new Date() },
          "confirmation_expired"
        )
      );
      expect((await bindingRow(expired.bindingId)).pin_hash).toBeNull();
    });

    workerTest(
      "M5: the worker may CLEAR a PIN hash but can neither plant one nor give a pending binding fresh attempts",
      async () => {
        const { bindingId } = await pending();
        const asWorker = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
          withTenantOrThrow(getWorkerRoleSql(), TENANT_A, fn);

        await inTenant(
          TENANT_A,
          (tx) => tx`
            UPDATE awcms_telegram_bindings SET pin_attempts = 3
            WHERE id = ${bindingId}
          `
        );

        await expect(
          asWorker(
            (tx) => tx`
              UPDATE awcms_telegram_bindings
              SET pin_hash = 'k1:planted' WHERE id = ${bindingId}
            `
          )
        ).rejects.toThrow(/verification PIN hash/);
        // pin_attempts is not a column the worker may write at all.
        await expect(
          asWorker(
            (tx) => tx`
              UPDATE awcms_telegram_bindings SET pin_attempts = 0
              WHERE id = ${bindingId}
            `
          )
        ).rejects.toThrow();

        await asWorker((tx) =>
          endBindings(tx, TENANT_A, { bindingId }, "admin")
        );
        expect(await bindingRow(bindingId)).toMatchObject({
          status: "revoked",
          pin_hash: null
        });
      }
    );

    test("the schema refuses a PIN hash on a row that is not pending", async () => {
      const { bindingId } = await pending();

      await inTenant(TENANT_A, (tx) =>
        confirmWithPin(tx, TENANT_A, USER_1, bindingId)
      );
      await assertRejected(
        getAdminSql()`
          UPDATE awcms_telegram_bindings SET pin_hash = 'k1:abc'
          WHERE id = ${bindingId}
        `,
        "a PIN hash on an active binding"
      );
    });

    test("subject-data erasure may overwrite the PIN hash with the sentinel", async () => {
      const { bindingId } = await pending();

      await getAdminSql()`
        UPDATE awcms_telegram_bindings SET pin_hash = '[erased]'
        WHERE id = ${bindingId}
      `;
      expect((await bindingRow(bindingId)).pin_hash).toBe("[erased]");
    });

    test("L11: overlapping encryption and hash rings are refused at RUNTIME, not only by config:validate", async () => {
      const overlapping = {
        ...ENV,
        TELEGRAM_CHAT_HASH_KEYS: `k9:${KEY_ENC}`
      } as NodeJS.ProcessEnv;
      const code = await requestCode(TENANT_A, USER_1);
      const result = await webhook(startUpdate(code, CHAT_1), overlapping);

      expect(result).toMatchObject({ reply: null, outcome: "misconfigured" });
      expect(await count("awcms_telegram_bindings")).toBe(0);
      expect(resolveTelegramEncryptionRing(overlapping).ok).toBe(false);
      expect(resolveTelegramHashRing(overlapping).ok).toBe(false);
      expect(resolveTelegramEncryptionRing(ENV).ok).toBe(true);
      expect(resolveTelegramHashRing(ENV).ok).toBe(true);
    });

    test("L12: the revoke and the switch replay under the same key, conflict on a different request, and do not store refusals", async () => {
      const bindingId = await activate(TENANT_A, USER_1, CHAT_1);
      const revoke = (key: string, id: string = bindingId) =>
        inTenant(TENANT_A, (tx) =>
          runTelegramIdempotent(
            tx,
            TENANT_A,
            TELEGRAM_BINDING_REVOKE_IDEMPOTENCY_SCOPE,
            key,
            USER_2,
            { bindingId: id },
            async () => {
              const ended = await endBindings(
                tx,
                TENANT_A,
                { bindingId: id },
                "admin",
                { actorTenantUserId: USER_2 }
              );

              return ended.ended.length === 0
                ? new Response(null, { status: 404 })
                : { body: { revoked: true } };
            }
          )
        );

      const first = await revoke("revoke-key-1");

      expect(first.status).toBe(200);
      expect(await bindingRow(bindingId)).toMatchObject({ status: "revoked" });

      // The retry of a lost response replays the 200 instead of answering 404.
      const retry = await revoke("revoke-key-1");

      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual(await first.clone().json());

      // A NEW key against the now-ended binding is the honest 404, and it is
      // not stored: the same key retried is still a 404, not a replay.
      expect((await revoke("revoke-key-2")).status).toBe(404);
      expect((await revoke("revoke-key-2")).status).toBe(404);

      // The same key for a different binding is a conflict.
      expect((await revoke("revoke-key-1", crypto.randomUUID())).status).toBe(
        409
      );

      // Another person with the same key value gets no replay of this one.
      const other = await inTenant(TENANT_A, (tx) =>
        runTelegramIdempotent(
          tx,
          TENANT_A,
          TELEGRAM_BINDING_REVOKE_IDEMPOTENCY_SCOPE,
          "revoke-key-1",
          USER_3,
          { bindingId },
          async () => ({ body: { revoked: "again" } })
        )
      );

      expect(((await other.json()) as { data: unknown }).data).toEqual({
        revoked: "again"
      });
    });
  });
});
