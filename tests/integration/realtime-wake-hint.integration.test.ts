/**
 * The cross-instance wake-up hint (Issue #1171, ADR-0154 section 2 and 7)
 * against a real PostgreSQL: `sql/418`'s NOTIFY triggers, two independent
 * listener connections standing in for two application instances, and the real
 * `defineProgressSseRoute` factory.
 *
 * What a database can answer here:
 *
 *  (a) a change committed by "instance 1" reaches a stream held by "instance 2"
 *      long before that stream's own (deliberately very long) tick;
 *  (b) a subscriber that joins while writes are in flight loses none of them:
 *      the cursor, not the hint, is what guarantees it;
 *  (c) a hint of tenant B never wakes tenant A, and is dropped where tenant B
 *      has no stream;
 *  (d) the NOTIFY payload is exactly a tenant id and a topic, whatever the
 *      row held;
 *  plus: the listener refuses a SUPERUSER or BYPASSRLS login, and reconnects
 *  (exactly one backend) after its connection is killed.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test
} from "bun:test";
import type { APIContext, APIRoute } from "astro";
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
import {
  createWakeHub,
  REALTIME_WAKE_CHANNEL,
  type WakeHub
} from "../../src/lib/realtime/wake-hub";
import {
  startWakeListener,
  type WakeListenerHandle
} from "../../src/lib/realtime/wake-listener";
import { defineProgressSseRoute } from "../../src/modules/_shared/progress-sse-route";
import { REALTIME_TOPICS } from "../../src/modules/_shared/realtime-topics";
import { createSseConnectionRegistry } from "../../src/modules/_shared/sse-progress";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { inboxStatusProgressTopic } from "../../src/modules/omnichannel-inbox/application/inbox-status-progress";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const ROWS = [
  "omnichannel_inbox.status.read",
  "omnichannel_inbox.conversations.read"
];
const INBOX = "inbox.status.progress";

type SseEvent = { event: string; id?: string; data: unknown };
type Changes = { changes?: { id: string }[] };

let tenantId = "";
let counter = 0;
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "wk-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Wake Co",
      tenantCode: "wk-one",
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
}

async function seedUser(
  tenant: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string; roleId: string }> {
  counter += 1;
  const sql = admin();
  const tag = `${label}-${counter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenant}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenant}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenant}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `rt-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenant}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  const role = (await sql`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenant}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
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
      VALUES (${tenant}, ${role[0]!.id}, ${permission[0].id})
    `;
  }

  await withTenantOrThrow(getHandlerDatabaseClient(), tenant, (tx) =>
    grantRolePolicy(tx, tenant, {
      tenantUserId: tenantUser[0]!.id,
      roleId: role[0]!.id,
      grantedByTenantUserId: null,
      reason: "inbox progress fixture"
    })
  );

  return { token, tenantUserId: tenantUser[0]!.id, roleId: role[0]!.id };
}

/** A conversation row with recognisable opaque fields, so a leak is detectable. */
async function conversation(
  tenant: string,
  options: {
    officeId?: string | null;
    status?: string;
    awaiting?: boolean;
    assignee?: string | null;
    due?: "past" | "future" | null;
  } = {}
): Promise<string> {
  counter += 1;
  const awaiting = options.awaiting ?? false;
  const due = awaiting ? (options.due ?? null) : null;
  const assignee = options.assignee ?? null;
  const rows = (await admin()`
    INSERT INTO awcms_inbox_conversations
      (tenant_id, source_kind, source_ref, business_scope_type,
       business_scope_id, first_inbound_at, last_inbound_at, awaiting_since,
       status, assignee_tenant_user_id, assigned_at, response_due_kind,
       response_due_at)
    VALUES (${tenant}, 'website', ${crypto.randomUUID()},
            ${options.officeId ? "office" : null}, ${options.officeId ?? null},
            now() - interval '1 hour', now() - interval '1 hour',
            ${awaiting ? new Date(Date.now() - 3_600_000) : null},
            ${options.status ?? "open"}, ${assignee},
            ${assignee ? new Date() : null},
            ${due ? "first" : null},
            ${due ? new Date(Date.now() + (due === "past" ? -60_000 : 3_600_000)) : null})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

function headersFor(token: string, extra: Record<string, string> = {}) {
  return {
    "x-awcms-tenant-id": tenantId,
    authorization: `Bearer ${token}`,
    ...extra
  };
}

/** The production topic and factory; a 30 s tick, so only a hint can make a frame arrive in time. */
function routeWith(hub: WakeHub, tickIntervalMs = 30_000): APIRoute {
  return defineProgressSseRoute({
    topic: inboxStatusProgressTopic,
    workClass: "interactive",
    tickIntervalMs,
    heartbeatMs: 20_000,
    maxConnectionMs: 60_000,
    maxChangesPerFrame: 200,
    maxFrameBytes: 65_536,
    retryMs: 1_000,
    connections: createSseConnectionRegistry(),
    env: { ...process.env, APP_URL: "https://app.example" },
    wake: { hub, ensure: () => undefined }
  });
}

type OpenStream = {
  response: Response;
  events: SseEvent[];
  /** Waits until an event matches, or fails after `timeoutMs`. */
  waitFor: (
    predicate: (event: SseEvent) => boolean,
    timeoutMs?: number
  ) => Promise<SseEvent>;
  /** Resolves when the server ends the stream. */
  ended: Promise<void>;
  close: () => void;
};

async function open(
  route: APIRoute,
  token: string,
  extraHeaders: Record<string, string> = {}
): Promise<OpenStream> {
  const controller = new AbortController();
  const url = new URL(
    "https://app.example/api/v1/omnichannel-inbox/progress/stream"
  );
  const request = new Request(url, {
    headers: headersFor(token, extraHeaders),
    signal: controller.signal
  });
  const response = await route({
    request,
    url,
    params: {},
    locals: {},
    cookies: createCookieJar(),
    clientAddress: "127.0.0.1"
  } as unknown as APIContext);
  const events: SseEvent[] = [];
  const listeners = new Set<() => void>();
  let buffer = "";
  let finished = false;

  const ended = (async () => {
    if (!response.body || response.status !== 200) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      for (;;) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let split = buffer.indexOf("\n\n");

        while (split >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");

          let event = "message";
          let id: string | undefined;
          let data = "";

          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("id: ")) id = line.slice(4);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }

          if (data !== "") {
            events.push({ event, id, data: JSON.parse(data) });
            for (const notify of listeners) notify();
          }
        }
      }
    } catch {
      // Aborted by the test.
    } finally {
      finished = true;
      for (const notify of listeners) notify();
    }
  })();

  const waitFor = (
    predicate: (event: SseEvent) => boolean,
    timeoutMs = 4_000
  ): Promise<SseEvent> =>
    new Promise((resolve, reject) => {
      const check = () => {
        const found = events.find(predicate);

        if (found) {
          cleanup();
          resolve(found);
        } else if (finished) {
          cleanup();
          reject(
            new Error(
              `stream ended without a match: ${JSON.stringify(events.map((e) => e.event))}`
            )
          );
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `timed out; saw ${JSON.stringify(events.map((e) => e.event))}`
          )
        );
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        listeners.delete(check);
      };

      listeners.add(check);
      check();
    });

  return {
    response,
    events,
    waitFor,
    ended,
    close: () => controller.abort()
  };
}

// ---------------------------------------------------------------------------
// Roles and instances
// ---------------------------------------------------------------------------

const ROLE_PASSWORD = "wk-" + randomBytes(8).toString("hex");
const ROLES = {
  one: "t1171_instance_one",
  two: "t1171_instance_two",
  probe: "t1171_probe",
  reconnect: "t1171_reconnect",
  superuser: "t1171_super",
  bypass: "t1171_bypass"
};
let databaseName = "";

async function createRoles(): Promise<void> {
  const sql = admin();
  const rows = (await sql`SELECT current_database() AS db`) as { db: string }[];

  databaseName = rows[0]!.db;

  for (const [key, name] of Object.entries(ROLES)) {
    await sql.unsafe(`DROP ROLE IF EXISTS ${name}`);
    const attrs =
      key === "superuser"
        ? "SUPERUSER"
        : key === "bypass"
          ? "BYPASSRLS"
          : "NOSUPERUSER NOBYPASSRLS";

    await sql.unsafe(
      `CREATE ROLE ${name} LOGIN ${attrs} PASSWORD '${ROLE_PASSWORD}'`
    );
  }
}

async function dropRoles(): Promise<void> {
  for (const name of Object.values(ROLES)) {
    await admin()
      .unsafe(`DROP ROLE IF EXISTS ${name}`)
      .catch(() => undefined);
  }
}

function urlFor(role: string): string {
  const url = new URL(process.env.DATABASE_URL!);

  url.pathname = `/${databaseName}`;
  url.username = role;
  url.password = ROLE_PASSWORD;

  return url.toString();
}

type Instance = {
  hub: WakeHub;
  listener: WakeListenerHandle;
  wakeAllCalls: () => number;
};

const knownTopics = new Set(REALTIME_TOPICS.map((entry) => entry.topic));
const started: WakeListenerHandle[] = [];

async function until(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return;
    await Bun.sleep(20);
  }

  throw new Error("condition not met in time");
}

/** One simulated application instance: its own hub and its own LISTEN connection. */
async function startInstance(
  role: string,
  throttleMs = 20,
  backoffMs = 25
): Promise<Instance> {
  const hub = createWakeHub({ knownTopics, throttleMs });
  let wakeAll = 0;
  const listener = startWakeListener({
    url: urlFor(role),
    initialBackoffMs: backoffMs,
    maxBackoffMs: backoffMs * 4,
    onPayload: (raw) => hub.dispatch(raw),
    onReconnected: () => {
      wakeAll += 1;
      hub.wakeAll();
    }
  });

  started.push(listener);
  await until(() => listener.state() === "listening");

  return { hub, listener, wakeAllCalls: () => wakeAll };
}

async function backendsOf(role: string): Promise<number> {
  const rows = (await admin()`
    SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = ${role}
  `) as { n: number }[];

  return rows[0]!.n;
}

const changeIds = (events: SseEvent[]): Set<string> =>
  new Set(
    events
      .filter((e) => e.event === "progress")
      .flatMap((e) => (e.data as Changes).changes ?? [])
      .map((c) => c.id)
  );

setDefaultTimeout(30_000);

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;
const savedEnv: Record<string, string | undefined> = {};

suite("realtime wake-up hint across instances (#1171)", () => {
  beforeAll(async () => {
    for (const name of [
      "OMNICHANNEL_INBOX_ENABLED",
      "CHANNEL_ACCOUNTS_ENABLED"
    ]) {
      savedEnv[name] = process.env[name];
    }
    handlerReady = await ensureHandlerDatabaseReady();
    if (handlerReady) await createRoles();
  });

  afterAll(async () => {
    for (const listener of started.splice(0)) await listener.stop();

    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    if (handlerReady) await dropRoles();
    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    expect(handlerReady, "the handler database must be available").toBe(true);
    process.env.OMNICHANNEL_INBOX_ENABLED = "true";
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    await resetHandlerDatabase();
    await bootstrap();
  });

  test("(a) a change committed elsewhere reaches a stream on another instance far before its own tick", async () => {
    const instance1 = await startInstance(ROLES.one);
    const instance2 = await startInstance(ROLES.two);
    const viewer = await seedUser(tenantId, "viewer", ROWS);
    // Instance 2 holds the stream, with a 30 s tick of its own.
    const stream = await open(routeWith(instance2.hub), viewer.token);

    expect(stream.response.status).toBe(200);
    await stream.waitFor((e) => e.event === "progress");

    const startedAt = Date.now();
    // Instance 1 is the writer: its own hub has no stream of this tenant, so
    // nothing it holds could have woken the stream by itself.
    const id = await conversation(tenantId);

    await stream.waitFor((e) => changeIds([e]).has(id), 3_000);

    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(instance1.hub.subscriberCount()).toBe(0);
    stream.close();
    await stream.ended;
  });

  test("(b) race: a subscriber joining while writes are in flight loses none of them", async () => {
    const instance = await startInstance(ROLES.two);
    const viewer = await seedUser(tenantId, "viewer", ROWS);

    // The client's last known cursor, from before any of the writes.
    const opening = await open(routeWith(instance.hub), viewer.token);

    await opening.waitFor((e) => e.event === "progress");
    const cursor = opening.events.find((e) => e.event === "progress")!.id!;

    opening.close();
    await opening.ended;

    const created: string[] = [];
    const writer = (async () => {
      for (let i = 0; i < 12; i += 1) {
        created.push(await conversation(tenantId));
        await Bun.sleep(i % 3 === 0 ? 0 : 15);
      }
    })();

    // Joins in the middle of the writes, resuming from the old cursor, on a
    // 30 s tick: the writes after the join can only arrive through hints, and
    // the writes before it only through the cursor.
    await Bun.sleep(40);

    const joined = await open(routeWith(instance.hub), viewer.token, {
      "last-event-id": cursor
    });

    await writer;

    const allSeen = () =>
      created.every((id) => changeIds(joined.events).has(id));

    await until(allSeen, 6_000);

    expect(allSeen()).toBe(true);
    joined.close();
    await joined.ended;
  });

  test("(c) tenant isolation: a hint of tenant B never wakes tenant A, and a tenant with no stream drops it", async () => {
    const instance = await startInstance(ROLES.two);
    const other = (await admin()`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES ('wk-two', 'Wake Two') RETURNING id
    `) as { id: string }[];
    const otherTenant = other[0]!.id;
    const woke = { a: 0, b: 0 };

    instance.hub.subscribe(otherTenant, INBOX, () => (woke.b += 1));

    const viewer = await seedUser(tenantId, "viewer", ROWS);
    const stream = await open(routeWith(instance.hub), viewer.token);

    await stream.waitFor((e) => e.event === "progress");
    instance.hub.subscribe(tenantId, INBOX, () => (woke.a += 1));

    const framesBefore = stream.events.length;

    await conversation(otherTenant);
    await conversation(otherTenant);
    await until(() => woke.b >= 1);
    await Bun.sleep(300);

    expect(woke.a).toBe(0);
    expect(stream.events.length).toBe(framesBefore);

    // And a hint of A's own tenant does wake A's stream.
    const own = await conversation(tenantId);

    await stream.waitFor((e) => changeIds([e]).has(own), 3_000);
    expect(woke.a).toBeGreaterThan(0);
    stream.close();
    await stream.ended;
  });

  test("(d) the NOTIFY payload is exactly a tenant id and a topic, whatever the row held", async () => {
    const probe = new Bun.SQL(urlFor(ROLES.probe), { max: 1, prepare: false });
    const payloads: string[] = [];

    try {
      await probe.listen(REALTIME_WAKE_CHANNEL, (raw: string) =>
        payloads.push(raw)
      );

      // A whatsapp row full of recognisable personal data, and an inbox row.
      await admin()`
        INSERT INTO awcms_whatsapp_messages
          (tenant_id, idempotency_key, template_key, purpose, recipient,
           recipient_hash, recipient_masked, body, status, sender_selection)
        VALUES (${tenantId}, 'wk-1', 'it1171.t', 'transactional',
                '+6281299990000', 'k1:secret-hash', '+62*****0000',
                'SECRET-BODY-OTP-123456', 'queued', 'deployment')
      `;
      await conversation(tenantId);
      await admin()`
        UPDATE awcms_whatsapp_messages SET status = 'sent', updated_at = now()
        WHERE tenant_id = ${tenantId}
      `;
      await until(() => payloads.length >= 3);
    } finally {
      await probe.close({ timeout: 0 });
    }

    expect(payloads.length).toBeGreaterThanOrEqual(3);

    for (const raw of payloads) {
      expect(raw.length).toBeLessThan(150);
      expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["k", "t"]);
      expect(JSON.parse(raw).t).toBe(tenantId);
      expect(raw).not.toMatch(/SECRET|6281299990000|secret-hash/);
    }

    expect(new Set(payloads.map((p) => JSON.parse(p).k))).toEqual(
      new Set(["whatsapp.sender.progress", INBOX])
    );
  });

  test("a write that rolls back, and an update that changes nothing relevant, notify nobody", async () => {
    const probe = new Bun.SQL(urlFor(ROLES.probe), { max: 1, prepare: false });
    const payloads: string[] = [];

    try {
      await probe.listen(REALTIME_WAKE_CHANNEL, (raw: string) =>
        payloads.push(raw)
      );

      const id = await conversation(tenantId);

      await until(() => payloads.length >= 1);
      payloads.length = 0;

      await admin()
        .begin(async (tx) => {
          await tx`
            UPDATE awcms_inbox_conversations SET status = 'resolved',
              updated_at = now() WHERE id = ${id}
          `;
          throw new Error("rollback on purpose");
        })
        .catch(() => undefined);
      await admin()`
        UPDATE awcms_inbox_conversations SET status = status WHERE id = ${id}
      `;
      await Bun.sleep(300);
    } finally {
      await probe.close({ timeout: 0 });
    }

    expect(payloads).toEqual([]);
  });

  test("the listener refuses a SUPERUSER or BYPASSRLS login for good, and never retries", async () => {
    for (const role of [ROLES.superuser, ROLES.bypass]) {
      const states: string[] = [];
      const listener = startWakeListener({
        url: urlFor(role),
        initialBackoffMs: 10,
        onPayload: () => undefined,
        onReconnected: () => undefined,
        onStateChange: (state) => states.push(state)
      });

      started.push(listener);
      await until(() => listener.state() === "refused");
      await Bun.sleep(150);

      expect(states).not.toContain("listening");
      expect(states.filter((s) => s === "connecting").length).toBe(1);
      expect(await backendsOf(role)).toBe(0);
    }
  });

  test("after its connection is killed the listener reconnects as ONE backend, catches up, and delivers again", async () => {
    const instance = await startInstance(ROLES.reconnect);
    let woken = 0;

    instance.hub.subscribe(tenantId, INBOX, () => (woken += 1));
    expect(await backendsOf(ROLES.reconnect)).toBe(1);
    expect(instance.wakeAllCalls()).toBe(1);

    await admin()`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE usename = ${ROLES.reconnect}
    `;
    await until(() => instance.wakeAllCalls() >= 2);
    await until(() => instance.listener.state() === "listening");
    // The catch-up wake: hints sent while it was down are gone.
    expect(woken).toBeGreaterThanOrEqual(1);
    await Bun.sleep(200);
    expect(await backendsOf(ROLES.reconnect)).toBe(1);

    const before = woken;

    await conversation(tenantId);
    await until(() => woken > before);
  });
});
