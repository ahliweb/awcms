/**
 * The `whatsapp.sender.progress` realtime topic end to end (Issue #1171,
 * ADR-0154): the REST snapshot and the SSE stream, through the real routes and
 * the real factory, against a real PostgreSQL with real sessions.
 *
 * Covers the ADR's required tests that a database can answer: two tenants, two
 * brands (business scopes), a role revoked during a stream, a business scope
 * removed during a stream, an expired session, malicious / cross-tenant /
 * hidden resource ids, wrong Origin, reconnect with a cursor, a foreign,
 * malformed or purged cursor, a change set too large for one frame, the
 * connection caps, client departure releasing its slot, a provider failure
 * visible from the row, a "restart" (a second, fresh route instance resuming
 * from the same cursor) and two instances reading the same cursor.
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
import { seedMetaWabaContainer } from "./meta-waba-fixture";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { defineProgressSseRoute } from "../../src/modules/_shared/progress-sse-route";
import { createSseConnectionRegistry } from "../../src/modules/_shared/sse-progress";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import {
  parseSenderCursor,
  whatsappSenderProgressTopic
} from "../../src/modules/whatsapp-delivery/application/whatsapp-sender-progress";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { GET as getSnapshot } from "../../src/pages/api/v1/whatsapp/senders/[id]/progress";
import { GET as productionStream } from "../../src/pages/api/v1/whatsapp/senders/[id]/progress/stream";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const PROGRESS = ["whatsapp_delivery.progress.read"];

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};
type Snapshot = {
  cursor: string;
  counts: Record<string, number>;
  recent: { id: string; status: string }[];
};
type SseEvent = { event: string; id?: string; data: unknown };

let tenantId = "";
let ownerTenantUserId = "";
let counter = 0;
let phone = 3_000_000_000_000;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "rt-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Realtime Co",
      tenantCode: "rt-one",
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
      reason: "realtime progress fixture"
    })
  );

  return { token, tenantUserId: tenantUser[0]!.id, roleId: role[0]!.id };
}

async function seedOffice(code: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${tenantId}, ${code}, ${`Office ${code}`}) RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/**
 * An assignment ALREADY IN FORCE when the next request starts.
 *
 * `effective_from` is stated, not defaulted (#1171 flake): the column defaults to
 * the database's `now()` (microseconds), while a request compares it with its own
 * `new Date()` (milliseconds, truncated). A request that began within the same
 * millisecond — about 1 ms after the insert on a fast runner — saw the
 * assignment as not yet effective. `startsIn` writes a PENDING one on purpose.
 */
async function holdScope(
  tenantUserId: string,
  officeId: string,
  startsIn = "-1 minute"
) {
  await admin()`
    INSERT INTO awcms_business_scope_assignments
      (tenant_id, tenant_user_id, scope_type, scope_id,
       granted_by_tenant_user_id, effective_from)
    VALUES (${tenantId}, ${tenantUserId}, 'office', ${officeId},
            ${ownerTenantUserId}, now() + ${startsIn}::interval)
  `;
}

async function seedSender(
  tenant: string,
  officeId: string | null
): Promise<string> {
  phone += 1;
  // Issue #1143: a Meta number sends only under a live WABA container.
  const wabaId = await seedMetaWabaContainer(admin(), tenant, `waba-${phone}`);
  const rows = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider,
       account_kind, external_id, display_name, auth_mode, status,
       parent_account_id, access_mode)
    VALUES (${tenant}, ${officeId ? "office" : null}, ${officeId},
            'whatsapp_cloud', 'waba_phone_number', ${String(phone)},
            ${`n-${phone}`}, 'api_token', 'connected', ${wabaId}, 'tenant_wide')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** A queue row with a recognisable recipient and body, so a leak is detectable. */
