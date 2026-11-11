/**
 * `telegram_engagement` against a real PostgreSQL (Issue #1156, ADR-0152) —
 * WORLD 1 of the harness: migrations ran as a demoted owner and every call goes
 * through the least-privilege runtime role, so RLS `FORCE`, the GRANTs and the
 * integrity triggers are observed. The webhook handler and the dispatcher run
 * for real with that pool injected; only Telegram is a recording fake.
 *
 * ADR-0152 section 9 test matrix covered here:
 *
 *   T-A1  2 tenants, 3 bots in one tenant, distinct callback tokens and secrets;
 *         wrong-bot and wrong-tenant updates refused with the same reply
 *   T-A2  the staff bot cannot be registered; one bot cannot be claimed twice
 *   T-W1  missing/wrong header, unknown/malformed token, revoked endpoint: one
 *         generic 401
 *   T-W2  replayed update and concurrent duplicate: one effect
 *   T-W3  forwarded /start, group, bot sender, edited message: no state change
 *   T-C1  /start = support only; explicit button for marketing; forged button
 *         refused; /stop and a provider 403 revoke at once; revoked consent
 *         blocks a queued row at dispatch
 *   T-K1  rotation: the old callback and header stop working; no token, seed,
 *         header, chat id or text in any persisted row, audit or event
 *   T-R1  429 retry_after without spending budget, uncertain send not retried,
 *         a crash mid-send becomes uncertain, the daily ceiling defers
 *   T-N2  no contact without /start; enqueue for an unknown id refused
 *   T-I1  another tenant's contact and bot are invisible (RLS)
 *   T-D1  erasure: ciphertext, label and key erased, evidence kept, a returning
 *         person is a new contact
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
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { refuseUnauthenticatedApiBody } from "../../src/lib/auth/api-body-authentication";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { requiresAuthenticatedCallerBeforeBody } from "../../src/lib/security/api-body-auth-boundary";
import { assertConnectedAsDispatchRole } from "../../src/lib/database/telegram-engagement-dispatch-client";
import { resetRateLimitForTests } from "../../src/lib/security/rate-limit";
import { defaultSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import {
  registerBot,
  revokeBot,
  rotateBot
} from "../../src/modules/telegram-engagement/application/bot-directory";
import {
  contactDetail,
  endContact,
  fetchContact
} from "../../src/modules/telegram-engagement/application/contact-directory";
import { dispatchTelegramEngagement } from "../../src/modules/telegram-engagement/application/dispatch";
import { enqueueMessage } from "../../src/modules/telegram-engagement/application/outbound-enqueue";
import { handleTelegramEngagementWebhook } from "../../src/modules/telegram-engagement/application/webhook-handler";
import { resetWebhookRejectionsForTests } from "../../src/modules/telegram-engagement/application/webhook-ingest";
import { resolveTelegramEngagementRing } from "../../src/modules/telegram-engagement/domain/telegram-engagement-config";
import type {
  BotApiMethod,
  BotApiOutcome,
  BotApiTransport
} from "../../src/modules/telegram-engagement/infrastructure/bot-api-client";

const T1 = "e1156000-0000-4000-8000-000000000001";
const T2 = "e1156000-0000-4000-8000-000000000002";
const U1 = "e1156000-0000-4000-8000-000000000101";
const U2 = "e1156000-0000-4000-8000-000000000201";

const BOT_IDS = {
  a: "7000000001",
  b: "7000000002",
  c: "7000000003",
  t2: "7000000009"
};
const STAFF_BOT_ID = "7000000099";
const tokenFor = (botId: string) =>
  `${botId}:AAH${botId}canaryTokenSecretPart_0123456789`;
const STAFF_TOKEN = tokenFor(STAFF_BOT_ID);

const CHANNEL_RING = `k1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 3 + 1) % 251)
).toString("base64")}`;
const ENGAGEMENT_RING = `e1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 17 + 9) % 251)
).toString("base64")}`;

const ENV: NodeJS.ProcessEnv = {
  TELEGRAM_ENGAGEMENT_ENABLED: "true",
  TELEGRAM_ENGAGEMENT_KEYS: ENGAGEMENT_RING,
  APP_URL: "https://budget.example",
  TELEGRAM_BOT_TOKEN: STAFF_TOKEN,
  TELEGRAM_ENGAGEMENT_WEBHOOK_RATE_PER_MINUTE: "100000",
  TELEGRAM_ENGAGEMENT_ENDPOINT_RATE_PER_MINUTE: "100000"
};

const ENV_NAMES = [
  "CHANNEL_ACCOUNTS_ENABLED",
  "CHANNEL_SECRETS_ENCRYPTION_KEYS",
  "TELEGRAM_ENGAGEMENT_ENABLED",
  "TELEGRAM_ENGAGEMENT_KEYS"
];
const savedEnv: Record<string, string | undefined> = {};

const inTenant = <T>(tenantId: string, work: (tx: Bun.SQL) => Promise<T>) =>
  withTenantOrThrow(getRuntimeSql(), tenantId, (tx) => work(tx));

function ring() {
  const resolved = resolveTelegramEngagementRing(ENV);

  if (!resolved.ok) throw new Error(resolved.reason);

  return resolved;
}

// ---------------------------------------------------------------------------
// The recording Telegram fake
// ---------------------------------------------------------------------------

type Call = {
  token: string;
  method: BotApiMethod;
  body: Record<string, unknown>;
};

class FakeTelegram {
  calls: Call[] = [];
  nextMessageId = 100;
  /** A scripted answer for the next call of a method (FIFO), else the default. */
  scripted: Partial<Record<BotApiMethod, BotApiOutcome[]>> = {};

  transport: BotApiTransport = async (token, method, body) => {
    this.calls.push({ token, method, body: structuredClone(body) });

    const queue = this.scripted[method];

    if (queue && queue.length > 0) return queue.shift()!;

    if (method === "getMe") {
      const botId = Number(token.slice(0, token.indexOf(":")));

      return {
        kind: "ok",
        result: { id: botId, is_bot: true, username: `bot_${botId}` }
      };
    }

    if (method === "sendMessage") {
      this.nextMessageId += 1;

      return { kind: "ok", result: { message_id: this.nextMessageId } };
    }

    return { kind: "ok", result: true };
  };

  /** The URL token and the header the LAST setWebhook registered for a bot. */
  webhookFor(botId: string): { token: string; header: string } {
    const call = [...this.calls]
      .reverse()
      .find(
        (c) => c.method === "setWebhook" && c.token.startsWith(`${botId}:`)
      );

    if (!call) throw new Error(`no setWebhook for ${botId}`);

    const url = call.body.url as string;

    return {
      token: url.slice(url.lastIndexOf("/") + 1),
      header: call.body.secret_token as string
    };
  }

  sends(): Call[] {
    return this.calls.filter((c) => c.method === "sendMessage");
  }
}

