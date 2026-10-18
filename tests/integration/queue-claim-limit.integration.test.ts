/**
 * The four queue dispatchers (email, push, whatsapp_delivery, telegram_delivery) claim at most
 * `limit` rows per tick, against a real PostgreSQL, as the least-privilege
 * `awcms_worker` role (Issue #1007).
 *
 * The regression: `UPDATE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP
 * LOCKED)` can claim MORE than `n` rows. When the statistics describe a
 * near-empty table, the planner picks a nested-loop semi join, re-runs the
 * locked `LIMIT` subquery once per outer row, and the second pass hands out a
 * row the same statement already claimed. A `WITH due AS MATERIALIZED (...)`
 * CTE computes the locked id set once and cannot be re-run.
 *
 * The seed reproduces the stale-statistics condition: ANALYZE the queue table
 * while it holds ONE due row, then insert four more due rows. A claim with
 * `limit: 1` must claim exactly one.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
import { dispatchEmailQueue } from "../../src/modules/email/application/email-dispatch";
import type { EmailProvider } from "../../src/modules/email/domain/email-provider-contract";
import { dispatchPushQueue } from "../../src/modules/push-delivery/application/push-dispatch";
import type { PushProvider } from "../../src/modules/push-delivery/domain/push-provider-contract";
import { dispatchWhatsappQueue } from "../../src/modules/whatsapp-delivery/application/whatsapp-dispatch";
import type { WhatsappProvider } from "../../src/modules/whatsapp-delivery/domain/whatsapp-provider-contract";
import { dispatchTelegramQueue } from "../../src/modules/telegram-delivery/application/telegram-dispatch";
import type { TelegramProvider } from "../../src/modules/telegram-delivery/domain/telegram-provider-contract";

const TENANT = "10070000-0000-4000-8000-000000000001";
const DUE_ROWS = 5;
const LIMIT = 1;

const EMAIL_ENV = {
  EMAIL_ENABLED: "true",
  EMAIL_PROVIDER: "fake"
} as unknown as NodeJS.ProcessEnv;

const PUSH_ENV = {
  PUSH_ENABLED: "true",
  PUSH_PROVIDER: "log"
} as unknown as NodeJS.ProcessEnv;

// The dispatcher fails closed without a recipient hash key ring, so the claim
// is never reached without one.
const WHATSAPP_ENV = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "log",
  WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
  ).toString("base64")}`
} as unknown as NodeJS.ProcessEnv;

// The Telegram dispatcher fails closed without the chat-encryption ring, so the
// claim is never reached without one.
const TELEGRAM_ENV = {
  TELEGRAM_ENABLED: "true",
  TELEGRAM_CHAT_ENCRYPTION_KEYS: `k1:${Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
  ).toString("base64")}`
} as unknown as NodeJS.ProcessEnv;

// The providers are stubs that accept every send. The assertions concern the
// CLAIM, so nothing here should reach a real transport.
const ACCEPTING_EMAIL = {
  send: async () => ({ ok: true })
} as unknown as EmailProvider;
const ACCEPTING_PUSH = {
  supportedTransports: ["web_push", "fcm"],
  send: async () => ({ ok: true })
} as unknown as PushProvider;
const ACCEPTING_WHATSAPP = {
  send: async () => ({ ok: true, providerMessageId: "wamid.1007" }),
  healthCheck: async () => ({ ok: true })
} as unknown as WhatsappProvider;

const ACCEPTING_TELEGRAM = {
  send: async () => ({ ok: true, providerMessageId: "9001" }),
  healthCheck: async () => ({ ok: true })
} as unknown as TelegramProvider;

const admin = () => getAdminSql();

async function seedTenant(): Promise<void> {
  await admin()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'q1007', 'q1007')
  `;
}

/** A push subscription needs the profile → identity → tenant-user chain. */
async function seedSubscription(): Promise<string> {
  const profile = (await admin()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Queue Claim') RETURNING id
  `) as { id: string }[];
  const identity = (await admin()`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'queue-claim@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin()`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const subscription = (await admin()`
    INSERT INTO awcms_push_subscriptions
      (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
       endpoint_masked)
    VALUES (${TENANT}, ${tenantUser[0]!.id}, 'fcm', 'fcm-token-1007',
            ${"h".repeat(64)}, 'fcm-***1007')
    RETURNING id
  `) as { id: string }[];

  return subscription[0]!.id;
}

async function seedEmail(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await admin()`
      INSERT INTO awcms_email_messages
        (tenant_id, category, to_address, to_address_hash, to_address_masked,
         subject, status)
      VALUES (${TENANT}, 'auth.password_reset', ${`user${i}@example.test`},
              ${"h".repeat(64)}, 'u***@example.test', 'Subject', 'queued')
    `;
  }
}

/**
 * A Telegram message needs the whole chain: a tenant user holding a role, a
 * binding, and the tenant's switch turned on (the dispatcher re-checks all
 * three before it claims anything). The chat ciphertext is never decrypted by
 * this test: it asserts the CLAIM only.
 */
async function seedTelegramBinding(): Promise<{
  principalId: string;
  bindingId: string;
}> {
  const profile = (await admin()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Queue Claim Tg') RETURNING id
  `) as { id: string }[];
  const identity = (await admin()`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'queue-claim-tg@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin()`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const role = (await admin()`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${TENANT}, 'q1007-staff', 'Staff') RETURNING id
  `) as { id: string }[];

  await admin()`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id, status,
       effective_from)
    VALUES (${TENANT}, ${tenantUser[0]!.id}, ${role[0]!.id}, 'tenant',
            ${TENANT}, 'active', now() - interval '1 minute')
  `;
  await admin()`
    INSERT INTO awcms_telegram_settings (tenant_id, enabled, updated_by)
    VALUES (${TENANT}, true, ${tenantUser[0]!.id})
  `;

  // A binding may only become `active` as the application role, from
  // `pending_confirmation` (sql/216): insert it pending, then activate it the
  // way the confirm route does.
  const binding = (await admin()`
    INSERT INTO awcms_telegram_bindings
      (tenant_id, principal_id, status, chat_ciphertext, chat_hash,
       hash_key_id, chat_masked, pending_expires_at)
    VALUES (${TENANT}, ${tenantUser[0]!.id}, 'pending_confirmation',
            'not-decrypted-here', ${`k1:${"0".repeat(64)}`}, 'k1', '***567',
            now() + interval '10 minutes')
    RETURNING id
  `) as { id: string }[];

  await withTenantOrThrow(
    getRuntimeSql(),
    TENANT,
    (tx) => tx`
      UPDATE awcms_telegram_bindings
      SET status = 'active', confirmed_at = now(), pending_expires_at = NULL
      WHERE id = ${binding[0]!.id}
    `
  );

  return { principalId: tenantUser[0]!.id, bindingId: binding[0]!.id };
}

async function seedTelegram(
  count: number,
  from: number,
  chain: { principalId: string; bindingId: string }
): Promise<void> {
  for (let i = from; i < from + count; i += 1) {
    await admin()`
      INSERT INTO awcms_telegram_messages
        (tenant_id, idempotency_key, template_key, principal_id, binding_id,
         body, status, expires_at)
      VALUES (${TENANT}, ${`k1007-tg-${i}`}, 'system.ops_alert',
              ${chain.principalId}, ${chain.bindingId}, 'Alert', 'queued',
              now() + interval '1 hour')
    `;
  }
}

async function seedPush(count: number, subscriptionId: string): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await admin()`
      INSERT INTO awcms_push_messages
        (tenant_id, category, subscription_id, recipient_tenant_user_id, title,
         body, status)
      SELECT ${TENANT}, 'account.notice', id, tenant_user_id, 'Title', 'Body',
             'queued'
      FROM awcms_push_subscriptions WHERE id = ${subscriptionId}
    `;
  }
}