async function queueRow(
  tenant: string,
  senderId: string,
  status = "queued",
  officeId: string | null = null
): Promise<string> {
  counter += 1;
  const rows = (await admin()`
    INSERT INTO awcms_whatsapp_messages
      (tenant_id, idempotency_key, template_key, purpose, recipient,
       recipient_hash, recipient_masked, body, status, sender_account_id,
       sender_selection, business_scope_type, business_scope_id)
    VALUES (${tenant}, ${`rt-${counter}`}, 'it1171.t', 'transactional',
            '+6281299990000', 'k1:secret-hash', '+62*****0000',
            'SECRET-BODY-OTP-123456', ${status}, ${senderId}, 'explicit',
            ${officeId ? "office" : null}, ${officeId})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function setStatus(
  messageId: string,
  status: string,
  failureCode?: string
) {
  // A fresh transaction per call, so `updated_at = now()` advances.
  await admin()`
    UPDATE awcms_whatsapp_messages
    SET status = ${status}, failure_code = ${failureCode ?? null},
        last_error = ${failureCode ? "provider said: +6281299990000 rejected" : null},
        updated_at = now()
    WHERE id = ${messageId}
  `;
}

function headersFor(token: string, extra: Record<string, string> = {}) {
  return {
    "x-awcms-tenant-id": tenantId,
    authorization: `Bearer ${token}`,
    ...extra
  };
}

function snapshot(token: string, id: string) {
  return invoke<Envelope<Snapshot>>(getSnapshot, {
    path: `/api/v1/whatsapp/senders/${id}/progress`,
    params: { id },
    headers: headersFor(token),
    locals: { correlationId: "corr-it1171" }
  });
}

/** A test route: the production topic and factory, with test-sized numbers. */
function testRoute(options: {
  topic?: typeof whatsappSenderProgressTopic;
  connections?: ReturnType<typeof createSseConnectionRegistry>;
  maxConnectionMs?: number;
  maxChangesPerFrame?: number;
  env?: NodeJS.ProcessEnv;
}): APIRoute {
  return defineProgressSseRoute({
    topic: options.topic ?? whatsappSenderProgressTopic,
    workClass: "interactive",
    tickIntervalMs: 40,
    heartbeatMs: 10_000,
    maxConnectionMs: options.maxConnectionMs ?? 60_000,
    maxChangesPerFrame: options.maxChangesPerFrame ?? 50,
    maxFrameBytes: 16_384,
    retryMs: 1_000,
    connections: options.connections ?? createSseConnectionRegistry(),
    env: options.env ?? { ...process.env, APP_URL: "https://app.example" }
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
  id: string,
  extraHeaders: Record<string, string> = {}
): Promise<OpenStream> {
  const controller = new AbortController();
  const url = new URL(
    `https://app.example/api/v1/whatsapp/senders/${id}/progress/stream`
  );
  const request = new Request(url, {
    headers: headersFor(token, extraHeaders),
    signal: controller.signal
  });
  const response = await route({
    request,
    url,
    params: { id },
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

const progressWith =
  (predicate: (data: Record<string, unknown>) => boolean) =>
  (event: SseEvent) =>
    event.event === "progress" &&
    predicate(event.data as Record<string, unknown>);

setDefaultTimeout(30_000);

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("realtime progress stream: whatsapp.sender.progress (#1171)", () => {
  beforeAll(async () => {
    savedEnv.CHANNEL_ACCOUNTS_ENABLED = process.env.CHANNEL_ACCOUNTS_ENABLED;
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    if (savedEnv.CHANNEL_ACCOUNTS_ENABLED === undefined) {
      delete process.env.CHANNEL_ACCOUNTS_ENABLED;
    } else {
      process.env.CHANNEL_ACCOUNTS_ENABLED = savedEnv.CHANNEL_ACCOUNTS_ENABLED;
    }

    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    expect(handlerReady, "the handler database must be available").toBe(true);
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    await resetHandlerDatabase();
    await bootstrap();
  });

  test("snapshot: two brands, two tenants, malicious ids, missing permission — one 404 for everything not visible", async () => {
    const brandA = await seedOffice("brand-a");
    const brandB = await seedOffice("brand-b");
    const senderA = await seedSender(tenantId, brandA);
    const senderB = await seedSender(tenantId, brandB);

    await queueRow(tenantId, senderA, "queued", brandA);
    await queueRow(tenantId, senderA, "sent", brandA);
    await queueRow(tenantId, senderB, "queued", brandB);

    const tenant2 = crypto.randomUUID();

    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${tenant2}, 'rt-two', 'Realtime Two')
    `;
    const foreignSender = await seedSender(tenant2, null);

    await queueRow(tenant2, foreignSender);

    const confinedA = await seedUser(tenantId, "brand-a-viewer", PROGRESS);

    await holdScope(confinedA.tenantUserId, brandA);

    const own = await snapshot(confinedA.token, senderA);

    expect(own.status).toBe(200);
    expect(own.body.data?.counts.queued).toBe(1);
    expect(own.body.data?.counts.sent).toBe(1);
    expect(own.body.data?.recent).toHaveLength(2);
    expect(JSON.stringify(own.body)).not.toContain("SECRET-BODY");
    expect(JSON.stringify(own.body)).not.toContain("6281299990000");

    for (const id of [
      senderB, // another brand
      foreignSender, // another tenant
      crypto.randomUUID(), // unknown
      "../../etc", // malformed
      "1 OR 1=1"
    ]) {
      const response = await snapshot(confinedA.token, id);

      expect(response.status).toBe(404);
      expect(response.body.error?.code).toBe("NOT_FOUND");
    }

    const noPermission = await seedUser(tenantId, "nobody", []);

    expect((await snapshot(noPermission.token, senderA)).status).toBe(403);
  });

  test("opening: wrong Origin, hidden/foreign/malformed id and missing auth open no stream; the production route honours them too", async () => {
    const brandA = await seedOffice("brand-a");
    const brandB = await seedOffice("brand-b");
    const senderA = await seedSender(tenantId, brandA);
    const senderB = await seedSender(tenantId, brandB);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);

    await holdScope(viewer.tenantUserId, brandA);

    for (const route of [testRoute({}), productionStream]) {
      const evil = await open(route, viewer.token, senderA, {
        origin: "https://evil.example"
      });

      expect(evil.response.status).toBe(403);
      expect(evil.response.headers.get("content-type")).toContain(
        "application/json"
      );

      for (const id of [senderB, crypto.randomUUID(), "x'--"]) {
        const hidden = await open(route, viewer.token, id);

        expect(hidden.response.status).toBe(404);
      }

      const anonymous = await open(route, "not-a-session", senderA);

      expect(anonymous.response.status).toBe(401);
    }

    const sameOrigin = await open(testRoute({}), viewer.token, senderA, {
      origin: "https://app.example"
    });

    expect(sameOrigin.response.status).toBe(200);
    expect(sameOrigin.response.headers.get("content-type")).toContain(
      "text/event-stream"
    );
    expect(sameOrigin.response.headers.get("cache-control")).toContain(
      "no-store"
    );
    expect(sameOrigin.response.headers.get("x-accel-buffering")).toBe("no");
    sameOrigin.close();
    await sameOrigin.ended;
  });

  test("live: a change committed to the row arrives as a frame with a database cursor; a provider failure is visible from the row; nothing personal is streamed", async () => {
    const sender = await seedSender(tenantId, null);
    const first = await queueRow(tenantId, sender);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    const stream = await open(testRoute({}), viewer.token, sender);

    expect(stream.response.status).toBe(200);

    const opening = await stream.waitFor((e) => e.event === "progress");
    const openingData = opening.data as {
      counts: Record<string, number>;
      cursor: string;
      v: number;
    };

    expect(openingData.v).toBe(1);
    expect(openingData.counts.queued).toBe(1);
    expect(opening.id).toBe(openingData.cursor);
    expect(parseSenderCursor(opening.id!)?.messageId).toBe(first);

    await setStatus(first, "failed", "PROVIDER_REJECTED");

    const failed = await stream.waitFor(
      progressWith((d) => (d.counts as Record<string, number>).failed === 1)
    );
    const failedData = failed.data as {
      changes: { id: string; status: string }[];
    };

    expect(failedData.changes).toEqual([
      expect.objectContaining({ id: first, status: "failed" })
    ]);

    const serialized = JSON.stringify(stream.events);

    expect(serialized).not.toContain("SECRET-BODY");
    expect(serialized).not.toContain("6281299990000");
    expect(serialized).not.toContain("provider said");
    expect(serialized).not.toContain("secret-hash");

    stream.close();
    await stream.ended;
  });

  test("role revoked during the stream ends it with authorization-revoked, audited", async () => {
    const sender = await seedSender(tenantId, null);

    await queueRow(tenantId, sender);

    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    const stream = await open(testRoute({}), viewer.token, sender);

    await stream.waitFor((e) => e.event === "progress");
    await admin()`DELETE FROM awcms_role_permissions WHERE role_id = ${viewer.roleId}`;

    const revoked = await stream.waitFor(
      (e) => e.event === "authorization-revoked"
    );

    expect((revoked.data as { status: number }).status).toBe(403);
    await stream.ended;

    const audit = (await admin()`
      SELECT action, resource_id, actor_tenant_user_id, attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${tenantId} AND action = 'realtime_stream.revoked'
    `) as {
      resource_id: string;
      actor_tenant_user_id: string;
      attributes: { topic: string };
    }[];

    expect(audit).toHaveLength(1);
    expect(audit[0]!.resource_id).toBe(sender);
    expect(audit[0]!.actor_tenant_user_id).toBe(viewer.tenantUserId);
    expect(audit[0]!.attributes.topic).toBe("whatsapp.sender.progress");
  });

  test("a business scope (brand) removed during the stream ends it", async () => {
    const brandA = await seedOffice("brand-a");
    const sender = await seedSender(tenantId, brandA);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);

    await holdScope(viewer.tenantUserId, brandA);

    const stream = await open(testRoute({}), viewer.token, sender);

    expect(stream.response.status).toBe(200);
    await stream.waitFor((e) => e.event === "progress");
    await admin()`
      DELETE FROM awcms_business_scope_assignments
      WHERE tenant_user_id = ${viewer.tenantUserId}
    `;
    // Holding no scope at all would make the caller tenant-wide again; give
    // them a DIFFERENT brand, which is what a reassignment looks like.
    const brandB = await seedOffice("brand-b");

    await holdScope(viewer.tenantUserId, brandB);
    await stream.waitFor((e) => e.event === "authorization-revoked");
    await stream.ended;
  });

  test("an expired session ends the stream as a revocation (401)", async () => {
    const sender = await seedSender(tenantId, null);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    const stream = await open(testRoute({}), viewer.token, sender);

    await stream.waitFor((e) => e.event === "progress");
    await admin()`
      UPDATE awcms_sessions SET expires_at = now() - interval '1 second'
      WHERE token_hash = ${hashSessionToken(viewer.token)}
    `;

    const revoked = await stream.waitFor(
      (e) => e.event === "authorization-revoked"
    );

    expect((revoked.data as { status: number }).status).toBe(401);
  });

  test("reconnect with Last-Event-ID resumes after the cursor; a restarted (fresh) instance and a second instance resume identically", async () => {
    const sender = await seedSender(tenantId, null);
    const m1 = await queueRow(tenantId, sender);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    const first = await open(testRoute({}), viewer.token, sender);
    const opening = await first.waitFor((e) => e.event === "progress");

    first.close();
    await first.ended;

    // Changes while disconnected.
    await setStatus(m1, "sent");
    const m2 = await queueRow(tenantId, sender);

    // Two route instances with their own (empty) in-memory state: a restart,
    // and a second replica. Both read the same durable cursor.
    for (const route of [testRoute({}), testRoute({})]) {
      const resumed = await open(route, viewer.token, sender, {
        "last-event-id": opening.id!
      });
      const frame = await resumed.waitFor((e) => e.event === "progress");
      const data = frame.data as {
        changes: { id: string; status: string }[];
        counts: Record<string, number>;
      };

      expect(resumed.events.some((e) => e.event === "snapshot-required")).toBe(
        false
      );
      expect(data.changes.map((c) => [c.id, c.status])).toEqual([
        [m1, "sent"],
        [m2, "queued"]
      ]);
      expect(data.counts.sent).toBe(1);
      expect(parseSenderCursor(frame.id!)?.messageId).toBe(m2);
      resumed.close();
      await resumed.ended;
    }
  });

  test("a malformed, foreign-sender, foreign-tenant or purged cursor yields snapshot-required, never a guess", async () => {
    const sender = await seedSender(tenantId, null);
    const other = await seedSender(tenantId, null);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    const doomed = await queueRow(tenantId, sender);
    const otherRow = await queueRow(tenantId, other);
    const tenant2 = crypto.randomUUID();

    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${tenant2}, 'rt-three', 'Realtime Three')
    `;
    const foreignSender = await seedSender(tenant2, null);
    const foreignRow = await queueRow(tenant2, foreignSender);

    const route = testRoute({});
    const takeCursor = async (id: string) => {
      const s = await open(route, viewer.token, id);
      const frame = await s.waitFor((e) => e.event === "progress");

      s.close();
      await s.ended;
      return frame.id!;
    };
    const purgedCursor = await takeCursor(sender);

    expect(parseSenderCursor(purgedCursor)?.messageId).toBe(doomed);

    const otherCursor = await takeCursor(other);

    expect(parseSenderCursor(otherCursor)?.messageId).toBe(otherRow);

    await admin()`DELETE FROM awcms_whatsapp_messages WHERE id = ${doomed}`;
    await queueRow(tenantId, sender);

    const fabricatedForeign = `wsp1.${sender}.1.${foreignRow}`;

    for (const cursor of [
      "garbage",
      "x".repeat(400),
      otherCursor, // another sender's cursor
      fabricatedForeign, // another tenant's row, this sender's id
      purgedCursor // the row is gone
    ]) {
      const s = await open(route, viewer.token, sender, {
        "last-event-id": cursor
      });
      const required = await s.waitFor((e) => e.event === "snapshot-required");

      expect((required.data as { reason: string }).reason).toBe(
        "cursor_unknown"
      );
      // ...followed by the current counts at the head.
      await s.waitFor((e) => e.event === "progress");
      s.close();
      await s.ended;
    }
  });

  test("more changes than one frame may carry becomes snapshot-required, not a bigger frame", async () => {
    const sender = await seedSender(tenantId, null);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    const stream = await open(
      testRoute({ maxChangesPerFrame: 3 }),
      viewer.token,
      sender
    );

    await stream.waitFor((e) => e.event === "progress");

    // ONE statement, so all five commit together and no tick can split them.
    await admin()`
      INSERT INTO awcms_whatsapp_messages
        (tenant_id, idempotency_key, template_key, purpose, recipient,
         recipient_hash, recipient_masked, body, status, sender_account_id,
         sender_selection)
      SELECT ${tenantId}, 'bulk-' || g, 'it1171.t', 'transactional',
             '+6281299990000', 'k1:x', '+62*', 'x', 'queued', ${sender},
             'explicit'
      FROM generate_series(1, 5) AS g
    `;

    const required = await stream.waitFor(
      (e) => e.event === "snapshot-required"
    );

    expect((required.data as { reason: string }).reason).toBe(
      "too_many_changes"
    );

    const after = await stream.waitFor(
      progressWith((d) => (d.counts as Record<string, number>).queued === 5)
    );

    expect((after.data as { changes: unknown[] }).changes).toEqual([]);
    stream.close();
    await stream.ended;
  });

  test("caps: over the per-actor cap is 429 with Retry-After; a departed client returns its slot", async () => {
    const sender = await seedSender(tenantId, null);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    const connections = createSseConnectionRegistry();
    const route = testRoute({
      connections,
      env: {
        ...process.env,
        APP_URL: "https://app.example",
        REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR: "1"
      }
    });
    const first = await open(route, viewer.token, sender);

    expect(first.response.status).toBe(200);
    expect(connections.openCount()).toBe(1);

    const second = await open(route, viewer.token, sender);

    expect(second.response.status).toBe(429);
    expect(second.response.headers.get("retry-after")).toBe("30");

    first.close();
    await first.ended;
    // The loop observes the abort on its own wake-up, not after a tick.
    for (let i = 0; i < 50 && connections.openCount() > 0; i += 1) {
      await Bun.sleep(10);
    }
    expect(connections.openCount()).toBe(0);

    const third = await open(route, viewer.token, sender);

    expect(third.response.status).toBe(200);
    third.close();
    await third.ended;
  });

  test("the lifetime ceiling ends with stream-expired and returns the slot", async () => {
    const sender = await seedSender(tenantId, null);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    const connections = createSseConnectionRegistry();
    const stream = await open(
      testRoute({ connections, maxConnectionMs: 200 }),
      viewer.token,
      sender
    );

    await stream.waitFor((e) => e.event === "stream-expired");
    await stream.ended;
    expect(connections.openCount()).toBe(0);
  });

  test("a TENANT-WIDE sender, two brands: a viewer confined to brand A sees only brand A's rows (REST and stream), never brand B's or unscoped ones (audit M-1)", async () => {
    const brandA = await seedOffice("brand-a");
    const brandB = await seedOffice("brand-b");
    const sender = await seedSender(tenantId, null);
    const a1 = await queueRow(tenantId, sender, "queued", brandA);
    const a2 = await queueRow(tenantId, sender, "sent", brandA);
    const b1 = await queueRow(tenantId, sender, "failed", brandB);
    // Newest of all, and unscoped: it must not even become the cursor.
    const unscoped = await queueRow(tenantId, sender, "queued", null);
    const confined = await seedUser(tenantId, "brand-a-only", PROGRESS);
    const unconfined = await seedUser(tenantId, "everyone", PROGRESS);

    await holdScope(confined.tenantUserId, brandA);

    // REST snapshot.
    const mine = await snapshot(confined.token, sender);

    expect(mine.status).toBe(200);
    expect(mine.body.data?.counts).toMatchObject({
      queued: 1,
      sent: 1,
      failed: 0
    });
    expect(mine.body.data?.recent.map((r) => r.id).sort()).toEqual(
      [a1, a2].sort()
    );
    expect(parseSenderCursor(mine.body.data!.cursor)?.messageId).toBe(a2);
    expect(JSON.stringify(mine.body)).not.toContain(b1);
    expect(JSON.stringify(mine.body)).not.toContain(unscoped);

    const all = await snapshot(unconfined.token, sender);

    expect(all.body.data?.counts).toMatchObject({
      queued: 2,
      sent: 1,
      failed: 1
    });
    expect(all.body.data?.recent).toHaveLength(4);

    // Stream: the first frame, then live changes on both brands.
    const stream = await open(testRoute({}), confined.token, sender);

    expect(stream.response.status).toBe(200);

    const first = await stream.waitFor((e) => e.event === "progress");

    expect(parseSenderCursor(first.id!)?.messageId).toBe(a2);
    expect(
      (first.data as { counts: Record<string, number> }).counts
    ).toMatchObject({ queued: 1, sent: 1, failed: 0 });

    await setStatus(b1, "sent");
    const b2 = await queueRow(tenantId, sender, "queued", brandB);
    const unscoped2 = await queueRow(tenantId, sender, "queued", null);

    await setStatus(a1, "sent");

    const changed = await stream.waitFor(
      progressWith((d) => (d.counts as Record<string, number>).sent === 2)
    );

    expect(
      (changed.data as { changes: { id: string }[] }).changes.map((c) => c.id)
    ).toEqual([a1]);
    expect(
      (changed.data as { counts: Record<string, number> }).counts
    ).toMatchObject({ queued: 0, sent: 2, failed: 0 });

    const everything = JSON.stringify(stream.events);

    for (const hidden of [b1, b2, unscoped, unscoped2]) {
      expect(everything).not.toContain(hidden);
    }

    stream.close();
    await stream.ended;

    // A cursor naming a row this caller may not see is not honoured.
    const foreignCursor = all.body.data!.cursor;

    expect(parseSenderCursor(foreignCursor)?.messageId).toBe(unscoped);

    const resumed = await open(testRoute({}), confined.token, sender, {
      "last-event-id": foreignCursor
    });

    await resumed.waitFor((e) => e.event === "snapshot-required");
    resumed.close();
    await resumed.ended;
  });

  test("a confinement that has not STARTED yet still confines: the viewer sees no row of a tenant-wide sender, never every brand's (#1171 flake, fail-closed)", async () => {
    // The CI flake was this case by accident: the brand-A assignment was one
    // the request's clock judged not yet in force, so the viewer was treated as
    // tenant-wide and was shown brand B's and unscoped rows. Here the
    // assignment starts in an hour, so the window is deterministic.
    const brandA = await seedOffice("brand-a");
    const brandB = await seedOffice("brand-b");
    const sender = await seedSender(tenantId, null);
    const a1 = await queueRow(tenantId, sender, "queued", brandA);
    const b1 = await queueRow(tenantId, sender, "failed", brandB);
    const unscoped = await queueRow(tenantId, sender, "queued", null);
    const pending = await seedUser(tenantId, "brand-a-soon", PROGRESS);

    await holdScope(pending.tenantUserId, brandA, "1 hour");

    const mine = await snapshot(pending.token, sender);

    expect(mine.status).toBe(200);
    expect(Object.values(mine.body.data!.counts).every((n) => n === 0)).toBe(
      true
    );
    expect(mine.body.data?.recent).toEqual([]);
    expect(parseSenderCursor(mine.body.data!.cursor)?.micros).toBe("0");

    const stream = await open(testRoute({}), pending.token, sender);

    expect(stream.response.status).toBe(200);

    const first = await stream.waitFor((e) => e.event === "progress");
    const counts = (first.data as { counts: Record<string, number> }).counts;

    expect(Object.values(counts).every((n) => n === 0)).toBe(true);

    await setStatus(b1, "sent");
    await setStatus(a1, "sent");
    // Two ticks past both changes: nothing may have been streamed.
    await Bun.sleep(200);

    const everything = JSON.stringify(stream.events);

    for (const hidden of [a1, b1, unscoped]) {
      expect(everything).not.toContain(hidden);
    }

    stream.close();
    await stream.ended;
  });

  test("the connection slot is taken after authorize and BEFORE any topic query: a 429 costs no resource read, and a 404 returns its slot (audit M-2a)", async () => {
    const sender = await seedSender(tenantId, null);
    const viewer = await seedUser(tenantId, "viewer", PROGRESS);
    let resolves = 0;
    const spy: typeof whatsappSenderProgressTopic = {
      ...whatsappSenderProgressTopic,
      resolveResource: async (context, resourceId) => {
        resolves += 1;
        return whatsappSenderProgressTopic.resolveResource(context, resourceId);
      }
    };
    const connections = createSseConnectionRegistry();
    const route = testRoute({
      topic: spy,
      connections,
      env: {
        ...process.env,
        APP_URL: "https://app.example",
        REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR: "1"
      }
    });

    // The actor's one slot is held (as by an open stream elsewhere).
    const parked = connections.tryAcquire(tenantId, viewer.tenantUserId, {
      perActor: 10,
      perTenant: 10,
      perInstance: 10
    });

    expect(parked.ok).toBe(true);

    const refused = await open(route, viewer.token, sender);

    expect(refused.response.status).toBe(429);
    expect(resolves).toBe(0);

    if (parked.ok) parked.lease.release();
    expect(connections.openCount()).toBe(0);

    const missing = await open(route, viewer.token, crypto.randomUUID());

    expect(missing.response.status).toBe(404);
    expect(resolves).toBe(1);
    expect(connections.openCount()).toBe(0);
  });
});