let telegram: FakeTelegram;

/**
 * The dispatcher's own least-privilege role (`sql/353`, audit H-2 of PR #1260),
 * activated LOGIN for this run only. EVERY dispatch below runs through it, so a
 * grant the job needs and the migration forgot is a failing test, not a
 * `permission denied` in production.
 */
const DISPATCH_ROLE = "awcms_telegram_engagement_dispatch";
const DISPATCH_ROLE_PASSWORD = "integration_tge_dispatch_role_password";
let dispatchRoleSql: Bun.SQL | undefined;

async function activateDispatchRole(): Promise<Bun.SQL> {
  const admin = getAdminSql();
  const database = (
    (await admin`SELECT current_database() AS name`) as { name: string }[]
  )[0]!.name;

  await admin.unsafe(
    `ALTER ROLE ${DISPATCH_ROLE} LOGIN PASSWORD '${DISPATCH_ROLE_PASSWORD}'`
  );

  const url = new URL(process.env.DATABASE_URL!);

  url.pathname = `/${database}`;
  url.username = DISPATCH_ROLE;
  url.password = DISPATCH_ROLE_PASSWORD;

  return new Bun.SQL(url.toString(), { max: 2 });
}

const dispatch = (tenantId: string, extra: Record<string, unknown> = {}) =>
  dispatchTelegramEngagement(dispatchRoleSql!, tenantId, {
    transport: telegram.transport,
    env: ENV,
    sleep: async () => undefined,
    ...extra
  });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedTenant(tenantId: string, code: string, userId: string) {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${code})
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${code}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${code}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
  `;
}

/** A telegram bot channel account with its token stored and `inbound` + `dm` granted with evidence. */
async function seedBotAccount(
  tenantId: string,
  actor: string,
  botId: string
): Promise<string> {
  return inTenant(tenantId, async (tx) => {
    const secret = await defaultSecretStore.put(tx, {
      tenantId,
      purpose: "bot_token",
      plaintext: tokenFor(botId),
      createdBy: actor
    });
    const rows = (await tx`
      INSERT INTO awcms_channel_accounts
        (tenant_id, provider, account_kind, external_id, display_name,
         auth_mode, secret_id, status, created_by)
      VALUES (${tenantId}, 'telegram', 'bot', ${botId}, ${`Bot ${botId}`},
              'bot_token', ${secret.secretId}, 'pending', ${actor})
      RETURNING id
    `) as { id: string }[];
    const accountId = rows[0]!.id;

    for (const capability of ["inbound", "dm"]) {
      await tx`
        INSERT INTO awcms_channel_account_capabilities
          (tenant_id, account_id, capability, state, evidence_kind,
           evidence_ref, matrix_version, verified_at, granted_by)
        VALUES (${tenantId}, ${accountId}, ${capability}, 'granted',
                'app_review_reference', 'botfather-test', 1, now(), ${actor})
      `;
    }

    return accountId;
  });
}

type Fx = { accounts: Record<keyof typeof BOT_IDS, string> };
let fx: Fx;

async function seedFixture(): Promise<Fx> {
  await seedTenant(T1, "tg-one", U1);
  await seedTenant(T2, "tg-two", U2);

  const accounts = {
    a: await seedBotAccount(T1, U1, BOT_IDS.a),
    b: await seedBotAccount(T1, U1, BOT_IDS.b),
    c: await seedBotAccount(T1, U1, BOT_IDS.c),
    t2: await seedBotAccount(T2, U2, BOT_IDS.t2)
  };

  for (const key of ["a", "b", "c"] as const) {
    const result = await inTenant(T1, (tx) =>
      registerBot(
        tx,
        T1,
        U1,
        { accountId: accounts[key], dailySendCeiling: null },
        ENV
      )
    );

    expect(result.outcome).toBe("registered");
  }

  const t2 = await inTenant(T2, (tx) =>
    registerBot(
      tx,
      T2,
      U2,
      { accountId: accounts.t2, dailySendCeiling: null },
      ENV
    )
  );

  expect(t2.outcome).toBe("registered");

  const r1 = await dispatch(T1);
  const r2 = await dispatch(T2);

  expect(r1.endpointsActivated).toBe(3);
  expect(r2.endpointsActivated).toBe(1);

  return { accounts };
}

// ---------------------------------------------------------------------------
// Update builders and the webhook call
// ---------------------------------------------------------------------------

let updateCounter = 1000;

function privateMessage(
  userId: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  updateCounter += 1;

  return {
    update_id: updateCounter,
    message: {
      message_id: updateCounter,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false, first_name: "Siti" },
      text,
      ...extra
    }
  };
}

/**
 * Every webhook call in this suite crosses the SAME boundary `src/middleware.ts`
 * applies to every `/api/` request with a body before any route runs (audit H-1
 * of PR #1260: the route was unreachable in production while handler-level tests
 * stayed green). The middleware itself cannot be imported here (it pulls in the
 * `astro:middleware` virtual module), so its two calls are replayed in its order:
 * `requiresAuthenticatedCallerBeforeBody`, then `refuseUnauthenticatedApiBody`.
 * Telegram sends no session, no cookie and no tenant header.
 */
async function throughMiddlewareBoundary(
  request: Request,
  route: () => Promise<Response>
): Promise<Response> {
  const url = new URL(request.url);

  if (requiresAuthenticatedCallerBeforeBody(request.method, url.pathname)) {
    const refusal = await refuseUnauthenticatedApiBody(
      request,
      { get: () => undefined } as unknown as Parameters<
        typeof refuseUnauthenticatedApiBody
      >[1],
      new Date()
    );

    if (refusal) return refusal;
  }

  return route();
}

async function post(
  token: string | undefined,
  header: string | null,
  body: unknown,
  ip = "198.51.100.7",
  env: NodeJS.ProcessEnv = ENV
) {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (header !== null) headers["x-telegram-bot-api-secret-token"] = header;

  const request = new Request(
    `https://budget.example/api/v1/telegram-engagement/webhooks/${token ?? "x"}`,
    { method: "POST", headers, body: JSON.stringify(body) }
  );
  const response = await throughMiddlewareBoundary(request, () =>
    handleTelegramEngagementWebhook(request, token, ip, {
      getSql: getRuntimeSql,
      env
    })
  );

  return { status: response.status, text: await response.text() };
}

async function webhook(botKey: keyof typeof BOT_IDS, body: unknown) {
  const hook = telegram.webhookFor(BOT_IDS[botKey]);

  return post(hook.token, hook.header, body);
}

async function contactOf(tenantId: string, accountId: string) {
  const rows = (await getAdminSql()`
    SELECT id, state, chat_ciphertext, contact_hash, masked_label
    FROM awcms_telegram_engagement_contacts
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
    ORDER BY created_at
  `) as {
    id: string;
    state: string;
    chat_ciphertext: string | null;
    contact_hash: string;
    masked_label: string | null;
  }[];

  return rows;
}

