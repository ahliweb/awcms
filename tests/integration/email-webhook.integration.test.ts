/**
 * Mailketing webhook intake in ADR-0151 `strict` mode, against a real
 * PostgreSQL through the REAL route handlers (Issue #1161) — WORLD 2 of the
 * harness.
 *
 * Mailketing documents no way to authenticate a callback. What this proves:
 *
 *   * the public route is reachable WITHOUT a session through the real
 *     middleware boundary, is a 404 while switched off, and refuses a malformed,
 *     unknown, forged, revoked or disconnected-account token with one 401, and
 *     repeated failures from one address with a 429;
 *   * a spoofed or forged event changes NO state: no message status, no
 *     suppression, no newsletter subscriber; it lands in the quarantine only
 *     when it binds to a message THIS account of THIS tenant sent to THAT
 *     recipient (cross-tenant and cross-account provider message ids are
 *     discarded);
 *   * replay collapses on the dedupe key; out-of-order `delivered` after a
 *     `bounce` cannot move the provider-reported projection backwards;
 *   * only an operator review creates a suppression (`provider_report`), a soft
 *     bounce needs the threshold, a review is final, a bounce and an
 *     unsubscribe for the same person leave ONE suppression;
 *   * a `provider_report` or `unsubscribed` suppression never blocks security
 *     mail, and still blocks transactional mail, at enqueue;
 *   * the callback token is shown once, never stored or audited; the ledger is
 *     immutable except its review and its retention floor holds for the worker.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test
} from "bun:test";
import { randomBytes } from "node:crypto";
import type { APIContext, APIRoute } from "astro";

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
import { resetRateLimitForTests } from "../../src/lib/security/rate-limit";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { enqueueAnnouncement } from "../../src/modules/email/application/announcement-directory";
import { enqueueDirectAddressEmail } from "../../src/modules/email/application/direct-address-notification";
import { hashIdentifierValue } from "../../src/modules/profile-identity/domain/identifier";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as webhook } from "../../src/pages/api/v1/email/webhooks/mailketing/[token]";
import {
  GET as listCallbacks,
  POST as issueCallback
} from "../../src/pages/api/v1/email/webhook-callbacks/index";
import { POST as revokeCallback } from "../../src/pages/api/v1/email/webhook-callbacks/[id]/revoke";
import { GET as listEvents } from "../../src/pages/api/v1/email/provider-events/index";
import { POST as reviewEvent } from "../../src/pages/api/v1/email/provider-events/[id]/review";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const RECIPIENT = "reader.one@recipient.example";
const OTHER_RECIPIENT = "reader.two@recipient.example";

type Envelope<T = any> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type World = {
  tenantId: string;
  token: string;
  ownerUserId: string;
  espAccountId: string;
  otherEspAccountId: string;
  senderId: string;
  otherSenderId: string;
};

let world: World;
let other: World;
let keyCounter = 0;
let userCounter = 0;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();
const nextKey = () => `idem-1161-${(keyCounter += 1)}-${crypto.randomUUID()}`;

async function bootstrap(code: string): Promise<World> {
  const loginIdentifier = `${code}-owner@example.com`;
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: `${code} Co`,
      tenantCode: code,
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  let tenantId: string;

  if (setup.status === 200) {
    tenantId = setup.body.data.tenantId;
  } else {
    // The platform is initialised once; a second tenant is seeded directly.
    tenantId = crypto.randomUUID();
    await admin()`
      INSERT INTO awcms_tenants
        (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
      VALUES (${tenantId}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
    `;
  }

  let token = "";
  let ownerUserId = "";

  if (setup.status === 200) {
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
    token = login.body.data.token;
    const owner = (await admin()`
      SELECT tu.id FROM awcms_tenant_users tu
      JOIN awcms_identities i ON i.id = tu.identity_id
      WHERE tu.tenant_id = ${tenantId} AND i.login_identifier = ${loginIdentifier}
    `) as { id: string }[];
    ownerUserId = owner[0]!.id;
  }

  const accounts: string[] = [];
  const senders: string[] = [];

  for (const index of [1, 2]) {
    const esp = (await admin()`
      INSERT INTO awcms_channel_accounts
        (tenant_id, provider, account_kind, external_id, display_name,
         auth_mode, status)
      VALUES (${tenantId}, 'mailketing', 'esp_account', ${`mk-${code}-${index}`},
              ${`Account ${index}`}, 'api_token', 'connected')
      RETURNING id
    `) as { id: string }[];
    const sender = (await admin()`
      INSERT INTO awcms_channel_accounts
        (tenant_id, provider, account_kind, external_id, display_name,
         auth_mode, status, parent_account_id)
      VALUES (${tenantId}, 'mailketing', 'sender_identity',
              ${`news${index}@${code}.example`}, ${`Brand ${index}`},
              'api_token', 'connected', ${esp[0]!.id})
      RETURNING id
    `) as { id: string }[];

    accounts.push(esp[0]!.id);
    senders.push(sender[0]!.id);
  }

  const actor = crypto.randomUUID();

  for (const key of ["system.announcement", "auth.password_reset"]) {
    await admin()`
      INSERT INTO awcms_email_templates
        (tenant_id, template_key, name, subject_template, text_body_template,
         created_by, updated_by)
      VALUES (${tenantId}, ${key}, ${key}, ${{ en: "Hello" }}::jsonb,
              ${{ en: "Body" }}::jsonb, ${actor}, ${actor})
      ON CONFLICT DO NOTHING
    `;
  }

  return {
    tenantId,
    token,
    ownerUserId,
    espAccountId: accounts[0]!,
    otherEspAccountId: accounts[1]!,
    senderId: senders[0]!,
    otherSenderId: senders[1]!
  };
}

/** A `sent` tenant-sender message with a provider message id, as dispatch leaves it. */
async function sentMessage(
  w: World,
  providerMessageId: string,
  recipient = RECIPIENT,
  senderId = w.senderId
): Promise<string> {
  const address = (await admin()`
    SELECT external_id FROM awcms_channel_accounts WHERE id = ${senderId}
  `) as { external_id: string }[];
  const rows = (await admin()`
    INSERT INTO awcms_email_messages
      (tenant_id, category, template_key, to_address, to_address_hash,
       to_address_masked, subject, status, provider_name, provider_message_id,
       sent_at, sender_account_id, sender_selection, sender_address, purpose)
    VALUES
      (${w.tenantId}, 'system.announcement', 'system.announcement',
       ${recipient}, ${hashIdentifierValue(recipient)}, 'r***@recipient.example',
       'Hello', 'sent', 'mailketing-v2', ${providerMessageId}, now(),
       ${senderId}, 'explicit', ${address[0]!.external_id}, 'transactional')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function issue(w: World, espAccountId = w.espAccountId, key = nextKey()) {
  return invoke<Envelope>(issueCallback, {
    method: "POST",
    path: "/api/v1/email/webhook-callbacks",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": w.tenantId,
      authorization: `Bearer ${w.token}`,
      "idempotency-key": key
    },
    body: { espAccountId },
    locals: { correlationId: "corr-1161" }
  });
}

function tokenFromPath(path: string): string {
  return path.split("/").pop()!;
}

let ipCounter = 0;

async function post(
  token: string,
  body: unknown,
  options: { ip?: string } = {}
): Promise<{ status: number; body: any }> {
  const path = `/api/v1/email/webhooks/mailketing/${token}`;
  const request = new Request(`http://integration.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const context = {
    request,
    url: new URL(request.url),
    params: { token },
    locals: {},
    cookies: createCookieJar(),
    clientAddress: options.ip ?? `198.51.100.${(ipCounter += 1) % 250}`
  } as unknown as APIContext;
  const response = await webhook(context);
  const text = await response.text();

  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : undefined
  };
}

