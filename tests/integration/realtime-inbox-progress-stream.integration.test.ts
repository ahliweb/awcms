/**
 * The `inbox.status.progress` realtime topic end to end (Issue #1171, ADR-0154
 * task 3): the REST snapshot and the SSE stream of the omnichannel inbox's live
 * work counts, through the real routes and the real factory, against a real
 * PostgreSQL with real sessions.
 *
 * Covers what a database can answer: two tenants, two brands, a role revoked
 * during a stream, a business scope removed during a stream, an expired session,
 * wrong Origin, the module switched off, reconnect with a cursor, a foreign or
 * malformed cursor, the connection cap, a change set too large for one frame,
 * and that nothing personal or referential is streamed.
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
import { defineProgressSseRoute } from "../../src/modules/_shared/progress-sse-route";
import { createSseConnectionRegistry } from "../../src/modules/_shared/sse-progress";
import { invalidatePolicyCache } from "../../src/modules/identity-access/application/policy-cache";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import {
  inboxStatusProgressTopic,
  parseInboxCursor
} from "../../src/modules/omnichannel-inbox/application/inbox-status-progress";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { GET as getSnapshot } from "../../src/pages/api/v1/omnichannel-inbox/progress";
import { GET as productionStream } from "../../src/pages/api/v1/omnichannel-inbox/progress/stream";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const STATUS = ["omnichannel_inbox.status.read"];
/** What a viewer needs to see conversation ids in a frame: the counts permission AND the list permission (audit L-1). */
const ROWS = [...STATUS, "omnichannel_inbox.conversations.read"];

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
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "ib-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Inbox Co",
      tenantCode: "ib-one",
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
      reason: "inbox progress fixture"
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

async function touch(conversationId: string, status: string) {
  // A fresh transaction per call, so `updated_at = now()` advances.
  await admin()`
    UPDATE awcms_inbox_conversations
    SET status = ${status}, updated_at = now()
    WHERE id = ${conversationId}
  `;
}

function headersFor(token: string, extra: Record<string, string> = {}) {
  return {
    "x-awcms-tenant-id": tenantId,
    authorization: `Bearer ${token}`,
    ...extra
  };
}

function snapshot(token: string) {
  return invoke<Envelope<Snapshot>>(getSnapshot, {
    path: "/api/v1/omnichannel-inbox/progress",
    headers: headersFor(token),
    locals: { correlationId: "corr-it1171-inbox" }
  });
}