async function everythingPersisted(): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT to_jsonb(t)::text AS row FROM awcms_telegram_engagement_endpoints t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_telegram_engagement_contacts t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_telegram_engagement_consents t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_telegram_engagement_inbound t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_telegram_engagement_messages t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_audit_events t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_domain_events t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_channel_account_health t
  `) as { row: string }[];

  return rows.map((entry) => entry.row).join("\n");
}

const suite = integrationEnabled ? describe : describe.skip;

suite("telegram_engagement against PostgreSQL (Issue #1156)", () => {
  beforeAll(async () => {
    for (const name of ENV_NAMES) savedEnv[name] = process.env[name];

    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS = CHANNEL_RING;
    process.env.TELEGRAM_ENGAGEMENT_ENABLED = "true";
    process.env.TELEGRAM_ENGAGEMENT_KEYS = ENGAGEMENT_RING;
    await setupIntegrationDatabase();
    dispatchRoleSql = await activateDispatchRole();
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    await dispatchRoleSql?.close({ timeout: 1 });
    await getAdminSql().unsafe(
      `ALTER ROLE ${DISPATCH_ROLE} NOLOGIN PASSWORD NULL`
    );
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    resetRateLimitForTests();
    resetWebhookRejectionsForTests();
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS = CHANNEL_RING;
    telegram = new FakeTelegram();
    await resetDatabase();
    fx = await seedFixture();
  });

  // -------------------------------------------------------------------------
  describe("registration and the connector (T-A1, T-A2)", () => {
    test("each bot gets its own callback token and header; getMe binds the token to the account", async () => {
      const hooks = (["a", "b", "c"] as const).map((key) =>
        telegram.webhookFor(BOT_IDS[key])
      );

      expect(new Set(hooks.map((h) => h.token)).size).toBe(3);
      expect(new Set(hooks.map((h) => h.header)).size).toBe(3);

      for (const hook of hooks) {
        expect(hook.token.startsWith(`tge1.${T1}.`)).toBe(true);
        expect(hook.header).toMatch(/^[A-Za-z0-9_-]{43}$/);
      }

      const setCall = telegram.calls.find((c) => c.method === "setWebhook")!;

      expect(setCall.body.allowed_updates).toEqual([
        "message",
        "my_chat_member",
        "callback_query"
      ]);
      expect(
        String(setCall.body.url).startsWith(
          "https://budget.example/api/v1/telegram-engagement/webhooks/"
        )
      ).toBe(true);

      const accounts = (await getAdminSql()`
        SELECT status FROM awcms_channel_accounts WHERE tenant_id = ${T1}
      `) as { status: string }[];

      expect(accounts.every((row) => row.status === "connected")).toBe(true);
    });

    test("the staff bot is refused, and so is a second registration of the same bot", async () => {
      const staff = await seedBotAccount(T1, U1, STAFF_BOT_ID);
      const refused = await inTenant(T1, (tx) =>
        registerBot(
          tx,
          T1,
          U1,
          { accountId: staff, dailySendCeiling: null },
          ENV
        )
      );

      expect(refused).toEqual({
        outcome: "refused",
        code: "STAFF_BOT_REFUSED"
      });

      const again = await inTenant(T1, (tx) =>
        registerBot(
          tx,
          T1,
          U1,
          { accountId: fx.accounts.a, dailySendCeiling: null },
          ENV
        )
      );

      expect(again).toEqual({ outcome: "refused", code: "ALREADY_REGISTERED" });
    });

    test("a second tenant cannot hold the same bot (the channel account registry refuses it)", async () => {
      await assertRejected(
        seedBotAccount(T2, U2, BOT_IDS.a),
        "the same bot in two tenants"
      );
    });

    test("another tenant's account is not found, never registered", async () => {
      const result = await inTenant(T2, (tx) =>
        registerBot(
          tx,
          T2,
          U2,
          { accountId: fx.accounts.a, dailySendCeiling: null },
          ENV
        )
      );

      expect(result).toEqual({ outcome: "not_found" });
    });

    test("a token that belongs to another bot fails getMe binding and the endpoint never activates", async () => {
      const mismatched = await seedBotAccount(T1, U1, "7000000055");

      // The stored token now names a DIFFERENT bot than the account.
      await inTenant(T1, async (tx) => {
        const rows = (await tx`
          SELECT secret_id FROM awcms_channel_accounts WHERE id = ${mismatched}
        `) as { secret_id: string }[];

        await defaultSecretStore.replace(tx, {
          tenantId: T1,
          secretId: rows[0]!.secret_id,
          purpose: "bot_token",
          plaintext: tokenFor("7000000056")
        });
      });

      await inTenant(T1, (tx) =>
        registerBot(
          tx,
          T1,
          U1,
          { accountId: mismatched, dailySendCeiling: null },
          ENV
        )
      );

      const result = await dispatch(T1);

      expect(result.endpointsFailed).toBe(1);

      const rows = (await getAdminSql()`
        SELECT state, last_error_code FROM awcms_telegram_engagement_endpoints
        WHERE account_id = ${mismatched}
      `) as { state: string; last_error_code: string }[];

      expect(rows[0]).toEqual({
        state: "failed",
        last_error_code: "BOT_IDENTITY_MISMATCH"
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("webhook verification (T-A1, T-W1)", () => {
    test("one generic 401 for every failure, and nothing is stored", async () => {
      const a = telegram.webhookFor(BOT_IDS.a);
      const b = telegram.webhookFor(BOT_IDS.b);
      const t2 = telegram.webhookFor(BOT_IDS.t2);
      const update = privateMessage(501, "/start");
      const [, , t2Endpoint, t2Secret] = t2.token.split(".");
      const cases = [
        await post(a.token, null, update), // header absent
        await post(a.token, "wrong-header-value", update), // header wrong
        await post(a.token, b.header, update), // bot B's header on bot A's route
        await post(`tge1.${T1}.${t2Endpoint}.${t2Secret}`, t2.header, update), // T2's endpoint named under T1
        await post(
          `tge1.${T1}.00000000-0000-4000-8000-000000000000.${"x".repeat(43)}`,
          a.header,
          update
        ),
        await post("not-a-token", a.header, update),
        await post(undefined, a.header, update)
      ];

      for (const result of cases) {
        expect(result.status).toBe(401);
      }

      expect(new Set(cases.map((c) => c.text)).size).toBe(1);

      const receipts = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_telegram_engagement_inbound
      `) as { n: number }[];

      expect(receipts[0]!.n).toBe(0);
    });

    test("the right token and header are accepted, for each bot independently", async () => {
      for (const key of ["a", "b", "c", "t2"] as const) {
        const result = await webhook(key, privateMessage(600, "/start"));

        expect(result.status).toBe(200);
      }

      // The same Telegram user under four bots (two tenants) is four unrelated contacts.
      const hashes = (await getAdminSql()`
        SELECT contact_hash FROM awcms_telegram_engagement_contacts
      `) as { contact_hash: string }[];

      expect(hashes.length).toBe(4);
      expect(new Set(hashes.map((h) => h.contact_hash)).size).toBe(4);
    });

    test("a revoked endpoint answers the same 401", async () => {
      const a = telegram.webhookFor(BOT_IDS.a);

      await inTenant(T1, (tx) => revokeBot(tx, T1, U1, fx.accounts.a));

      const result = await post(
        a.token,
        a.header,
        privateMessage(502, "/start")
      );

      expect(result.status).toBe(401);

      // The connector owes Telegram a deleteWebhook, and does it.
      const run = await dispatch(T1);

      expect(run.webhooksDeleted).toBe(1);
    });

    test("off means 404, with nothing verified", async () => {
      const a = telegram.webhookFor(BOT_IDS.a);
      const request = new Request("https://budget.example/x", {
        method: "POST",
        body: "{}"
      });
      const response = await handleTelegramEngagementWebhook(
        request,
        a.token,
        "198.51.100.7",
        {
          getSql: getRuntimeSql,
          env: { ...ENV, TELEGRAM_ENGAGEMENT_ENABLED: "false" }
        }
      );

      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe("ingestion (T-W2, T-W3)", () => {
    test("a replayed update has one effect, sequentially and concurrently", async () => {
      const update = privateMessage(700, "/start campaign_42");

      expect((await webhook("a", update)).status).toBe(200);
      expect((await webhook("a", update)).status).toBe(200);

      const concurrent = privateMessage(701, "/start");
      const results = await Promise.all([
        webhook("a", concurrent),
        webhook("a", concurrent),
        webhook("a", concurrent)
      ]);

      expect(results.every((r) => r.status === 200)).toBe(true);

      const contacts = await contactOf(T1, fx.accounts.a);

      expect(contacts.length).toBe(2);

      const consents = (await getAdminSql()`
        SELECT purpose, action, method FROM awcms_telegram_engagement_consents
      `) as { purpose: string; action: string; method: string }[];

      expect(consents.length).toBe(2);
      expect(
        consents.every(
          (c) => c.purpose === "support" && c.method === "start_command"
        )
      ).toBe(true);

      const receipts = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_telegram_engagement_inbound
      `) as { n: number }[];

      expect(receipts[0]!.n).toBe(2);

      const provenance = (await getAdminSql()`
        SELECT start_param FROM awcms_telegram_engagement_contacts
        WHERE start_param IS NOT NULL
      `) as { start_param: string }[];

      expect(provenance.map((p) => p.start_param)).toEqual(["campaign_42"]);
    });

    test("forwarded /start, group chats, bot senders, identity mismatch and edits change nothing", async () => {
      const forwarded = privateMessage(800, "/start", {
        forward_origin: { type: "user", sender_user: { id: 999 } }
      });
      const group = privateMessage(801, "/start");
      (group.message.chat as Record<string, unknown>) = {
        id: -100123,
        type: "supergroup"
      };
      const botSender = privateMessage(802, "/start");
      botSender.message.from.is_bot = true;
      const mismatch = privateMessage(803, "/start");
      (mismatch.message.from as Record<string, unknown>).id = 804;
      updateCounter += 1;
      const edited = {
        update_id: updateCounter,
        edited_message: {
          chat: { id: 805, type: "private" },
          from: { id: 805, is_bot: false },
          text: "/start"
        }
      };

      for (const update of [forwarded, group, botSender, mismatch, edited]) {
        expect((await webhook("a", update)).status).toBe(200);
      }

      expect((await contactOf(T1, fx.accounts.a)).length).toBe(0);

      const consents = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_telegram_engagement_consents
      `) as { n: number }[];

      expect(consents[0]!.n).toBe(0);
    });

    test("a message from someone who never started the bot creates nothing (T-N2)", async () => {
      expect((await webhook("a", privateMessage(900, "hello"))).status).toBe(
        200
      );
      expect((await contactOf(T1, fx.accounts.a)).length).toBe(0);
    });

    test("an account without the inbound capability receipts the update and does nothing else", async () => {
      await getAdminSql()`
        UPDATE awcms_channel_account_capabilities SET state = 'denied',
          evidence_kind = NULL, evidence_ref = NULL, verified_at = NULL
        WHERE account_id = ${fx.accounts.b} AND capability = 'inbound'
      `;

      expect((await webhook("b", privateMessage(901, "/start"))).status).toBe(
        200
      );
      expect((await contactOf(T1, fx.accounts.b)).length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("consent and outbound (T-C1, T-N2, T-R1)", () => {
    async function startedContact(userId = 1001): Promise<string> {
      await webhook("a", privateMessage(userId, "/start"));

      const rows = await contactOf(T1, fx.accounts.a);

      return rows[rows.length - 1]!.id;
    }

    test("/start grants support only; marketing needs the explicit button on OUR prompt", async () => {
      const contactId = await startedContact();
      const marketing = await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "marketing", text: "Promo!" },
          ring()
        )
      );

      expect(marketing).toEqual({
        outcome: "refused",
        code: "CONSENT_REQUIRED"
      });

      const prompt = await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          {
            kind: "consent_prompt",
            promptPurpose: "marketing",
            noticeVersion: "mkt-v1",
            noticeText: "Boleh kami kirim promo?"
          },
          ring()
        )
      );

      expect(prompt.outcome).toBe("queued");
      expect((await dispatch(T1)).sent).toBe(1);

      const sent = telegram.sends()[0]!;
      const keyboard = (
        sent.body.reply_markup as {
          inline_keyboard: { callback_data: string }[][];
        }
      ).inline_keyboard[0]!;

      expect(keyboard.map((k) => k.callback_data)).toEqual([
        "tgc1:marketing:mkt-v1",
        "tgw1:marketing:mkt-v1"
      ]);

      const promptMessageId = telegram.nextMessageId;
      const button = (messageId: number, data: string) => {
        updateCounter += 1;

        return {
          update_id: updateCounter,
          callback_query: {
            id: `cbq${updateCounter}`,
            from: { id: 1001, is_bot: false },
            message: {
              message_id: messageId,
              chat: { id: 1001, type: "private" }
            },
            data
          }
        };
      };

      // A forged press: a message we never sent, then a version we never asked.
      expect(
        (
          await webhook(
            "a",
            button(promptMessageId + 50, "tgc1:marketing:mkt-v1")
          )
        ).status
      ).toBe(200);
      expect(
        (await webhook("a", button(promptMessageId, "tgc1:marketing:mkt-v9")))
          .status
      ).toBe(200);
      expect(
        (
          await webhook(
            "a",
            button(promptMessageId, "tgc1:transactional:mkt-v1")
          )
        ).status
      ).toBe(200);

      const stillRefused = await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "marketing", text: "Promo!" },
          ring()
        )
      );

      expect(stillRefused).toEqual({
        outcome: "refused",
        code: "CONSENT_REQUIRED"
      });

      const pressed = await webhook(
        "a",
        button(promptMessageId, "tgc1:marketing:mkt-v1")
      );

      expect(pressed.status).toBe(200);
      expect(JSON.parse(pressed.text).method).toBe("answerCallbackQuery");

      const allowed = await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "marketing", text: "Promo!" },
          ring()
        )
      );

      expect(allowed.outcome).toBe("queued");

      const evidence = (await getAdminSql()`
        SELECT purpose, action, method, notice_version FROM awcms_telegram_engagement_consents
        WHERE contact_id = ${contactId} ORDER BY recorded_at, id
      `) as Record<string, string>[];

      expect(evidence).toContainEqual({
        purpose: "marketing",
        action: "opt_in",
        method: "consent_button",
        notice_version: "mkt-v1"
      });
    });

    test("/stop withdraws at once: queued rows are cancelled and a re-queue is refused", async () => {
      const contactId = await startedContact();
      const queued = await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "support", text: "Halo" },
          ring()
        )
      );

      expect(queued.outcome).toBe("queued");
      await webhook("a", privateMessage(1001, "/stop"));

      const row = (await getAdminSql()`
        SELECT status, failure_code, text_ciphertext FROM awcms_telegram_engagement_messages
      `) as {
        status: string;
        failure_code: string;
        text_ciphertext: string | null;
      }[];

      expect(row[0]).toEqual({
        status: "cancelled",
        failure_code: "CONSENT_WITHDRAWN",
        text_ciphertext: null
      });

      const again = await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "support", text: "Halo" },
          ring()
        )
      );

      expect(again).toEqual({
        outcome: "refused",
        code: "CONTACT_NOT_STARTED"
      });
      expect((await dispatch(T1)).sent).toBe(0);
    });

    test("a consent revoked AFTER enqueue blocks the row at dispatch", async () => {
      const contactId = await startedContact();

      await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "support", text: "Halo" },
          ring()
        )
      );
      // A withdrawal recorded directly (as a concurrent request would), with the
      // row still queued: the dispatcher must re-check the LATEST evidence.
      await getAdminSql()`
        INSERT INTO awcms_telegram_engagement_consents
          (tenant_id, contact_id, purpose, action, method, occurred_at)
        VALUES (${T1}, ${contactId}, 'support', 'opt_out', 'operator_withdrawal', now())
      `;

      const result = await dispatch(T1);

      expect(result.sent).toBe(0);
      expect(result.cancelled).toBe(1);
      expect(telegram.sends().length).toBe(0);
    });

    test("a provider 403 blocks the contact, withdraws everything and is never retried", async () => {
      const contactId = await startedContact();

      await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "support", text: "Halo" },
          ring()
        )
      );
      telegram.scripted.sendMessage = [
        {
          kind: "error",
          httpStatus: 403,
          errorCode: 403,
          retryAfterSeconds: null,
          description: "Forbidden: bot was blocked by the user"
        }
      ];

      expect((await dispatch(T1)).failed).toBe(1);

      const contact = await inTenant(T1, (tx) =>
        fetchContact(tx, T1, contactId)
      );

      expect(contact!.state).toBe("blocked");

      const detail = await inTenant(T1, (tx) =>
        contactDetail(tx, T1, contact!)
      );

      expect(detail.eligibility.support.eligible).toBe(false);
    });

    test("429 retry_after re-queues without spending budget; an uncertain send is not retried", async () => {
      const contactId = await startedContact();

      await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "support", text: "One" },
          ring()
        )
      );
      telegram.scripted.sendMessage = [
        {
          kind: "error",
          httpStatus: 429,
          errorCode: 429,
          retryAfterSeconds: 7,
          description: "Too Many Requests"
        }
      ];

      const first = await dispatch(T1);

      expect(first.retried).toBe(1);

      const after429 = (await getAdminSql()`
        SELECT status, attempts, next_attempt_at > now() + interval '5 seconds' AS later
        FROM awcms_telegram_engagement_messages
      `) as { status: string; attempts: number; later: boolean }[];

      expect(after429[0]).toEqual({
        status: "queued",
        attempts: 0,
        later: true
      });

      await getAdminSql()`UPDATE awcms_telegram_engagement_messages SET next_attempt_at = now()`;
      telegram.scripted.sendMessage = [
        { kind: "uncertain", reason: "REQUEST_FAILED" }
      ];

      expect((await dispatch(T1)).uncertain).toBe(1);
      expect((await dispatch(T1)).claimed).toBe(0);
      expect(telegram.sends().length).toBe(2);
    });

    test("a lease that expired mid-send (crash) becomes uncertain, never a blind resend", async () => {
      const contactId = await startedContact();

      await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "support", text: "One" },
          ring()
        )
      );
      await getAdminSql()`
        UPDATE awcms_telegram_engagement_messages
        SET status = 'sending', lease_until = now() - interval '1 minute',
            lease_token = gen_random_uuid(), attempts = 1
      `;

      const result = await dispatch(T1);

      expect(result.uncertain).toBe(1);
      expect(telegram.sends().length).toBe(0);
    });

    test("the per-bot daily ceiling defers the rest to tomorrow", async () => {
      await getAdminSql()`
        UPDATE awcms_telegram_engagement_endpoints SET daily_send_ceiling = 1
        WHERE account_id = ${fx.accounts.a}
      `;

      const contactId = await startedContact();

      for (const text of ["one", "two"]) {
        await inTenant(T1, (tx) =>
          enqueueMessage(
            tx,
            T1,
            U1,
            contactId,
            { kind: "text", purpose: "support", text },
            ring()
          )
        );
      }

      const result = await dispatch(T1);

      expect(result.sent).toBe(1);
      expect(result.deferred).toBe(1);
    });

    test("there is no way to address an id that is not a contact (T-N2)", async () => {
      const result = await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          crypto.randomUUID(),
          { kind: "text", purpose: "support", text: "x" },
          ring()
        )
      );

      expect(result).toEqual({ outcome: "not_found" });
    });
  });

  // -------------------------------------------------------------------------
  describe("rotation, secrets and tenancy (T-K1, T-I1)", () => {
    test("rotation: the old callback and header die at once; the new ones work after setWebhook", async () => {
      const old = telegram.webhookFor(BOT_IDS.a);

      await inTenant(T1, (tx) => rotateBot(tx, T1, U1, fx.accounts.a));

      expect(
        (await post(old.token, old.header, privateMessage(1100, "/start")))
          .status
      ).toBe(401);
      expect((await dispatch(T1)).endpointsActivated).toBe(1);

      const fresh = telegram.webhookFor(BOT_IDS.a);

      expect(fresh.token).not.toBe(old.token);
      expect(fresh.header).not.toBe(old.header);
      expect(
        (await post(fresh.token, fresh.header, privateMessage(1101, "/start")))
          .status
      ).toBe(200);
      expect(
        (await post(fresh.token, old.header, privateMessage(1102, "/start")))
          .status
      ).toBe(401);

      const secrets = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_channel_secrets
        WHERE purpose = 'webhook_signing_secret' AND tenant_id = ${T1}
      `) as { n: number }[];

      // One live seed per live endpoint: the rotated-out seed is hard-deleted.
      expect(secrets[0]!.n).toBe(3);
    });

    test("no token, seed-derived value, chat id or message text is persisted anywhere", async () => {
      const contactUser = 4242424242;

      await webhook("a", privateMessage(contactUser, "/start"));

      const [contact] = await contactOf(T1, fx.accounts.a);

      await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contact!.id,
          { kind: "text", purpose: "support", text: "SECRET-TEXT-CANARY" },
          ring()
        )
      );
      // A provider error that echoes the token must not leak it either.
      telegram.scripted.sendMessage = [
        {
          kind: "error",
          httpStatus: 500,
          errorCode: 500,
          retryAfterSeconds: null,
          description: `boom ${tokenFor(BOT_IDS.a)}`
        }
      ];
      await dispatch(T1);

      const everything = await everythingPersisted();
      const hook = telegram.webhookFor(BOT_IDS.a);

      expect(everything).not.toContain(tokenFor(BOT_IDS.a).split(":")[1]!);
      expect(everything).not.toContain(hook.header);
      expect(everything).not.toContain(hook.token.split(".")[3]!);
      expect(everything).not.toContain(String(contactUser));
      expect(everything).not.toContain("SECRET-TEXT-CANARY");
    });

    test("another tenant cannot see a contact or a bot (RLS FORCE)", async () => {
      await webhook("a", privateMessage(1200, "/start"));

      const [contact] = await contactOf(T1, fx.accounts.a);
      const fromT2 = await inTenant(T2, (tx) =>
        fetchContact(tx, T2, contact!.id)
      );

      expect(fromT2).toBeNull();

      const enqueueFromT2 = await inTenant(T2, (tx) =>
        enqueueMessage(
          tx,
          T2,
          U2,
          contact!.id,
          { kind: "text", purpose: "support", text: "x" },
          ring()
        )
      );

      expect(enqueueFromT2).toEqual({ outcome: "not_found" });

      const rotateFromT2 = await inTenant(T2, (tx) =>
        rotateBot(tx, T2, U2, fx.accounts.a)
      );

      expect(rotateFromT2).toEqual({ outcome: "not_found" });

      const forced = (await getAdminSql()`
        SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname LIKE 'awcms_telegram_engagement_%' AND relkind = 'r'
        ORDER BY relname
      `) as {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }[];

      expect(forced.length).toBe(5);
      expect(
        forced.every((row) => row.relrowsecurity && row.relforcerowsecurity)
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("erasure and integrity (T-D1)", () => {
    test("ending a contact erases what identifies the person and keeps the evidence", async () => {
      await webhook("a", privateMessage(1300, "/start"));

      const [contact] = await contactOf(T1, fx.accounts.a);
      const result = await inTenant(T1, (tx) =>
        endContact(tx, T1, contact!.id, U1, null)
      );

      expect(result.outcome).toBe("ended");

      const [ended] = await contactOf(T1, fx.accounts.a);

      expect(ended!.state).toBe("ended");
      expect(ended!.chat_ciphertext).toBeNull();
      expect(ended!.masked_label).toBeNull();
      expect(ended!.contact_hash).not.toBe(contact!.contact_hash);

      const evidence = (await getAdminSql()`
        SELECT action FROM awcms_telegram_engagement_consents WHERE contact_id = ${contact!.id}
      `) as { action: string }[];

      expect(evidence.map((e) => e.action).sort()).toEqual([
        "opt_in",
        "opt_out"
      ]);

      // The same person returning is a new, unrelated contact.
      await webhook("a", privateMessage(1300, "/start"));
      expect((await contactOf(T1, fx.accounts.a)).length).toBe(2);
    });

    test("the database refuses what the application never does", async () => {
      await webhook("a", privateMessage(1400, "/start"));

      const [contact] = await contactOf(T1, fx.accounts.a);
      const admin = getAdminSql();

      await assertRejected(
        admin`
          INSERT INTO awcms_telegram_engagement_consents
            (tenant_id, contact_id, purpose, action, method, occurred_at)
          VALUES (${T1}, ${contact!.id}, 'marketing', 'opt_in', 'start_command', now())
        `,
        "/start as marketing consent"
      );
      await assertRejected(
        admin`
          INSERT INTO awcms_telegram_engagement_consents
            (tenant_id, contact_id, purpose, action, method, occurred_at)
          VALUES (${T1}, ${contact!.id}, 'marketing', 'opt_in', 'operator_withdrawal', now())
        `,
        "a marketing opt-in without the button"
      );
      await assertRejected(
        admin`
          UPDATE awcms_telegram_engagement_contacts SET contact_hash = ${"e:" + "0".repeat(64)}
          WHERE id = ${contact!.id}
        `,
        "changing a live contact's key"
      );
      await assertRejected(
        admin`
          UPDATE awcms_telegram_engagement_endpoints SET callback_hash = ${"sha256:" + "0".repeat(64)}
          WHERE account_id = ${fx.accounts.a}
        `,
        "changing an endpoint's callback hash"
      );
      await assertRejected(
        getRuntimeSql().begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${T1}, true)`;
          await tx`UPDATE awcms_telegram_engagement_consents SET action = 'opt_out'`;
        }),
        "rewriting consent evidence as the application role"
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("audit remediation of PR #1260", () => {
    /** A plain transaction as the dispatcher role: a refused statement must not go through withTenantOrThrow (it trips the breaker). */
    async function asDispatchRole<T>(
      tenantId: string,
      work: (tx: Bun.TransactionSQL) => Promise<T>
    ): Promise<T> {
      return dispatchRoleSql!.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        return work(tx);
      }) as Promise<T>;
    }

    async function putSecret(
      tenantId: string,
      purpose:
        "api_token" | "device_key" | "provider_access_token" | "bot_token",
      plaintext: string
    ): Promise<string> {
      return inTenant(tenantId, async (tx) => {
        const ref = await defaultSecretStore.put(tx, {
          tenantId,
          purpose,
          plaintext,
          createdBy: null
        });

        return ref.secretId;
      });
    }

    test("H-1: Telegram's request passes the middleware boundary with no session and reaches the route", async () => {
      const hook = telegram.webhookFor(BOT_IDS.a);
      const path = `/api/v1/telegram-engagement/webhooks/${hook.token}`;

      expect(requiresAuthenticatedCallerBeforeBody("POST", path)).toBe(false);
      expect((await webhook("a", privateMessage(5001, "/start"))).status).toBe(
        200
      );
      expect((await contactOf(T1, fx.accounts.a)).length).toBe(1);
    });

    test("H-2: the dispatcher role sees only live customer bot tokens and seeds of ITS tenant", async () => {
      // Other secrets of the same tenant: WhatsApp, Mailketing, social, and a
      // telegram bot with no endpoint.
      const others = [
        await putSecret(T1, "api_token", "whatsapp-or-mailketing-canary"),
        await putSecret(T1, "device_key", "starsender-canary"),
        await putSecret(T1, "provider_access_token", "social-canary"),
        await putSecret(T1, "bot_token", tokenFor("7000000077"))
      ];

      await seedBotAccount(T1, U1, "7000000078"); // a bot with NO endpoint

      const visible = async (tenantId: string) =>
        asDispatchRole(
          tenantId,
          async (tx) =>
            (await tx`
            SELECT id, purpose FROM awcms_channel_secrets ORDER BY purpose, id
          `) as { id: string; purpose: string }[]
        );
      const t1 = await visible(T1);

      expect(t1.filter((row) => row.purpose === "bot_token").length).toBe(3);
      expect(
        t1.filter((row) => row.purpose === "webhook_signing_secret").length
      ).toBe(3);
      expect(t1.length).toBe(6);
      expect(t1.some((row) => others.includes(row.id))).toBe(false);

      // The other tenant's view is its own bot only, never T1's.
      const t2 = await visible(T2);

      expect(t2.length).toBe(2);
      expect(t2.some((row) => t1.some((other) => other.id === row.id))).toBe(
        false
      );

      // A revoked bot keeps its token visible only while deleteWebhook is owed.
      await inTenant(T1, (tx) => revokeBot(tx, T1, U1, fx.accounts.b));
      expect((await visible(T1)).length).toBe(5); // b's seed is gone, b's token stays
      expect((await dispatch(T1)).webhooksDeleted).toBe(1);
      expect((await visible(T1)).length).toBe(4); // and now the token too

      // A disabled account's credentials vanish from the role at once.
      await getAdminSql()`
        UPDATE awcms_channel_accounts SET status = 'disabled' WHERE id = ${fx.accounts.c}
      `;
      expect((await visible(T1)).length).toBe(2);
    });

    test("H-2: the dispatcher role cannot read or write anything outside its pinned columns", async () => {
      const refusals: [string, (tx: Bun.TransactionSQL) => Promise<unknown>][] =
        [
          [
            "every column of the secrets",
            (tx) => tx`SELECT * FROM awcms_channel_secrets`
          ],
          [
            "the contact hash",
            (tx) =>
              tx`SELECT contact_hash FROM awcms_telegram_engagement_contacts`
          ],
          [
            "the endpoint callback hash",
            (tx) =>
              tx`SELECT callback_hash FROM awcms_telegram_engagement_endpoints`
          ],
          [
            "the inbound ledger",
            (tx) => tx`SELECT id FROM awcms_telegram_engagement_inbound`
          ],
          [
            "a WhatsApp table",
            (tx) => tx`SELECT id FROM awcms_whatsapp_messages`
          ],
          [
            "the staff Telegram bindings",
            (tx) => tx`SELECT id FROM awcms_telegram_bindings`
          ],
          [
            "writing a secret",
            (tx) =>
              tx`INSERT INTO awcms_channel_secrets (tenant_id, purpose, ciphertext, key_id) VALUES (${T1}, 'bot_token', 'v2:k1:a:b:c', 'k1')`
          ],
          [
            "deleting a message",
            (tx) => tx`DELETE FROM awcms_telegram_engagement_messages`
          ],
          [
            "rewriting consent",
            (tx) =>
              tx`UPDATE awcms_telegram_engagement_consents SET action = 'opt_in'`
          ]
        ];

      for (const [what, run] of refusals) {
        await assertRejected(asDispatchRole(T1, run), what);
      }
    });

    test("H-A / L-A: the job proves it is the dispatch role before doing anything", async () => {
      await assertConnectedAsDispatchRole(dispatchRoleSql!);
      await assertRejected(
        assertConnectedAsDispatchRole(getRuntimeSql()),
        "running the dispatcher on the app login"
      );
    });

    test("M-B: the role cannot widen its own view or write outside the dispatcher's transitions", async () => {
      const whatsapp = await inTenant(T1, async (tx) => {
        const rows = (await tx`
          INSERT INTO awcms_channel_accounts
            (tenant_id, provider, account_kind, external_id, display_name, auth_mode, status)
          VALUES (${T1}, 'whatsapp_cloud', 'phone_number', 'wa-probe', 'WA', 'api_token', 'disabled')
          RETURNING id
        `) as { id: string }[];

        return rows[0]!.id;
      });

      await getAdminSql()`
        UPDATE awcms_channel_accounts SET status = 'disabled' WHERE id = ${fx.accounts.c}
      `;
      await inTenant(T1, (tx) => revokeBot(tx, T1, U1, fx.accounts.b));
      expect((await dispatch(T1)).webhooksDeleted).toBe(1);

      await webhook("a", privateMessage(9100, "/start"));
      await webhook("a", privateMessage(9100, "/stop"));

      const contactId = (await contactOf(T1, fx.accounts.a))[0]!.id;
      const revokedEndpoint = (
        (await getAdminSql()`
          SELECT id FROM awcms_telegram_engagement_endpoints
          WHERE account_id = ${fx.accounts.b} AND state = 'revoked'
        `) as { id: string }[]
      )[0]!.id;
      const unaffected = async (
        what: string,
        run: (tx: Bun.TransactionSQL) => Promise<unknown[]>
      ) => {
        const rows = await asDispatchRole(T1, run);

        expect(rows.length, what).toBe(0);
      };

      await unaffected(
        "re-enable a disabled bot",
        (tx) => tx`
        UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${fx.accounts.c} RETURNING id
      `
      );
      await unaffected(
        "re-enable a WhatsApp account",
        (tx) => tx`
        UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${whatsapp} RETURNING id
      `
      );
      await unaffected(
        "un-stop a contact",
        (tx) => tx`
        UPDATE awcms_telegram_engagement_contacts SET state = 'started' WHERE id = ${contactId} RETURNING id
      `
      );
      await assertRejected(
        asDispatchRole(
          T1,
          (tx) => tx`
          UPDATE awcms_telegram_engagement_endpoints SET provider_action = 'delete'
          WHERE id = ${revokedEndpoint}
        `
        ),
        "re-arming a revoked endpoint"
      );
      await assertRejected(
        asDispatchRole(
          T1,
          (tx) => tx`
          INSERT INTO awcms_telegram_engagement_consents
            (tenant_id, contact_id, purpose, action, notice_version, method, occurred_at)
          VALUES (${T1}, ${contactId}, 'marketing', 'opt_in', 'v1', 'consent_button', now())
        `
        ),
        "forging an opt-in"
      );
      await assertRejected(
        asDispatchRole(
          T1,
          (tx) => tx`
          INSERT INTO awcms_domain_events
            (tenant_id, event_type, event_version, aggregate_type, aggregate_id,
             order_key, producer_module, payload, occurred_at)
          VALUES (${T1}, 'awcms.identity_access.role.assigned', '1.0', 'role',
                  ${crypto.randomUUID()}, 'x', 'identity_access', '{}'::jsonb, now())
        `
        ),
        "forging another module's event"
      );

      // The secret view did not widen.
      const view = await asDispatchRole(
        T1,
        async (tx) =>
          (await tx`SELECT id FROM awcms_channel_secrets`) as unknown[]
      );

      expect(view.length).toBe(2);
    });

    test("M-1: a /stop whose transaction STARTED before a concurrent opt-in committed still wins", async () => {
      expect((await webhook("a", privateMessage(6001, "/start"))).status).toBe(
        200
      );

      const contactId = (await contactOf(T1, fx.accounts.a))[0]!.id;

      await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          {
            kind: "consent_prompt",
            promptPurpose: "marketing",
            noticeVersion: "mkt-v1",
            noticeText: "Promo?"
          },
          ring()
        )
      );
      expect((await dispatch(T1)).sent).toBe(1);

      const promptMessageId = telegram.nextMessageId;

      updateCounter += 1;

      const press = {
        update_id: updateCounter,
        callback_query: {
          id: `cbq${updateCounter}`,
          from: { id: 6001, is_bot: false },
          message: {
            message_id: promptMessageId,
            chat: { id: 6001, type: "private" }
          },
          data: "tgc1:marketing:mkt-v1"
        }
      };
      const hook = telegram.webhookFor(BOT_IDS.a);
      const runtime = getRuntimeSql();
      let begins = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let started!: () => void;
      const stopStarted = new Promise<void>((resolve) => (started = resolve));
      // The /stop's INGEST transaction (its second `begin`, after verification)
      // starts, takes its now(), then waits while the opt-in press commits.
      const gated = new Proxy(runtime as object, {
        get(target, prop) {
          if (prop === "begin") {
            return (fn: (tx: Bun.TransactionSQL) => Promise<unknown>) =>
              (target as Bun.SQL).begin(async (tx) => {
                begins += 1;

                if (begins === 2) {
                  await tx`SELECT 1`;
                  started();
                  await gate;
                }

                return fn(tx);
              });
          }

          const value = Reflect.get(target, prop);

          return typeof value === "function" ? value.bind(target) : value;
        }
      }) as Bun.SQL;
      const stopRequest = new Request("https://budget.example/x", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": hook.header
        },
        body: JSON.stringify(privateMessage(6001, "/stop"))
      });
      const stopping = handleTelegramEngagementWebhook(
        stopRequest,
        hook.token,
        "198.51.100.7",
        {
          getSql: () => gated,
          env: ENV
        }
      );

      await stopStarted;
      expect((await webhook("a", press)).status).toBe(200);
      release();
      expect((await stopping).status).toBe(200);

      // The withdrawal committed LAST, so it is the latest fact.
      const latest = (await getAdminSql()`
        SELECT action, method FROM awcms_telegram_engagement_consents
        WHERE contact_id = ${contactId} AND purpose = 'marketing'
        ORDER BY evidence_seq DESC LIMIT 1
      `) as { action: string; method: string }[];

      expect(latest[0]).toEqual({ action: "opt_out", method: "stop_command" });

      // Starting again restores support only; marketing stays withdrawn.
      expect((await webhook("a", privateMessage(6001, "/start"))).status).toBe(
        200
      );

      const promo = await inTenant(T1, (tx) =>
        enqueueMessage(
          tx,
          T1,
          U1,
          contactId,
          { kind: "text", purpose: "marketing", text: "Promo!" },
          ring()
        )
      );

      expect(promo).toEqual({ outcome: "refused", code: "CONSENT_WITHDRAWN" });
    });

    test("M-2: an over-limit chat still gets its /stop and its block recorded", async () => {
      expect((await webhook("a", privateMessage(7001, "/start"))).status).toBe(
        200
      );

      for (let index = 0; index < 35; index += 1) {
        await webhook("a", privateMessage(7001, `hello ${index}`));
      }

      expect((await webhook("a", privateMessage(7001, "/stop"))).status).toBe(
        200
      );
      expect((await contactOf(T1, fx.accounts.a))[0]!.state).toBe("stopped");

      updateCounter += 1;
      await webhook("a", {
        update_id: updateCounter,
        my_chat_member: {
          chat: { id: 7001, type: "private" },
          from: { id: 7001, is_bot: false },
          date: Math.floor(Date.now() / 1000),
          new_chat_member: { status: "kicked" }
        }
      });
      expect((await contactOf(T1, fx.accounts.a))[0]!.state).toBe("blocked");
    });

    test("M-3: verified requests never spend the per-address budget; failures do", async () => {
      const env = { ...ENV, TELEGRAM_ENGAGEMENT_WEBHOOK_RATE_PER_MINUTE: "5" };
      const hook = telegram.webhookFor(BOT_IDS.a);
      const other = telegram.webhookFor(BOT_IDS.t2);
      const ip = "203.0.113.9";

      // One tenant's busy bot from Telegram's shared address...
      for (let index = 0; index < 12; index += 1) {
        expect(
          (
            await post(
              hook.token,
              hook.header,
              privateMessage(8001, `m${index}`),
              ip,
              env
            )
          ).status
        ).toBe(200);
      }

      // ...does not throttle another tenant's bot from the same address.
      expect(
        (
          await post(
            other.token,
            other.header,
            privateMessage(8002, "/start"),
            ip,
            env
          )
        ).status
      ).toBe(200);

      // Failures are what the budget counts.
      const failures: number[] = [];

      for (let index = 0; index < 7; index += 1) {
        failures.push(
          (await post(hook.token, "wrong", privateMessage(8003, "x"), ip, env))
            .status
        );
      }

      expect(failures.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(failures.slice(5)).toEqual([429, 429]);
    });

    test("L-3: rotation re-checks the account (a disabled bot is not re-registered)", async () => {
      await getAdminSql()`
        UPDATE awcms_channel_accounts SET status = 'disabled' WHERE id = ${fx.accounts.a}
      `;

      const result = await inTenant(T1, (tx) =>
        rotateBot(tx, T1, U1, fx.accounts.a, ENV)
      );

      expect(result).toEqual({
        outcome: "refused",
        code: "ACCOUNT_NOT_USABLE"
      });
    });
  });
});