async function authed<T = any>(
  handler: APIRoute,
  w: World,
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string;
    query?: string;
  }
) {
  const mutating = (options.method ?? "GET") !== "GET";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": w.tenantId,
    authorization: `Bearer ${options.token ?? w.token}`
  };

  if (mutating) headers["idempotency-key"] = nextKey();

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-1161" }
  });
}

async function events(tenantId: string) {
  return (await admin()`
    SELECT * FROM awcms_email_provider_events WHERE tenant_id = ${tenantId}
    ORDER BY received_at, id
  `) as Record<string, any>[];
}

async function seedUser(
  tenantId: string,
  permissionKeys: readonly string[]
): Promise<string> {
  userCounter += 1;
  const sql = admin();
  const tag = `u1161-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${tag}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `t1161-${tag}-${Math.random().toString(36).slice(2)}`;

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

      if (!permission[0]) throw new Error(`fixture: ${key} not seeded`);

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
        reason: "email webhook fixture"
      })
    );
  }

  return token;
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("Mailketing webhook quarantine (Issue #1161)", () => {
  beforeAll(async () => {
    for (const name of [
      "EMAIL_WEBHOOK_ENABLED",
      "CHANNEL_ACCOUNTS_ENABLED",
      "EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD"
    ]) {
      savedEnv[name] = process.env[name];
    }

    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
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
    process.env.EMAIL_WEBHOOK_ENABLED = "true";
    delete process.env.EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD;
    await resetHandlerDatabase();
    resetRateLimitForTests();
    world = await bootstrap("mk1161-a");
    other = await bootstrap("mk1161-b");
  });

  test("the public route passes the session boundary in the REAL middleware, and is 404 while off", async () => {
    if (!handlerReady) return;

    mock.module("astro:middleware", () => ({
      defineMiddleware: (fn: unknown) => fn
    }));
    const { onRequest } = (await import("../../src/middleware")) as unknown as {
      onRequest: (
        context: APIContext,
        next: () => Promise<Response>
      ) => Promise<Response>;
    };
    const through = async (path: string) => {
      const request = new Request(`http://integration.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "bounce" })
      });
      let reached = false;
      const response = await onRequest(
        {
          request,
          url: new URL(request.url),
          params: { token: path.split("/").pop() },
          locals: {},
          cookies: createCookieJar(),
          clientAddress: "203.0.113.9",
          redirect: (to: string, status = 302) =>
            new Response(null, { status, headers: { location: to } })
        } as unknown as APIContext,
        async () => {
          reached = true;
          return new Response("{}", { status: 200 });
        }
      );

      return { reached, status: response.status };
    };

    // No session, no tenant header: the boundary lets it through to the route.
    const open = await through(
      "/api/v1/email/webhooks/mailketing/mkw1.not-a-real-token"
    );

    expect(open.reached).toBe(true);

    // A sibling path is NOT exempt: the boundary refuses it before the route.
    const sibling = await through("/api/v1/email/webhook-callbacks");

    expect(sibling.reached).toBe(false);
    expect([400, 401]).toContain(sibling.status);

    const nested = await through(
      "/api/v1/email/webhooks/mailketing/a/extra-segment"
    );

    expect(nested.reached).toBe(false);

    // Off means 404 before anything is read.
    delete process.env.EMAIL_WEBHOOK_ENABLED;
    const off = await post("anything", { type: "bounce" });

    expect(off.status).toBe(404);
  });

  test("the token is shown once: never listed, stored or audited; replay hides it", async () => {
    if (!handlerReady) return;

    const key = nextKey();
    const first = await issue(world, world.espAccountId, key);

    expect(first.status).toBe(201);
    expect(first.body.data.revealed).toBe(true);
    const token = tokenFromPath(first.body.data.callbackPath);

    expect(token.startsWith(`mkw1.${world.tenantId}.`)).toBe(true);

    const replay = await issue(world, world.espAccountId, key);

    expect(replay.status).toBe(201);
    expect(replay.body.data.revealed).toBe(false);
    expect(replay.body.data.callbackPath).toBeUndefined();

    const listed = await authed(listCallbacks, world, {
      path: "/api/v1/email/webhook-callbacks"
    });

    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(token.split(".")[3]!);

    const secret = token.split(".")[3]!;
    const leaks = (await admin()`
      SELECT
        (SELECT count(*)::int FROM awcms_channel_webhook_subscriptions
           WHERE callback_token_hash LIKE ${"%" + secret + "%"}) AS subs,
        (SELECT count(*)::int FROM awcms_audit_events
           WHERE attributes::text LIKE ${"%" + secret + "%"}
              OR message LIKE ${"%" + secret + "%"}) AS audits,
        (SELECT count(*)::int FROM awcms_idempotency_keys
           WHERE response_body::text LIKE ${"%" + secret + "%"}) AS idem
    `) as { subs: number; audits: number; idem: number }[];

    expect(leaks[0]).toEqual({ subs: 0, audits: 0, idem: 0 });
  });

  test("default-deny: no permission is 403 on every admin verb", async () => {
    if (!handlerReady) return;

    const nobody = await seedUser(world.tenantId, []);
    const list = await authed(listEvents, world, {
      path: "/api/v1/email/provider-events",
      token: nobody
    });
    const issued = await invoke<Envelope>(issueCallback, {
      method: "POST",
      path: "/api/v1/email/webhook-callbacks",
      headers: {
        "content-type": "application/json",
        "x-awcms-tenant-id": world.tenantId,
        authorization: `Bearer ${nobody}`,
        "idempotency-key": nextKey()
      },
      body: { espAccountId: world.espAccountId }
    });

    expect(list.status).toBe(403);
    expect(issued.status).toBe(403);

    // Read-only may list but not review.
    const reader = await seedUser(world.tenantId, ["email.webhook.read"]);
    const review = await authed(reviewEvent, world, {
      method: "POST",
      path: `/api/v1/email/provider-events/${crypto.randomUUID()}/review`,
      params: { id: crypto.randomUUID() },
      body: { decision: "confirm" },
      token: reader
    });

    expect(review.status).toBe(403);
  });

  test("forged tokens are one 401, repeated failures 429; a valid token records a quarantined bounce and changes nothing else", async () => {
    if (!handlerReady) return;

    const token = tokenFromPath(
      (await issue(world)).body.data.callbackPath as string
    );
    const [, tenant, sub, secret] = token.split(".");
    const forged = `mkw1.${tenant}.${sub}.${secret!.slice(0, -1)}${secret!.endsWith("A") ? "B" : "A"}`;
    const crossTenant = `mkw1.${other.tenantId}.${sub}.${secret}`;

    for (const bad of ["garbage", forged, crossTenant]) {
      const response = await post(bad, { type: "bounce" });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    }

    const messageId = await sentMessage(world, "mk-msg-1");
    const ok = await post(token, {
      type: "bounce",
      email: RECIPIENT,
      reason: "550 5.1.1 user unknown",
      date: "2026-11-10 10:00:00",
      message_id: "mk-msg-1"
    });

    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ received: true });

    const rows = await events(world.tenantId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe("bounce");
    expect(rows[0]!.bounce_class).toBe("hard");
    expect(rows[0]!.status_code).toBe("5.1.1");
    expect(rows[0]!.review_status).toBe("pending");
    expect(rows[0]!.authenticity).toBe("unauthenticated");
    expect(rows[0]!.email_message_id).toBe(messageId);
    expect(JSON.stringify(rows[0])).not.toContain(RECIPIENT);
    expect(JSON.stringify(rows[0])).not.toContain("user unknown");

    const message = (await admin()`
      SELECT status FROM awcms_email_messages WHERE id = ${messageId}
    `) as { status: string }[];
    const suppressions = (await admin()`
      SELECT count(*)::int AS n FROM awcms_email_suppression_list
    `) as { n: number }[];

    expect(message[0]!.status).toBe("sent");
    expect(suppressions[0]!.n).toBe(0);

    // Repeated failures from one address are throttled.
    let last = 0;

    for (let i = 0; i < 32; i += 1) {
      last = (await post(forged, { type: "bounce" }, { ip: "192.0.2.77" }))
        .status;
    }

    expect(last).toBe(429);
  });

  test("binding: another tenant's or another account's message id, or another recipient, is discarded; replay collapses", async () => {
    if (!handlerReady) return;

    const token = tokenFromPath(
      (await issue(world)).body.data.callbackPath as string
    );

    await sentMessage(other, "mk-foreign-tenant");
    await sentMessage(
      world,
      "mk-other-account",
      RECIPIENT,
      world.otherSenderId
    );
    await sentMessage(world, "mk-own");

    const bounce = (id: string, email = RECIPIENT) => ({
      type: "bounce",
      email,
      reason: "550 5.1.1",
      date: "2026-11-10 10:00:00",
      message_id: id
    });

    for (const payload of [
      bounce("mk-foreign-tenant"),
      bounce("mk-other-account"),
      bounce("mk-own", OTHER_RECIPIENT),
      bounce("never-issued")
    ]) {
      expect((await post(token, payload)).status).toBe(200);
    }

    expect(await events(world.tenantId)).toHaveLength(0);
    expect(await events(other.tenantId)).toHaveLength(0);

    // Replay of the same report, single and inside an array: one row.
    await post(token, bounce("mk-own"));
    await post(token, [bounce("mk-own"), bounce("mk-own")]);

    expect(await events(world.tenantId)).toHaveLength(1);
  });

  test("newsubscriber creates nothing; unsubscribe binds by recipient; projection only moves forward", async () => {
    if (!handlerReady) return;

    const token = tokenFromPath(
      (await issue(world)).body.data.callbackPath as string
    );
    const messageId = await sentMessage(world, "mk-proj");

    await post(token, {
      type: "newsubscriber",
      email: "new@recipient.example",
      first_name: "A",
      list_id: 1,
      date: "2026-11-10 10:00:00"
    });

    const subscribers = (await admin()`
      SELECT count(*)::int AS n FROM awcms_newsletter_subscribers
    `) as { n: number }[];

    expect(subscribers[0]!.n).toBe(0);
    expect(await events(world.tenantId)).toHaveLength(0);

    await post(token, {
      type: "unsubscribe",
      email: RECIPIENT,
      date: "2026-11-10 10:05:00"
    });
    // Unsubscribe for someone this account never mailed: discarded.
    await post(token, {
      type: "unsubscribe",
      email: "stranger@recipient.example",
      date: "2026-11-10 10:05:00"
    });

    const afterUnsub = await events(world.tenantId);

    expect(afterUnsub).toHaveLength(1);
    expect(afterUnsub[0]!.correlation).toBe("recipient_only");
    expect(afterUnsub[0]!.review_status).toBe("pending");

    // A bounce, then a LATE delivered for the same message.
    await post(token, {
      type: "bounce",
      email: RECIPIENT,
      reason: "550 5.1.1",
      date: "2026-11-10 10:10:00",
      message_id: "mk-proj"
    });
    await post(token, {
      type: "delivered",
      rcpt: RECIPIENT,
      jobid: "mk-proj",
      send_time: "2026-11-10 10:00:00"
    });

    const listed = await authed(listEvents, world, {
      path: "/api/v1/email/provider-events",
      query: `emailMessageId=${messageId}`
    });

    expect(listed.status).toBe(200);
    expect(listed.body.data.projection.providerReportedStatus).toBe("bounced");
    expect(listed.body.data.projection.authenticity).toBe("unauthenticated");
    expect(JSON.stringify(listed.body)).not.toContain(RECIPIENT);
  });

  test("only an operator review suppresses; soft bounces need the threshold; a review is final; security mail is never blocked by a provider report", async () => {
    if (!handlerReady) return;

    const token = tokenFromPath(
      (await issue(world)).body.data.callbackPath as string
    );

    await sentMessage(world, "mk-soft");
    await post(token, {
      type: "bounce",
      email: RECIPIENT,
      reason: "452 4.2.2 mailbox full",
      date: "2026-11-10 10:00:00",
      message_id: "mk-soft"
    });

    const soft = (await events(world.tenantId))[0]!;
    const review = (id: string, decision: string) =>
      authed(reviewEvent, world, {
        method: "POST",
        path: `/api/v1/email/provider-events/${id}/review`,
        params: { id },
        body: { decision }
      });

    const below = await review(soft.id, "confirm");

    expect(below.status).toBe(409);
    expect(below.body.error?.code).toBe("BELOW_SOFT_BOUNCE_THRESHOLD");

    // Unsubscribe and a hard bounce for the SAME person: one suppression.
    await post(token, {
      type: "unsubscribe",
      email: RECIPIENT,
      date: "2026-11-10 10:20:00"
    });
    await sentMessage(world, "mk-hard");
    await post(token, {
      type: "bounce",
      email: RECIPIENT,
      reason: "550 5.1.1",
      date: "2026-11-10 10:30:00",
      message_id: "mk-hard"
    });

    const pending = (await events(world.tenantId)).filter(
      (row) => row.id !== soft.id
    );

    for (const row of pending) {
      const confirmed = await review(row.id, "confirm");

      expect(confirmed.status).toBe(200);
    }

    const list = (await admin()`
      SELECT reason, source, provider_event_id FROM awcms_email_suppression_list
      WHERE tenant_id = ${world.tenantId}
    `) as { reason: string; source: string; provider_event_id: string }[];

    expect(list).toHaveLength(1);
    expect(list[0]!.source).toBe("provider_report");

    const again = await review(pending[0]!.id, "dismiss");

    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("ALREADY_REVIEWED");

    // Enqueue: transactional is blocked, security still goes out.
    const outcomes = await withTenantOrThrow(
      getHandlerDatabaseClient(),
      world.tenantId,
      async (tx) => ({
        transactional: await enqueueDirectAddressEmail(
          tx,
          world.tenantId,
          "system.announcement",
          RECIPIENT,
          {},
          "corr-1"
        ),
        security: await enqueueDirectAddressEmail(
          tx,
          world.tenantId,
          "auth.password_reset",
          RECIPIENT,
          {},
          "corr-2"
        )
      })
    );

    expect(outcomes.transactional.enqueued).toBe(false);
    expect(outcomes.security.enqueued).toBe(true);
  });

  test("an operator 'unsubscribed' entry never blocks security mail; a manual one does", async () => {
    if (!handlerReady) return;

    const enqueue = (templateKey: string, address: string) =>
      withTenantOrThrow(getHandlerDatabaseClient(), world.tenantId, (tx) =>
        enqueueDirectAddressEmail(
          tx,
          world.tenantId,
          templateKey,
          address,
          {},
          crypto.randomUUID()
        )
      );

    await admin()`
      INSERT INTO awcms_email_suppression_list
        (tenant_id, recipient_hash, recipient_masked, reason)
      VALUES (${world.tenantId}, ${hashIdentifierValue(RECIPIENT)}, 'r***', 'unsubscribed'),
             (${world.tenantId}, ${hashIdentifierValue(OTHER_RECIPIENT)}, 'r***', 'manual')
    `;

    expect((await enqueue("auth.password_reset", RECIPIENT)).enqueued).toBe(
      true
    );
    expect((await enqueue("system.announcement", RECIPIENT)).enqueued).toBe(
      false
    );
    expect(
      (await enqueue("auth.password_reset", OTHER_RECIPIENT)).enqueued
    ).toBe(false);

    // Announcement path: same rule.
    const announced = await withTenantOrThrow(
      getHandlerDatabaseClient(),
      world.tenantId,
      (tx) =>
        enqueueAnnouncement(
          tx,
          world.tenantId,
          "system.announcement",
          {},
          { type: "tenant" },
          crypto.randomUUID()
        )
    );

    expect(announced).not.toBeNull();
  });

  test("revoked, rotated and disconnected callbacks stop verifying", async () => {
    if (!handlerReady) return;

    const first = await issue(world);
    const firstToken = tokenFromPath(first.body.data.callbackPath as string);
    const second = await issue(world);
    const secondToken = tokenFromPath(second.body.data.callbackPath as string);

    expect(second.body.data.rotatedCallbackIds).toEqual([
      first.body.data.callback.id
    ]);
    expect((await post(firstToken, { type: "bounce" })).status).toBe(401);
    // A body that binds nothing still proves the URL.
    expect((await post(secondToken, { type: "unknown_kind" })).status).toBe(
      200
    );

    const revoked = await authed(revokeCallback, world, {
      method: "POST",
      path: `/api/v1/email/webhook-callbacks/${second.body.data.callback.id}/revoke`,
      params: { id: second.body.data.callback.id }
    });

    expect(revoked.status).toBe(200);
    expect(revoked.body.data.changed).toBe(true);
    expect((await post(secondToken, { type: "bounce" })).status).toBe(401);

    const third = tokenFromPath(
      (await issue(world)).body.data.callbackPath as string
    );

    await admin()`
      UPDATE awcms_channel_accounts SET status = 'revoked'
      WHERE id = ${world.espAccountId}
    `;

    expect((await post(third, { type: "bounce" })).status).toBe(401);

    // Another tenant's account id: one 422, nothing issued.
    const foreign = await issue(world, other.espAccountId);

    expect(foreign.status).toBe(422);
  });

  test("the ledger is immutable except its review, and the worker's retention floor holds", async () => {
    if (!handlerReady) return;

    const token = tokenFromPath(
      (await issue(world)).body.data.callbackPath as string
    );

    await sentMessage(world, "mk-imm");
    await post(token, {
      type: "emailopen",
      email: RECIPIENT,
      date: "2026-11-10 10:00:00",
      message_id: "mk-imm"
    });

    const row = (await events(world.tenantId))[0]!;

    expect(row.review_status).toBe("informational");

    for (const statement of [
      admin()`UPDATE awcms_email_provider_events SET received_at = now() - interval '400 days' WHERE id = ${row.id}`,
      admin()`UPDATE awcms_email_provider_events SET recipient_hash = ${"0".repeat(64)} WHERE id = ${row.id}`,
      admin()`UPDATE awcms_email_provider_events SET review_status = 'confirmed' WHERE id = ${row.id}`
    ]) {
      let failed = false;

      try {
        await statement;
      } catch {
        failed = true;
      }

      expect(failed).toBe(true);
    }

    const deleted = (await admin().begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${world.tenantId}, true)`;
      await tx`SET LOCAL ROLE awcms_worker`;

      return tx`
        DELETE FROM awcms_email_provider_events WHERE id = ${row.id} RETURNING id
      `;
    })) as unknown[];

    expect(deleted).toHaveLength(0);
  });
});
