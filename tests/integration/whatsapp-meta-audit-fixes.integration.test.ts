/**
 * The #1267 audit fixes that need the real routes against a real PostgreSQL
 * (the handler database: route handlers reach it through
 * `getDatabaseClient()`).
 *
 * M1: the per-address bucket of the public Meta webhook is charged only while
 * the callback token has NOT matched. One tenant whose stored app secret is
 * wrong makes every genuine delivery of ITS number fail the signature; those
 * refusals land on that tenant's own denial bucket, so they no longer 429 every
 * other tenant's genuine deliveries from the same Meta address. A token that
 * does not match still spends the address bucket (security review M-2).
 *
 * M2: a caller confined to business scopes never reads or changes the
 * WABA-LEVEL state of a TENANT-WIDE WABA, with real sessions.
 *
 * Template approvals and restriction signals of a WABA with no business scope
 * are tenant-wide state, which a confined caller does not hold (the module's own
 * rule: `policyVisible`/`canMakeDefault` in `whatsapp-sender-screen.ts`). So:
 *
 * - `GET /whatsapp/meta-templates` hides that WABA's templates and signals;
 * - `PUT /whatsapp/meta-templates` answers the same `422 CONTAINER_NOT_FOUND`
 *   as an unknown container;
 * - `POST /whatsapp/meta-signals/{id}/clear-restriction` answers the same `404`
 *   as an unknown WABA;
 * - `POST /channel-accounts/accounts/{id}/webhook-subscription` for one of its
 *   numbers answers the same `404` as an unknown account.
 *
 * A pending confinement (not yet in force) confines too (fail-closed, #1270).
 * A scoped WABA of the caller's own scope keeps working, and an unconfined
 * caller keeps working on the tenant-wide WABA.
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
import { createHmac, randomBytes } from "node:crypto";

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
import { createMetaWebhookSubscription } from "../../src/modules/channel-accounts/application/webhook-subscription-directory";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as createSubscription } from "../../src/pages/api/v1/channel-accounts/accounts/[id]/webhook-subscription";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as clearRestriction } from "../../src/pages/api/v1/whatsapp/meta-signals/[id]/clear-restriction";
import {
  GET as getMetaTemplates,
  PUT as putMetaTemplate
} from "../../src/pages/api/v1/whatsapp/meta-templates";
import { POST as metaWebhook } from "../../src/pages/api/v1/whatsapp/webhooks/meta/[token]";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const KEYS = [
  "whatsapp_delivery.meta_templates.read",
  "whatsapp_delivery.meta_templates.configure",
  "whatsapp_delivery.meta_signals.configure",
  "channel_accounts.webhooks.configure"
];
const UNKNOWN_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SECRET_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 17 + 5) % 251)
).toString("base64");
const HASH_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 251)
).toString("base64");
const ENV_NAMES = [
  "CHANNEL_ACCOUNTS_ENABLED",
  "CHANNEL_SECRETS_ENCRYPTION_KEYS",
  "WHATSAPP_ENABLED",
  "WHATSAPP_RECIPIENT_HASH_KEYS"
];
const setEnv = () => {
  process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
  process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS = `k1:${SECRET_KEY}`;
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_RECIPIENT_HASH_KEYS = `k1:${HASH_KEY}`;
};

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};
type MetaListBody = {
  items: { containerAccountId: string }[];
  signals: { containerAccountId: string }[];
};
type Waba = { container: string; number: string };

let tenantId = "";
let ownerTenantUserId = "";
let userCounter = 0;
let keyCounter = 0;
let serial = 3_000_000_000_000;
const savedEnv: Record<string, string | undefined> = {};

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "wa-meta-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "WA Meta Co",
      tenantCode: "wa-meta",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);
  tenantId = setup.body.data.tenantId;

  const login = await invoke(authLogin, {
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

  const owner = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  ownerTenantUserId = owner[0]!.id;
}

async function seedUser(
  label: string
): Promise<{ token: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `wam-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  const role = (await sql`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
  `) as { id: string }[];

  for (const key of KEYS) {
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
      reason: "whatsapp meta confinement fixture"
    })
  );

  return { token, tenantUserId: tenantUser[0]!.id };
}

async function seedOffice(code: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${tenantId}, ${code}, ${`Office ${code}`}) RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** Confines a person to an office; `pending` starts the confinement tomorrow. */
async function holdScope(
  tenantUserId: string,
  officeId: string,
  pending = false
): Promise<void> {
  await admin()`
    INSERT INTO awcms_business_scope_assignments
      (tenant_id, tenant_user_id, scope_type, scope_id,
       granted_by_tenant_user_id, effective_from)
    VALUES (${tenantId}, ${tenantUserId}, 'office', ${officeId},
            ${ownerTenantUserId},
            ${pending ? new Date(Date.now() + 86_400_000) : new Date()})
  `;
}