/** A test route: the production topic and factory, with test-sized numbers. */
function testRoute(options: {
  connections?: ReturnType<typeof createSseConnectionRegistry>;
  maxChangesPerFrame?: number;
  env?: NodeJS.ProcessEnv;
}): APIRoute {
  return defineProgressSseRoute({
    topic: inboxStatusProgressTopic,
    workClass: "interactive",
    tickIntervalMs: 40,
    heartbeatMs: 10_000,
    maxConnectionMs: 60_000,
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

const progressWith =
  (predicate: (data: Record<string, unknown>) => boolean) =>
  (event: SseEvent) =>
    event.event === "progress" &&
    predicate(event.data as Record<string, unknown>);

setDefaultTimeout(30_000);

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("realtime progress stream: inbox.status.progress (#1171)", () => {
  beforeAll(async () => {
    for (const name of [
      "OMNICHANNEL_INBOX_ENABLED",
      "CHANNEL_ACCOUNTS_ENABLED"
    ]) {
      savedEnv[name] = process.env[name];
    }
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
    process.env.OMNICHANNEL_INBOX_ENABLED = "true";
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    await resetHandlerDatabase();
    await bootstrap();
  });

  test("snapshot: active-work counts; a confined viewer sees only its brand and never a tenant-wide conversation; permission required; off is 404", async () => {
    const brandA = await seedOffice("brand-a");
    const brandB = await seedOffice("brand-b");
    const aOpen = await conversation(tenantId, {
      officeId: brandA,
      awaiting: true,
      due: "past"
    });

    await conversation(tenantId, {
      officeId: brandA,
      status: "pending",
      assignee: ownerTenantUserId
    });
    await conversation(tenantId, { officeId: brandA, status: "resolved" });
    await conversation(tenantId, { officeId: brandB });
    await conversation(tenantId, { officeId: null });

    const wide = await seedUser(tenantId, "wide", ROWS);
    const wideSnap = await snapshot(wide.token);

    expect(wideSnap.status).toBe(200);
    // open: aOpen, brandB, tenant-wide; pending: 1; resolved is not counted.
    expect(wideSnap.body.data!.counts).toEqual({
      open: 3,
      pending: 1,
      awaitingReply: 1,
      unassigned: 3,
      slaBreached: 1
    });
    expect(parseInboxCursor(wideSnap.body.data!.cursor)).not.toBeNull();
    expect(wideSnap.body.data!.recent.length).toBe(5);

    const confined = await seedUser(tenantId, "confined", ROWS);

    await holdScope(confined.tenantUserId, brandA);

    const confinedSnap = await snapshot(confined.token);

    expect(confinedSnap.status).toBe(200);
    expect(confinedSnap.body.data!.counts.open).toBe(1);
    expect(confinedSnap.body.data!.counts.pending).toBe(1);
    expect(confinedSnap.body.data!.recent.map((r) => r.id)).toContain(aOpen);
    expect(confinedSnap.body.data!.recent.length).toBe(3);

    const listOnly = await seedUser(tenantId, "listonly", [
      "omnichannel_inbox.conversations.read"
    ]);

    expect((await snapshot(listOnly.token)).status).toBe(403);
    expect((await snapshot("bogus-token")).status).toBe(401);

    delete process.env.OMNICHANNEL_INBOX_ENABLED;
    expect((await snapshot(wide.token)).status).toBe(404);
  });

  test("opening: wrong Origin, missing auth, no permission and a switched-off inbox open no stream; the production route honours them too", async () => {
    await conversation(tenantId);

    const viewer = await seedUser(tenantId, "viewer", STATUS);
    const noPerm = await seedUser(tenantId, "noperm", []);
    const route = testRoute({});
    const evil = { origin: "https://evil.example" };

    expect((await open(route, viewer.token, evil)).response.status).toBe(403);
    expect((await open(route, "bogus-token")).response.status).toBe(401);
    expect((await open(route, noPerm.token)).response.status).toBe(403);
    expect(
      (await open(productionStream, viewer.token, evil)).response.status
    ).toBe(403);

    delete process.env.OMNICHANNEL_INBOX_ENABLED;
    expect((await open(route, viewer.token)).response.status).toBe(404);
  });

  test("live: a change committed to the row arrives as a frame with a database cursor; only ids, statuses and times are streamed", async () => {
    const first = await conversation(tenantId, { awaiting: true });
    const viewer = await seedUser(tenantId, "viewer", ROWS);
    const stream = await open(testRoute({}), viewer.token);

    expect(stream.response.status).toBe(200);

    const opening = await stream.waitFor((e) => e.event === "progress");
    const openingData = opening.data as {
      counts: Record<string, number>;
      cursor: string;
      v: number;
    };

    expect(openingData.v).toBe(1);
    expect(openingData.counts.open).toBe(1);
    expect(openingData.counts.awaitingReply).toBe(1);
    expect(opening.id).toBe(openingData.cursor);
    expect(parseInboxCursor(opening.id!)?.conversationId).toBe(first);

    await touch(first, "pending");

    const changed = await stream.waitFor(
      progressWith((d) => (d.counts as Record<string, number>).pending === 1)
    );

    expect((changed.data as { changes: unknown[] }).changes).toEqual([
      expect.objectContaining({ id: first, status: "pending" })
    ]);

    const serialized = JSON.stringify(stream.events);

    for (const key of [
      "sourceRef",
      "sourceKind",
      "channelAccount",
      "assignee",
      "tagIds",
      "businessScope"
    ]) {
      expect(serialized).not.toContain(key);
    }

    stream.close();
    await stream.ended;
  });

  test("a confined viewer's stream never carries another brand's or a tenant-wide conversation", async () => {
    const brandA = await seedOffice("brand-a");
    const brandB = await seedOffice("brand-b");
    const a = await conversation(tenantId, { officeId: brandA });
    const viewer = await seedUser(tenantId, "viewer", ROWS);

    await holdScope(viewer.tenantUserId, brandA);

    const stream = await open(testRoute({}), viewer.token);

    await stream.waitFor((e) => e.event === "progress");

    const b = await conversation(tenantId, { officeId: brandB });
    const wide = await conversation(tenantId, { officeId: null });

    await touch(a, "pending");
    await stream.waitFor(
      progressWith((d) => (d.counts as Record<string, number>).pending === 1)
    );
    await Bun.sleep(300);

    const serialized = JSON.stringify(stream.events);

    expect(serialized).not.toContain(b);
    expect(serialized).not.toContain(wide);
    expect(serialized).toContain(a);

    stream.close();
    await stream.ended;
  });

  test("role revoked during the stream ends it with authorization-revoked, audited", async () => {
    await conversation(tenantId);

    const viewer = await seedUser(tenantId, "viewer", STATUS);
    const stream = await open(testRoute({}), viewer.token);

    await stream.waitFor((e) => e.event === "progress");
    await admin()`DELETE FROM awcms_role_permissions WHERE role_id = ${viewer.roleId}`;

    const revoked = await stream.waitFor(
      (e) => e.event === "authorization-revoked"
    );

    expect((revoked.data as { status: number }).status).toBe(403);
    await stream.ended;

    const audit = (await admin()`
      SELECT actor_tenant_user_id, attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${tenantId} AND action = 'realtime_stream.revoked'
    `) as { actor_tenant_user_id: string; attributes: { topic: string } }[];

    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_tenant_user_id).toBe(viewer.tenantUserId);
    expect(audit[0]!.attributes.topic).toBe("inbox.status.progress");
  });

  test("a business scope (brand) swapped during the stream changes what the stream shows on the next tick, never keeping the old brand", async () => {
    const brandA = await seedOffice("brand-a");
    const brandB = await seedOffice("brand-b");
    const viewer = await seedUser(tenantId, "viewer", STATUS);

    await conversation(tenantId, { officeId: brandA });
    await holdScope(viewer.tenantUserId, brandA);

    const stream = await open(testRoute({}), viewer.token);

    expect(stream.response.status).toBe(200);

    const opening = await stream.waitFor((e) => e.event === "progress");

    expect((opening.data as { counts: { open: number } }).counts.open).toBe(1);

    await admin()`
      DELETE FROM awcms_business_scope_assignments
      WHERE tenant_user_id = ${viewer.tenantUserId}
    `;
    // Holding no scope at all would make the caller tenant-wide again; a
    // reassignment to a DIFFERENT brand is what removal looks like.
    await holdScope(viewer.tenantUserId, brandB);

    // Brand A's conversation leaves the visible set: counts fall to zero.
    await stream.waitFor(
      progressWith((d) => (d.counts as Record<string, number>).open === 0)
    );
    // Losing a business scope narrows the frames; it does not end the stream
    // (audit L-2: the contract says so).
    await Bun.sleep(150);
    expect(stream.events.some((e) => e.event === "authorization-revoked")).toBe(
      false
    );
    stream.close();
    await stream.ended;
  });

  test("an expired session ends the stream as a revocation (401)", async () => {
    await conversation(tenantId);

    const viewer = await seedUser(tenantId, "viewer", STATUS);
    const stream = await open(testRoute({}), viewer.token);

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

  test("reconnect with Last-Event-ID resumes after the cursor, also on a fresh instance; a malformed or unknown cursor is snapshot-required", async () => {
    const c1 = await conversation(tenantId);
    const viewer = await seedUser(tenantId, "viewer", ROWS);
    const first = await open(testRoute({}), viewer.token);
    const opening = await first.waitFor((e) => e.event === "progress");

    first.close();
    await first.ended;

    await touch(c1, "pending");

    const c2 = await conversation(tenantId);
    const resumed = await open(testRoute({}), viewer.token, {
      "last-event-id": opening.id!
    });
    const frame = await resumed.waitFor(
      progressWith((d) => (d.changes as unknown[]).length >= 1)
    );
    const ids = (frame.data as { changes: { id: string }[] }).changes.map(
      (c) => c.id
    );

    expect(ids).toContain(c1);
    expect(ids).toContain(c2);
    resumed.close();
    await resumed.ended;

    for (const bad of [
      "garbage",
      "inb1.1.00000000-0000-0000-0000-000000000099",
      `inb1.${"9".repeat(17)}.${c1}`
    ]) {
      const stream = await open(testRoute({}), viewer.token, {
        "last-event-id": bad
      });
      const required = await stream.waitFor(
        (e) => e.event === "snapshot-required"
      );

      expect((required.data as { reason: string }).reason).toBe(
        "cursor_unknown"
      );
      stream.close();
      await stream.ended;
    }
  });

  test("a change set too large for one frame becomes snapshot-required, not a bigger frame", async () => {
    const viewer = await seedUser(tenantId, "viewer", ROWS);
    const stream = await open(
      testRoute({ maxChangesPerFrame: 2 }),
      viewer.token
    );

    await stream.waitFor((e) => e.event === "progress");
    for (let i = 0; i < 4; i += 1) await conversation(tenantId);

    const required = await stream.waitFor(
      (e) => e.event === "snapshot-required"
    );

    expect((required.data as { reason: string }).reason).toBe(
      "too_many_changes"
    );
    stream.close();
    await stream.ended;
  });

  test("two tenants: a viewer of one never sees the other's conversations", async () => {
    const other = (await admin()`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES ('ib-two', 'Inbox Two') RETURNING id
    `) as { id: string }[];

    await conversation(other[0]!.id);
    await conversation(other[0]!.id);

    const viewer = await seedUser(tenantId, "viewer", STATUS);
    const snap = await snapshot(viewer.token);

    expect(snap.body.data!.counts.open).toBe(0);
    expect(snap.body.data!.recent).toEqual([]);
  });

  test("caps: over the per-actor cap is 429 with Retry-After; a departed client returns its slot", async () => {
    const viewer = await seedUser(tenantId, "viewer", STATUS);
    const connections = createSseConnectionRegistry();
    const route = testRoute({
      connections,
      env: {
        ...process.env,
        APP_URL: "https://app.example",
        REALTIME_SSE_MAX_CONNECTIONS_PER_ACTOR: "1"
      }
    });
    const first = await open(route, viewer.token);

    expect(first.response.status).toBe(200);
    expect(connections.openCount()).toBe(1);

    const second = await open(route, viewer.token);

    expect(second.response.status).toBe(429);
    expect(second.response.headers.get("retry-after")).toBe("30");

    first.close();
    await first.ended;
    for (let i = 0; i < 50 && connections.openCount() > 0; i += 1) {
      await Bun.sleep(10);
    }

    const third = await open(route, viewer.token);

    expect(third.response.status).toBe(200);
    third.close();
    await third.ended;
  });

  /** The decision-log rows an actor produced for the inbox. */
  async function inboxDecisionRows(tenantUserId: string): Promise<number> {
    const rows = (await admin()`
      SELECT count(*)::int AS n FROM awcms_abac_decision_logs
      WHERE tenant_id = ${tenantId} AND tenant_user_id = ${tenantUserId}
        AND module_key = 'omnichannel_inbox'
    `) as { n: number }[];

    return rows[0]!.n;
  }

  test("the decision log grows by one row per tick, not 1 + N per tick, however many business scopes the viewer holds (audit M-1)", async () => {
    const few = await seedUser(tenantId, "few", ROWS);
    const many = await seedUser(tenantId, "many", ROWS);

    await holdScope(few.tenantUserId, await seedOffice("few-0"));
    for (let i = 0; i < 20; i += 1) {
      await holdScope(many.tenantUserId, await seedOffice(`many-${i}`));
    }

    const window = async (viewer: { token: string }) => {
      const stream = await open(testRoute({}), viewer.token);

      await stream.waitFor((e) => e.event === "progress");
      await Bun.sleep(1_000);
      stream.close();
      await stream.ended;
    };

    await window(few);
    await window(many);

    const fewRows = await inboxDecisionRows(few.tenantUserId);
    const manyRows = await inboxDecisionRows(many.tenantUserId);

    // Before the fix: 1 scope -> ~30 rows, 20 scopes -> ~189 rows per second.
    expect(fewRows).toBeGreaterThan(0);
    expect(manyRows).toBeLessThanOrEqual(fewRows + 3);
  });

  test("a status.read holder without conversations.read gets counts and no conversation ids; a deny of conversations.read does the same (audit L-1)", async () => {
    const brandA = await seedOffice("brand-a");
    const c = await conversation(tenantId, { officeId: brandA });
    const statusOnly = await seedUser(tenantId, "statusonly", STATUS);
    const stream = await open(testRoute({}), statusOnly.token);
    const snap = (await snapshot(statusOnly.token)).body.data!;

    expect(snap.counts.open).toBe(1);
    expect(snap.recent).toEqual([]);

    const opening = await stream.waitFor((e) => e.event === "progress");

    expect((opening.data as { counts: { open: number } }).counts.open).toBe(1);
    await touch(c, "pending");
    await stream.waitFor(
      progressWith((d) => (d.counts as Record<string, number>).pending === 1)
    );
    expect(JSON.stringify(stream.events)).not.toContain(c);
    stream.close();
    await stream.ended;

    // Holding the list permission shows the id...
    const both = await seedUser(tenantId, "both", ROWS);

    expect(
      (await snapshot(both.token)).body.data!.recent.map((r) => r.id)
    ).toContain(c);

    // ...until an ABAC policy denies conversations.read: counts stay, ids go.
    await admin()`
      INSERT INTO awcms_abac_policies
        (tenant_id, policy_code, effect, module_key, activity_code, action,
         conditions, is_dsl_managed, is_active)
      VALUES (${tenantId}, 'test.deny-inbox-list', 'deny', 'omnichannel_inbox',
              'conversations', 'read', '{"allOf": []}'::jsonb, true, true)
    `;

    // The policy cache is per process; a real policy write invalidates it.
    invalidatePolicyCache(tenantId);

    const denied = (await snapshot(both.token)).body.data!;

    expect(denied.counts.pending).toBe(1);
    expect(denied.recent).toEqual([]);
  });
});
