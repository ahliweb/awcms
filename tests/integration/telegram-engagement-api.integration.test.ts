/**
 * The administrator surface of `telegram_engagement`, driven through the REAL
 * route handlers against a real PostgreSQL (Issue #1156, ADR-0152) — WORLD 2 of
 * the harness.
 *
 * What this proves that the service-level suite cannot:
 *
 *   * default-deny: no token is 401 and a user with no role is 403 on every
 *     route; every guard BITES (a user holding every permission but one is
 *     refused that action), which also proves each guard names a permission
 *     the migration really seeded;
 *   * the owner, who holds the seeded catalogue, is allowed, and registration
 *     through the route returns no token, secret or URL;
 *   * an unknown or foreign contact id is the same 404 (T-I1) and a body naming
 *     a chat id is a 400 (T-N2);
 *   * off means 404 on every route.
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
import { randomBytes } from "node:crypto";

import {
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { defaultSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { telegramEngagementModule } from "../../src/modules/telegram-engagement/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import {
  GET as listBots,
  POST as registerBot
} from "../../src/pages/api/v1/telegram-engagement/bots/index";
import { POST as rotateBot } from "../../src/pages/api/v1/telegram-engagement/bots/[id]/rotate";
import { POST as revokeBot } from "../../src/pages/api/v1/telegram-engagement/bots/[id]/revoke";
import { GET as listContacts } from "../../src/pages/api/v1/telegram-engagement/contacts/index";
import { GET as getContact } from "../../src/pages/api/v1/telegram-engagement/contacts/[id]/index";
import { POST as eraseContact } from "../../src/pages/api/v1/telegram-engagement/contacts/[id]/erase";
import { POST as queueMessage } from "../../src/pages/api/v1/telegram-engagement/contacts/[id]/messages";
import { POST as queuePrompt } from "../../src/pages/api/v1/telegram-engagement/contacts/[id]/consent-prompts";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const BASE = "/api/v1/telegram-engagement";
const BOT_ID = "7100000001";
const BOT_TOKEN = `${BOT_ID}:AAHapiTestTokenSecretPart_0123456789`;
const RINGS: Record<string, string> = {
  CHANNEL_ACCOUNTS_ENABLED: "true",
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * 5 + 2) % 251)
  ).toString("base64")}`,
  TELEGRAM_ENGAGEMENT_ENABLED: "true",
  TELEGRAM_ENGAGEMENT_KEYS: `t1:${Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * 19 + 7) % 251)
  ).toString("base64")}`
};

type Env = { tenantId: string; token: string; accountId: string };
type Envelope<T = any> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};

let env: Env;
let userCounter = 0;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "tge-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "TGE Co",
      tenantCode: "tge-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
  const login = await invoke<{ data: { token: string } }>(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier, password: OWNER_PASSWORD },
    cookies: createCookieJar()
  });

  expect(login.status).toBe(200);

  const accountId = await withTenantOrThrow(
    getHandlerDatabaseClient(),
    tenantId,
    async (tx) => {
      const secret = await defaultSecretStore.put(tx, {
        tenantId,
        purpose: "bot_token",
        plaintext: BOT_TOKEN,
        createdBy: null
      });
      const rows = (await tx`
        INSERT INTO awcms_channel_accounts
          (tenant_id, provider, account_kind, external_id, display_name,
           auth_mode, secret_id, status)
        VALUES (${tenantId}, 'telegram', 'bot', ${BOT_ID}, 'Support bot',
                'bot_token', ${secret.secretId}, 'pending')
        RETURNING id
      `) as { id: string }[];

      return rows[0]!.id;
    }
  );

  return { tenantId, token: login.body.data.token, accountId };
}

/** A person with exactly `permissionKeys`. */
async function seedUser(permissionKeys: readonly string[]): Promise<string> {
  userCounter += 1;
  const sql = admin();
  const tenantId = env.tenantId;
  const tag = `tge-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level, last_authenticated_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
    `) as { id: string }[];

    for (const key of permissionKeys) {
      const [moduleKey, activityCode, action] = key.split(".");
      const permission = (await sql`
        SELECT id FROM awcms_permissions
        WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
          AND action = ${action!}
      `) as { id: string }[];

      if (!permission[0]) {
        throw new Error(`fixture: permission ${key} is not in the catalogue`);
      }

      await sql`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${tenantId}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
      grantRolePolicy(tx, tenantId, {
        tenantUserId: tenantUser[0]!.id,
        roleId: role[0]!.id,
        grantedByTenantUserId: null,
        reason: "telegram engagement fixture"
      })
    );
  }

  return token;
}

const ALL_PERMISSIONS = (telegramEngagementModule.permissions ?? []).map(
  (permission) =>
    `telegram_engagement.${permission.activityCode}.${permission.action}`
);

function call<T = any>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string | null;
    idempotencyKey?: string | null;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? `idem-${crypto.randomUUID()}`
      : options.idempotencyKey;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": env.tenantId
  };

  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.path,
    headers,
    body: options.body,
    params: options.params
  });
}

const UNKNOWN = "00000000-0000-4000-8000-000000000001";

function everyRoute(token: string | null) {
  const id = env.accountId;

  return [
    call(listBots, { path: `${BASE}/bots`, token }),
    call(registerBot, {
      method: "POST",
      path: `${BASE}/bots`,
      token,
      body: { accountId: id }
    }),
    call(rotateBot, {
      method: "POST",
      path: `${BASE}/bots/${id}/rotate`,
      params: { id },
      token,
      body: {}
    }),
    call(revokeBot, {
      method: "POST",
      path: `${BASE}/bots/${id}/revoke`,
      params: { id },
      token,
      body: {}
    }),
    call(listContacts, { path: `${BASE}/contacts?accountId=${id}`, token }),
    call(getContact, {
      path: `${BASE}/contacts/${UNKNOWN}`,
      params: { id: UNKNOWN },
      token
    }),
    call(eraseContact, {
      method: "POST",
      path: `${BASE}/contacts/${UNKNOWN}/erase`,
      params: { id: UNKNOWN },
      token,
      body: {}
    }),
    call(queueMessage, {
      method: "POST",
      path: `${BASE}/contacts/${UNKNOWN}/messages`,
      params: { id: UNKNOWN },
      token,
      body: { purpose: "support", text: "hi" }
    }),
    call(queuePrompt, {
      method: "POST",
      path: `${BASE}/contacts/${UNKNOWN}/consent-prompts`,
      params: { id: UNKNOWN },
      token,
      body: { purpose: "marketing", noticeVersion: "v1", noticeText: "ok?" }
    })
  ];
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("telegram_engagement HTTP surface (Issue #1156)", () => {
  beforeAll(async () => {
    for (const name of Object.keys(RINGS)) savedEnv[name] = process.env[name];

    Object.assign(process.env, RINGS);
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    Object.assign(process.env, RINGS);
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  test("default-deny: no token is 401, no role is 403, on every route", async () => {
    if (!handlerReady) return;

    for (const result of await Promise.all(everyRoute(null))) {
      expect(result.status).toBe(401);
    }

    const noRole = await seedUser([]);

    for (const result of await Promise.all(everyRoute(noRole))) {
      expect(result.status).toBe(403);
    }

    const endpoints = (await admin()`
      SELECT count(*)::int AS n FROM awcms_telegram_engagement_endpoints
    `) as { n: number }[];

    expect(endpoints[0]!.n).toBe(0);
  });

  test("every guard bites: all permissions but one refuses exactly that action", async () => {
    if (!handlerReady) return;

    const guarded: [string, (token: string) => Promise<{ status: number }>][] =
      [
        [
          "telegram_engagement.bots.read",
          (t) => call(listBots, { path: `${BASE}/bots`, token: t })
        ],
        [
          "telegram_engagement.bots.configure",
          (t) =>
            call(registerBot, {
              method: "POST",
              path: `${BASE}/bots`,
              token: t,
              body: { accountId: env.accountId }
            })
        ],
        [
          "telegram_engagement.contacts.read",
          (t) =>
            call(listContacts, {
              path: `${BASE}/contacts?accountId=${env.accountId}`,
              token: t
            })
        ],
        [
          "telegram_engagement.contacts.delete",
          (t) =>
            call(eraseContact, {
              method: "POST",
              path: `${BASE}/contacts/${UNKNOWN}/erase`,
              params: { id: UNKNOWN },
              token: t,
              body: {}
            })
        ],
        [
          "telegram_engagement.messages.create",
          (t) =>
            call(queueMessage, {
              method: "POST",
              path: `${BASE}/contacts/${UNKNOWN}/messages`,
              params: { id: UNKNOWN },
              token: t,
              body: { purpose: "support", text: "hi" }
            })
        ]
      ];

    expect(guarded.map(([key]) => key).sort()).toEqual(
      [...ALL_PERMISSIONS].sort()
    );

    for (const [missing, attempt] of guarded) {
      const token = await seedUser(
        ALL_PERMISSIONS.filter((key) => key !== missing)
      );

      expect((await attempt(token)).status, missing).toBe(403);
    }
  });

  test("the owner registers a bot; nothing secret comes back; a second registration is 409", async () => {
    if (!handlerReady) return;

    const registered = await call(registerBot, {
      method: "POST",
      path: `${BASE}/bots`,
      body: { accountId: env.accountId }
    });

    expect(registered.status).toBe(201);
    expect(registered.body.data.state).toBe("pending");

    const text = JSON.stringify(registered.body);

    expect(text).not.toContain(BOT_TOKEN.split(":")[1]!);
    expect(text).not.toContain("tge1.");
    expect(text).not.toContain("secret");

    const listed = await call(listBots, { path: `${BASE}/bots` });

    expect(listed.body.data.items.length).toBe(1);

    const again = await call(registerBot, {
      method: "POST",
      path: `${BASE}/bots`,
      body: { accountId: env.accountId }
    });

    expect(again.status).toBe(409);
    expect(again.body.error!.code).toBe("ALREADY_REGISTERED");

    const audit = (await admin()`
      SELECT to_jsonb(a)::text AS row FROM awcms_audit_events a
      WHERE action = 'telegram_engagement.bot.register'
    `) as { row: string }[];

    expect(audit.length).toBe(1);
    expect(audit[0]!.row).not.toContain(BOT_TOKEN.split(":")[1]!);
  });

  test("unknown contacts are 404; an addressee other than a contact is a 400; a missing key is a 400", async () => {
    if (!handlerReady) return;

    const unknown = await call(getContact, {
      path: `${BASE}/contacts/${UNKNOWN}`,
      params: { id: UNKNOWN }
    });

    expect(unknown.status).toBe(404);

    const chatId = await call(queueMessage, {
      method: "POST",
      path: `${BASE}/contacts/${UNKNOWN}/messages`,
      params: { id: UNKNOWN },
      body: { purpose: "support", text: "hi", chatId: 12345 }
    });

    expect(chatId.status).toBe(400);

    const noKey = await call(registerBot, {
      method: "POST",
      path: `${BASE}/bots`,
      body: { accountId: env.accountId },
      idempotencyKey: null
    });

    expect(noKey.status).toBe(400);

    const noAccount = await call(listContacts, { path: `${BASE}/contacts` });

    expect(noAccount.status).toBe(400);
  });

  test("off means 404 on every route", async () => {
    if (!handlerReady) return;

    process.env.TELEGRAM_ENGAGEMENT_ENABLED = "false";

    try {
      for (const result of await Promise.all(everyRoute(env.token))) {
        expect(result.status).toBe(404);
      }
    } finally {
      process.env.TELEGRAM_ENGAGEMENT_ENABLED = "true";
    }
  });
});