/**
 * A live WABA container (scoped to `officeId`, or tenant-wide) with one Meta
 * number of the same scope, an approved template and a restriction signal.
 */
async function seedWaba(
  officeId: string | null,
  tenant: string = tenantId
): Promise<Waba> {
  const tenantId = tenant;

  serial += 1;
  const wabaId = `waba-${serial}`;
  const scopeType = officeId ? "office" : null;
  const container = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider,
       account_kind, external_id, display_name, auth_mode, status)
    VALUES (${tenantId}, ${scopeType}, ${officeId}, 'whatsapp_cloud', 'waba',
            ${wabaId}, 'waba', 'api_token', 'connected')
    RETURNING id
  `) as { id: string }[];
  const number = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider,
       account_kind, external_id, display_name, auth_mode, status,
       parent_account_id)
    VALUES (${tenantId}, ${scopeType}, ${officeId}, 'whatsapp_cloud',
            'waba_phone_number', ${String(serial)}, ${`n-${serial}`},
            'api_token', 'connected', ${container[0]!.id})
    RETURNING id
  `) as { id: string }[];

  await admin()`
    INSERT INTO awcms_whatsapp_meta_templates
      (tenant_id, waba_external_id, template_name, language, category,
       provider_status, evidence_ref, source, last_event_at)
    VALUES (${tenantId}, ${wabaId}, 'it1267_notice', 'id', 'UTILITY',
            'APPROVED', 'fixture', 'operator', now() - interval '1 hour')
  `;
  await admin()`
    INSERT INTO awcms_whatsapp_meta_sender_signals
      (tenant_id, waba_external_id, restriction_reason, restricted_at,
       restriction_event_at)
    VALUES (${tenantId}, ${wabaId}, 'ACCOUNT_RESTRICTION',
            now() - interval '1 hour', now() - interval '1 hour')
  `;

  return { container: container[0]!.id, number: number[0]!.id };
}

const headers = (token: string, extra: Record<string, string> = {}) => ({
  "x-awcms-tenant-id": tenantId,
  authorization: `Bearer ${token}`,
  ...extra
});
const idempotency = () => {
  keyCounter += 1;

  return { "idempotency-key": `it1267-${keyCounter}-${crypto.randomUUID()}` };
};

function list(token: string) {
  return invoke<Envelope<MetaListBody>>(getMetaTemplates, {
    path: "/api/v1/whatsapp/meta-templates",
    headers: headers(token),
    locals: { correlationId: "corr-it1267" }
  });
}

function record(token: string, containerAccountId: string) {
  return invoke<Envelope>(putMetaTemplate, {
    method: "PUT",
    path: "/api/v1/whatsapp/meta-templates",
    headers: headers(token, {
      "content-type": "application/json",
      ...idempotency()
    }),
    body: {
      containerAccountId,
      name: "it1267_notice",
      language: "id",
      category: "UTILITY",
      status: "PAUSED"
    },
    locals: { correlationId: "corr-it1267" }
  });
}

function clear(token: string, id: string) {
  return invoke<Envelope>(clearRestriction, {
    method: "POST",
    path: `/api/v1/whatsapp/meta-signals/${id}/clear-restriction`,
    headers: headers(token, idempotency()),
    params: { id },
    locals: { correlationId: "corr-it1267" }
  });
}

