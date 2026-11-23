/**
 * Defence in depth for the customer Telegram dispatcher's dedicated role
 * (`awcms_telegram_engagement_dispatch`), sql/436 + sql/437, proven on a REAL
 * login as the role (exactly how `telegram-engagement:dispatch` connects):
 *
 *   * the role holds no direct write on a bot account or its health row; the
 *     only write is the fixed-body definer `awcms_telegram_engagement_report_bot_health`,
 *     which writes constants and moves `version` by one per real transition;
 *   * after the role tries what it can, the app role still disconnects the bot
 *     and its token ciphertext is gone;
 *   * a contact the role marks blocked stores `version = OLD + 1` whatever the
 *     statement wrote;
 *   * the role's session carries `idle_in_transaction_session_timeout` and
 *     `transaction_timeout`, so a held definer lock cannot stall the app;
 *   * `security:readiness` fails when any of these is undone, and passes again
 *     once restored.
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { disconnectAccount } from "../../src/modules/channel-accounts/application/account-directory";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { recordBotHealth } from "../../src/modules/telegram-engagement/infrastructure/channel-accounts-bridge";
import {
  TELEGRAM_DISPATCH_DEFINER_FUNCTIONS,
  checkTelegramEngagementDispatchRole
} from "../../scripts/security-readiness";

const TENANT_A = "a1436c00-0000-4000-8000-00000000000a";
const TENANT_B = "a1436c00-0000-4000-8000-00000000000b";
const ACTOR = "a1436c00-0000-4000-8000-0000000000ff";
const ROLE = "awcms_telegram_engagement_dispatch";
const ROLE_PASSWORD = "t1436-telegram-fixture-password";
const REPORT_FILE =
  "sql/436_awcms_telegram_dispatch_health_report_function.sql";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 11) % 251)
  ).toString("base64");
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${bytes(23)}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);

let roleLogin: Bun.SQL | undefined;
let databaseName = "";

function loginUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);

  url.username = ROLE;
  url.password = ROLE_PASSWORD;
  url.pathname = `/${databaseName}`;

  return url.toString();
}

const asApp = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(getRuntimeSql(), tenantId, fn);

const asRole = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(roleLogin!, tenantId, fn);

async function sqlState(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();

    return null;
  } catch (error) {
    return String((error as { errno?: unknown }).errno ?? "error");
  } finally {
    resetDatabaseCircuitBreakerForTests();
  }
}

let externalSeq = 9_436_000;

async function seedBot(
  tenantId: string,
  status = "connected"
): Promise<{ id: string; secretId: string }> {
  const secret = await asApp(tenantId, (tx) =>
    store.put(tx, {
      tenantId,
      purpose: "bot_token",
      plaintext: `123456:BOT-${(externalSeq += 1)}`,
      createdBy: null
    })
  );
  const rows = (await getAdminSql()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, secret_id)
    VALUES (${tenantId}, 'telegram', 'bot', ${String(externalSeq)}, 'Bot',
            'bot_token', ${status}, ${secret.secretId})
    RETURNING id
  `) as { id: string }[];

  return { id: rows[0]!.id, secretId: secret.secretId };
}

async function accountRow(id: string) {
  return (
    (await getAdminSql()`
      SELECT a.status, a.status_reason, a.version, h.state, h.reason_code
      FROM awcms_channel_accounts a
      LEFT JOIN awcms_channel_account_health h
        ON h.tenant_id = a.tenant_id AND h.account_id = a.id
      WHERE a.id = ${id}
    `) as Record<string, unknown>[]
  )[0];
}

async function readinessAround(mutate: string, restore: string) {
  const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

  try {
    let broken: { status: string; evidence: string };

    await admin.unsafe(mutate);

    try {
      broken = await checkTelegramEngagementDispatchRole();
    } finally {
      await admin.unsafe(restore);
    }

    return {
      broken,
      restored: (await checkTelegramEngagementDispatchRole()).status
    };
  } finally {
    await admin.close({ timeout: 1 });
  }
}

async function seedTenants(): Promise<void> {
  const admin = getAdminSql();

  for (const [id, code] of [
    [TENANT_A, "tgb1436-a"],
    [TENANT_B, "tgb1436-b"]
  ] as const) {
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT_A}, 'person', 'operator') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT_A}, ${profile[0]!.id}, 'operator-1436@example.test', 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${ACTOR}, ${TENANT_A}, ${identity[0]!.id})
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "the Telegram dispatcher's dedicated role boundary against PostgreSQL",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();

      const admin = getAdminSql();

      databaseName = (
        (await admin`SELECT current_database() AS name`) as { name: string }[]
      )[0]!.name;
      await admin.unsafe(
        `ALTER ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}'`
      );
      roleLogin = new Bun.SQL(loginUrl(), { max: 2 });
    });

    afterAll(async () => {
      await roleLogin?.close({ timeout: 1 });
      roleLogin = undefined;
      await getAdminSql().unsafe(`ALTER ROLE ${ROLE} NOLOGIN PASSWORD NULL`);
      await teardownIntegrationDatabase();
    });

    beforeEach(async () => {
      await resetDatabase();
      await seedTenants();
    });

    test("as the role, every direct bot account and health write is refused, version = 2147483647 included", async () => {
      const bot = await seedBot(TENANT_A);
      const statements = [
        (tx) =>
          tx`UPDATE awcms_channel_accounts SET version = 2147483647 WHERE id = ${bot.id}`,
        (tx) =>
          tx`UPDATE awcms_channel_accounts SET status = 'degraded', status_reason = 'free text' WHERE id = ${bot.id}`,
        (tx) =>
          tx`INSERT INTO awcms_channel_account_health (tenant_id, account_id, state, reason_code, checked_at) VALUES (${TENANT_A}, ${bot.id}, 'ok', NULL, now() - interval '9 years')`,
        (tx) => tx`SELECT checked_at FROM awcms_channel_account_health`
      ] as ((tx: Bun.TransactionSQL) => Promise<unknown>)[];

      for (const statement of statements) {
        expect(await sqlState(() => asRole(TENANT_A, statement))).toBe("42501");
      }

      expect(await accountRow(bot.id)).toMatchObject({
        status: "connected",
        version: 1
      });
    });

    test("the definer writes only its constants and moves version by one per real transition", async () => {
      const bot = await seedBot(TENANT_A);
      const pending = await seedBot(TENANT_A, "pending");
      const report = (id: string, verdict: "OK" | "TOKEN_REJECTED") =>
        asRole(TENANT_A, (tx) => recordBotHealth(tx, TENANT_A, id, verdict));

      expect(await report(bot.id, "TOKEN_REJECTED")).toBe("DEGRADED");

      for (let i = 0; i < 10; i += 1) {
        expect(await report(bot.id, "TOKEN_REJECTED")).toBe("UNCHANGED");
      }

      expect(await accountRow(bot.id)).toEqual({
        status: "degraded",
        status_reason: "TOKEN_REJECTED",
        version: 2,
        state: "failing",
        reason_code: "TOKEN_REJECTED"
      });
      expect(await report(pending.id, "OK")).toBe("CONNECTED");
      expect(await report(pending.id, "OK")).toBe("UNCHANGED");
      expect(await accountRow(pending.id)).toEqual({
        status: "connected",
        status_reason: null,
        version: 2,
        state: "ok",
        reason_code: null
      });
    });

    test("the definer refuses another tenant, a free verdict and the app role, and leaves other providers alone", async () => {
      const bot = await seedBot(TENANT_A);
      const call = (tenantArg: string, verdict: string) =>
        asRole(
          TENANT_A,
          (tx) =>
            tx`SELECT awcms_telegram_engagement_report_bot_health(${tenantArg}::uuid, ${bot.id}::uuid, ${verdict})`
        );

      expect(await sqlState(() => call(TENANT_B, "OK"))).toBe("42501");
      expect(await sqlState(() => call(TENANT_A, "free text"))).toBe("22023");
      expect(
        await sqlState(() =>
          asApp(
            TENANT_A,
            (tx) =>
              tx`SELECT awcms_telegram_engagement_report_bot_health(${TENANT_A}::uuid, ${bot.id}::uuid, 'OK')`
          )
        )
      ).toBe("42501");

      const whatsapp = (await getAdminSql()`
      INSERT INTO awcms_channel_accounts
        (tenant_id, provider, account_kind, external_id, display_name,
         auth_mode, status)
      VALUES (${TENANT_A}, 'whatsapp_cloud', 'waba_phone_number', 'wa-1436',
              'wa', 'api_token', 'connected')
      RETURNING id
    `) as { id: string }[];

      expect(
        await asRole(TENANT_A, (tx) =>
          recordBotHealth(tx, TENANT_A, whatsapp[0]!.id, "TOKEN_REJECTED")
        )
      ).toBe("NOT_A_BOT");
      expect((await accountRow(whatsapp[0]!.id))!.status).toBe("connected");
    });

    test("after the role tries what it can, the app role disconnects the bot and its token ciphertext is gone", async () => {
      const bot = await seedBot(TENANT_A);

      await sqlState(() =>
        asRole(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_channel_accounts SET version = 2147483647 WHERE id = ${bot.id}`
        )
      );
      await asRole(TENANT_A, (tx) =>
        recordBotHealth(tx, TENANT_A, bot.id, "TOKEN_REJECTED")
      );

      const result = await asApp(TENANT_A, (tx) =>
        disconnectAccount(tx, store, TENANT_A, ACTOR, bot.id)
      );

      expect(result).toMatchObject({
        outcome: "disconnected",
        credentialErased: true
      });

      const left = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_channel_secrets WHERE id = ${bot.secretId}
    `) as { n: number }[];

      expect(left[0]!.n).toBe(0);
    });

    test("a contact the role marks blocked stores version OLD + 1, whatever the statement wrote", async () => {
      const bot = await seedBot(TENANT_A);
      const contact = (
        (await getAdminSql()`
        INSERT INTO awcms_telegram_engagement_contacts
          (tenant_id, account_id, contact_hash, chat_ciphertext, state)
        VALUES (${TENANT_A}, ${bot.id}, ${`k1:${"f".repeat(64)}`},
                'v2:probe:aa:bb:cc', 'started')
        RETURNING id, version
      `) as { id: string; version: number }[]
      )[0]!;

      await asRole(
        TENANT_A,
        (tx) =>
          tx`UPDATE awcms_telegram_engagement_contacts SET state = 'blocked', blocked_at = now(), version = 2147483647, updated_at = now() WHERE id = ${contact.id}`
      );

      const row = (await getAdminSql()`
      SELECT state, version FROM awcms_telegram_engagement_contacts WHERE id = ${contact.id}
    `) as { state: string; version: number }[];

      expect(row[0]).toEqual({
        state: "blocked",
        version: Number(contact.version) + 1
      });

      // The app's own `version = version + 1` on the same contact still works.
      await asApp(
        TENANT_A,
        (tx) =>
          tx`UPDATE awcms_telegram_engagement_contacts SET version = version + 1, updated_at = now() WHERE id = ${contact.id}`
      );
    });

    test("a real login as the role carries the reviewed timeouts", async () => {
      const shown = (await roleLogin!`
      SELECT current_setting('idle_in_transaction_session_timeout') AS idle,
             current_setting('transaction_timeout') AS tx
    `) as { idle: string; tx: string }[];

      expect(shown[0]).toEqual({ idle: "15s", tx: "30s" });
    });

    test("a role transaction left idle after the definer lock is ended, and the app's disconnect goes through", async () => {
      const bot = await seedBot(TENANT_A);
      const holder = new Bun.SQL(loginUrl(), { max: 1 });

      try {
        const reserved = await holder.reserve();

        await reserved.unsafe("BEGIN");
        await reserved`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`;
        await reserved`SELECT awcms_telegram_engagement_report_bot_health(${TENANT_A}::uuid, ${bot.id}::uuid, 'TOKEN_REJECTED')`;

        const started = Date.now();
        const result = await asApp(TENANT_A, (tx) =>
          disconnectAccount(tx, store, TENANT_A, ACTOR, bot.id)
        );
        const waited = Date.now() - started;

        expect(result).toMatchObject({ outcome: "disconnected" });
        expect(waited).toBeLessThan(25_000);
        expect(waited).toBeGreaterThan(5_000);
      } finally {
        await holder.close({ timeout: 1 }).catch(() => undefined);
        resetDatabaseCircuitBreakerForTests();
      }
    });

    describe("readiness pins every control (mutations FAIL, restore passes)", () => {
      test("readiness passes on the migrated database", async () => {
        const result = await checkTelegramEngagementDispatchRole();

        expect(result.status, result.evidence).toBe("pass");
      });

      const signature = TELEGRAM_DISPATCH_DEFINER_FUNCTIONS[0]!.signature;
      const mutations: [string, string, string][] = [
        [
          "UPDATE (version) re-granted on the accounts",
          `GRANT UPDATE (version) ON awcms_channel_accounts TO ${ROLE}`,
          `REVOKE UPDATE (version) ON awcms_channel_accounts FROM ${ROLE}`
        ],
        [
          "a health INSERT re-granted",
          `GRANT INSERT (tenant_id, account_id, state, reason_code, checked_at) ON awcms_channel_account_health TO ${ROLE}`,
          `REVOKE INSERT (tenant_id, account_id, state, reason_code, checked_at) ON awcms_channel_account_health FROM ${ROLE}`
        ],
        [
          "EXECUTE on the definer granted to PUBLIC",
          `GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC`,
          `REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC`
        ],
        [
          "the contact version trigger disabled",
          "ALTER TABLE awcms_telegram_engagement_contacts DISABLE TRIGGER awcms_telegram_engagement_contacts_dispatch_version",
          "ALTER TABLE awcms_telegram_engagement_contacts ENABLE TRIGGER awcms_telegram_engagement_contacts_dispatch_version"
        ],
        [
          "the idle-in-transaction timeout reset",
          `ALTER ROLE ${ROLE} RESET idle_in_transaction_session_timeout`,
          `ALTER ROLE ${ROLE} SET idle_in_transaction_session_timeout = '15s'`
        ],
        [
          "transaction_timeout relaxed for this database",
          `DO $$ BEGIN EXECUTE format('ALTER ROLE ${ROLE} IN DATABASE %I SET transaction_timeout = 0', current_database()); END $$`,
          `DO $$ BEGIN EXECUTE format('ALTER ROLE ${ROLE} IN DATABASE %I RESET transaction_timeout', current_database()); END $$`
        ],
        [
          "a membership in awcms_app",
          `GRANT awcms_app TO ${ROLE} WITH INHERIT FALSE, SET TRUE`,
          `REVOKE awcms_app FROM ${ROLE}`
        ]
      ];

      for (const [label, mutate, restore] of mutations) {
        test(`readiness FAILS with ${label}`, async () => {
          const outcome = await readinessAround(mutate, restore);

          expect(outcome.broken.status, label).toBe("fail");
          expect(outcome.restored, `${label} restored`).toBe("pass");
        });
      }

      test("a hollowed definer body (a chosen version, no transition test) FAILS readiness, by the pin and by the probe", async () => {
        const original = await Bun.file(REPORT_FILE).text();
        const from = original.indexOf(
          "CREATE OR REPLACE FUNCTION awcms_telegram_engagement_report_bot_health("
        );
        const to = original.indexOf("$function$;", from) + "$function$;".length;
        const create = original.slice(from, to);
        const hollowed = create
          .replace(
            "  IF v_status IS DISTINCT FROM 'connected' THEN\n    RETURN 'UNCHANGED';\n  END IF;\n",
            ""
          )
          .replace(
            "      status_reason = p_verdict,\n      updated_at = now(),\n      version = version + 1",
            "      status_reason = p_verdict,\n      updated_at = now(),\n      version = 2147483647"
          );

        expect(hollowed).not.toBe(create);

        const outcome = await readinessAround(hollowed, create);

        expect(outcome.broken.status).toBe("fail");
        expect(outcome.broken.evidence).toContain(
          "its body is no longer the reviewed one"
        );
        expect(outcome.broken.evidence).toContain("did not write exactly");
        expect(outcome.restored).toBe("pass");
      });
    });
  }
);