async function seedWhatsapp(count: number, from: number): Promise<void> {
  for (let i = from; i < from + count; i += 1) {
    await admin()`
      INSERT INTO awcms_whatsapp_messages
        (tenant_id, idempotency_key, template_key, template_version, purpose,
         recipient, recipient_hash, recipient_masked, body, status)
      VALUES (${TENANT}, ${`k1007-${i}`}, 'it1007.reminder', 1, 'transactional',
              '+6281234567890', ${`k1:${"0".repeat(64)}`}, '+*********7890',
              'Reminder', 'queued')
    `;
  }
}

/**
 * The stale-statistics condition: the table is analyzed while it holds one
 * due row, then the rest of the due rows arrive. The planner's estimate of the
 * table stays at one row, which is what selects the nested-loop plan.
 */
async function analyzeThenFill(
  table: string,
  seedFirst: () => Promise<void>,
  seedRest: () => Promise<void>
): Promise<void> {
  await seedFirst();
  await admin().unsafe(`ANALYZE ${table}`);
  await seedRest();
}

async function countRows(table: string, status: string): Promise<number> {
  const rows = (await admin().unsafe(
    `SELECT count(*)::int AS n FROM ${table} WHERE status = $1`,
    [status]
  )) as { n: number }[];

  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("queue claim honours LIMIT against PostgreSQL (Issue #1007)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant();
  });

  test("email: LIMIT 1 claims exactly one of five due rows", async () => {
    if (!workerRoleActivated) return;

    await analyzeThenFill(
      "awcms_email_messages",
      () => seedEmail(1),
      () => seedEmail(DUE_ROWS - 1)
    );

    const result = await dispatchEmailQueue(getWorkerRoleSql(), TENANT, {
      limit: LIMIT,
      env: EMAIL_ENV,
      resolveProvider: () => ACCEPTING_EMAIL
    });

    expect(result.claimed).toBe(1);
    expect(await countRows("awcms_email_messages", "queued")).toBe(
      DUE_ROWS - 1
    );
  });

  test("push: LIMIT 1 claims exactly one of five due rows", async () => {
    if (!workerRoleActivated) return;

    const subscriptionId = await seedSubscription();
    await analyzeThenFill(
      "awcms_push_messages",
      () => seedPush(1, subscriptionId),
      () => seedPush(DUE_ROWS - 1, subscriptionId)
    );

    const result = await dispatchPushQueue(getWorkerRoleSql(), TENANT, {
      limit: LIMIT,
      env: PUSH_ENV,
      resolveProvider: () => ACCEPTING_PUSH
    });

    expect(result.claimed).toBe(1);
    expect(await countRows("awcms_push_messages", "queued")).toBe(DUE_ROWS - 1);
  });

  test("whatsapp_delivery: LIMIT 1 claims exactly one of five due rows", async () => {
    if (!workerRoleActivated) return;

    await analyzeThenFill(
      "awcms_whatsapp_messages",
      () => seedWhatsapp(1, 0),
      () => seedWhatsapp(DUE_ROWS - 1, 1)
    );

    const result = await dispatchWhatsappQueue(getWorkerRoleSql(), TENANT, {
      limit: LIMIT,
      env: WHATSAPP_ENV,
      resolveProvider: () => ACCEPTING_WHATSAPP
    });

    expect(result.claimed).toBe(1);
    expect(await countRows("awcms_whatsapp_messages", "queued")).toBe(
      DUE_ROWS - 1
    );
  });

  test("telegram_delivery: LIMIT 1 claims exactly one of five due rows", async () => {
    if (!workerRoleActivated) return;

    const chain = await seedTelegramBinding();
    await analyzeThenFill(
      "awcms_telegram_messages",
      () => seedTelegram(1, 0, chain),
      () => seedTelegram(DUE_ROWS - 1, 1, chain)
    );

    const result = await dispatchTelegramQueue(getWorkerRoleSql(), TENANT, {
      limit: LIMIT,
      env: TELEGRAM_ENV,
      resolveProvider: () => ACCEPTING_TELEGRAM
    });

    expect(result.claimed).toBe(1);
    expect(await countRows("awcms_telegram_messages", "queued")).toBe(
      DUE_ROWS - 1
    );
  });
});