function subscribe(token: string, id: string) {
  return invoke<Envelope>(createSubscription, {
    method: "POST",
    path: `/api/v1/channel-accounts/accounts/${id}/webhook-subscription`,
    headers: headers(token, {
      "content-type": "application/json",
      ...idempotency()
    }),
    body: { appSecret: "appsecret1267appsecret1267abcdef" },
    params: { id },
    locals: { correlationId: "corr-it1267" }
  });
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite(
  "#1267 audit fixes: webhook address bucket (M1), WABA state confinement (M2)",
  () => {
    let officeA = "";
    let tenantWide: Waba;
    let scoped: Waba;

    beforeAll(async () => {
      for (const name of ENV_NAMES) savedEnv[name] = process.env[name];

      setEnv();
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
      expect(handlerReady, "the handler database must be available").toBe(true);
      setEnv();
      await resetHandlerDatabase();
      await bootstrap();
      officeA = await seedOffice("office-a");
      tenantWide = await seedWaba(null);
      scoped = await seedWaba(officeA);
    }, 60_000);

    test("M1: one tenant's bad-signature flood never 429s another tenant's genuine delivery from the same address", async () => {
      // A second tenant, with its own number on its own WABA.
      const otherTenant = crypto.randomUUID();

      await admin()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${otherTenant}, 'wa-meta-b', 'wa-meta-b')
      `;

      const profile = (await admin()`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${otherTenant}, 'person', 'b') RETURNING id
      `) as { id: string }[];
      const identity = (await admin()`
        INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
        VALUES (${otherTenant}, ${profile[0]!.id}, 'b-1267@example.com', 'x')
        RETURNING id
      `) as { id: string }[];
      const actorB = (await admin()`
        INSERT INTO awcms_tenant_users (tenant_id, identity_id)
        VALUES (${otherTenant}, ${identity[0]!.id}) RETURNING id
      `) as { id: string }[];
      const numberB = await seedWaba(null, otherTenant);
      const subscribeDirect = async (
        tenant: string,
        actor: string,
        accountId: string,
        appSecret: string
      ) => {
        const created = await withTenantOrThrow(
          getHandlerDatabaseClient(),
          tenant,
          (tx) =>
            createMetaWebhookSubscription(
              tx,
              defaultSecretStore,
              tenant,
              actor,
              accountId,
              appSecret
            )
        );

        if (created.outcome !== "created") throw new Error(created.outcome);

        return created.callbackToken;
      };
      const sign = (secret: string, body: string) =>
        `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
      const post = async (
        token: string,
        body: string,
        signature: string,
        address: string
      ) =>
        (
          await metaWebhook({
            request: new Request(
              `https://budget.example/api/v1/whatsapp/webhooks/meta/${token}`,
              {
                method: "POST",
                headers: { "x-hub-signature-256": signature },
                body
              }
            ),
            params: { token },
            clientAddress: address
          } as never)
        ).status;

      // Tenant A stored a stale app secret: Meta signs with the real one, so
      // every genuine delivery for A fails the signature with a token that
      // DOES match.
      const tokenA = await subscribeDirect(
        tenantId,
        ownerTenantUserId,
        tenantWide.number,
        "staleSecretA1staleSecretA1stale1"
      );
      const secretB = "appsecretB1appsecretB1appsecret1";
      const tokenB = await subscribeDirect(
        otherTenant,
        actorB[0]!.id,
        numberB.number,
        secretB
      );
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: []
      });
      const META_ADDRESS = "198.51.100.23";
      const statusesA: number[] = [];

      // More than the address allowance (120 per minute).
      for (let i = 0; i < 150; i += 1) {
        statusesA.push(
          await post(tokenA, body, sign("the-real-secret", body), META_ADDRESS)
        );
      }

      // A's refusals land on A's own denial bucket (30 per minute).
      expect(statusesA.filter((s) => s === 401).length).toBe(30);
      expect(statusesA.filter((s) => s === 429).length).toBe(120);
      // B's genuine delivery from the same address goes through.
      expect(await post(tokenB, body, sign(secretB, body), META_ADDRESS)).toBe(
        200
      );

      // A token that does NOT match still spends the address bucket (M-2
      // holds): after 120 forged tokens of tenant B from another address there
      // is no room there, even for B's genuine delivery.
      const OTHER_ADDRESS = "198.51.100.24";
      const forged = `${tokenB.slice(0, tokenB.lastIndexOf(".") + 1)}${"C".repeat(43)}`;

      for (let i = 0; i < 120; i += 1) {
        await post(forged, body, sign(secretB, body), OTHER_ADDRESS);
      }

      const again = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [],
        n: 2
      });

      expect(
        await post(tokenB, again, sign(secretB, again), OTHER_ADDRESS)
      ).toBe(429);
    });

    test("GET hides a tenant-wide WABA's templates and signals from a confined caller, pending confinement included", async () => {
      const confined = await seedUser("confined");
      const pending = await seedUser("pending");
      const unconfined = await seedUser("unconfined");

      await holdScope(confined.tenantUserId, officeA);
      await holdScope(pending.tenantUserId, officeA, true);

      const containers = (body: MetaListBody | undefined) => ({
        items: [...new Set(body!.items.map((i) => i.containerAccountId))],
        signals: body!.signals.map((s) => s.containerAccountId)
      });

      const seen = await list(confined.token);

      expect(seen.status).toBe(200);
      expect(containers(seen.body.data)).toEqual({
        items: [scoped.container],
        signals: [scoped.container]
      });

      // Pending: holds no scope yet AND is confined, so it sees neither.
      const early = await list(pending.token);

      expect(early.status).toBe(200);
      expect(containers(early.body.data)).toEqual({ items: [], signals: [] });

      // Unconfined (and holding no office scope): the tenant-wide WABA, not
      // office A's.
      const all = await list(unconfined.token);

      expect(all.status).toBe(200);
      expect(containers(all.body.data)).toEqual({
        items: [tenantWide.container],
        signals: [tenantWide.container]
      });
    });

    test("PUT meta-templates: a confined caller gets the unknown-container answer for a tenant-wide WABA", async () => {
      const confined = await seedUser("confined");
      const unconfined = await seedUser("unconfined");

      await holdScope(confined.tenantUserId, officeA);

      const unknown = await record(confined.token, UNKNOWN_ID);
      const refused = await record(confined.token, tenantWide.container);

      expect(unknown.status).toBe(422);
      expect(refused.status).toBe(unknown.status);
      expect(refused.body).toEqual(unknown.body);
      expect((await record(confined.token, scoped.container)).status).toBe(200);
      expect(
        (await record(unconfined.token, tenantWide.container)).status
      ).toBe(200);
    });

    test("clear-restriction: a confined caller gets the unknown-WABA answer for a tenant-wide WABA", async () => {
      const confined = await seedUser("confined");
      const unconfined = await seedUser("unconfined");

      await holdScope(confined.tenantUserId, officeA);

      const unknown = await clear(confined.token, UNKNOWN_ID);
      const refused = await clear(confined.token, tenantWide.container);

      expect(unknown.status).toBe(404);
      expect(refused.status).toBe(unknown.status);
      expect(refused.body).toEqual(unknown.body);

      const restricted = async () =>
        (
          (await admin()`
            SELECT count(*)::int AS n FROM awcms_whatsapp_meta_sender_signals
            WHERE tenant_id = ${tenantId} AND restriction_reason IS NOT NULL
          `) as { n: number }[]
        )[0]!.n;

      expect(await restricted()).toBe(2);
      expect((await clear(confined.token, scoped.container)).status).toBe(200);
      expect((await clear(unconfined.token, tenantWide.container)).status).toBe(
        200
      );
      expect(await restricted()).toBe(0);
    });

    test("webhook-subscription: a confined caller gets the unknown-account answer for a number of a tenant-wide WABA", async () => {
      const confined = await seedUser("confined");
      const unconfined = await seedUser("unconfined");

      await holdScope(confined.tenantUserId, officeA);

      const unknown = await subscribe(confined.token, UNKNOWN_ID);
      const refused = await subscribe(confined.token, tenantWide.number);

      expect(unknown.status).toBe(404);
      expect(refused.status).toBe(unknown.status);
      expect(refused.body).toEqual(unknown.body);

      const subscriptions = async () =>
        (
          (await admin()`
            SELECT count(*)::int AS n FROM awcms_channel_webhook_subscriptions
            WHERE tenant_id = ${tenantId}
          `) as { n: number }[]
        )[0]!.n;

      expect(await subscriptions()).toBe(0);
      expect((await subscribe(confined.token, scoped.number)).status).toBe(201);
      expect(
        (await subscribe(unconfined.token, tenantWide.number)).status
      ).toBe(201);
      expect(await subscriptions()).toBe(2);
    });
  }
);
