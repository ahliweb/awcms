/**
 * `omnichannel_inbox` end to end (Issue #1164, ADR-0160): the projector through
 * the REAL domain-event dispatcher, the routes through the real route factory,
 * the SLA job against a real PostgreSQL with real sessions.
 *
 * Covers: the off switch; two tenants; two brands (business scopes) with a
 * confined viewer, a tenant-wide conversation hidden from them and a
 * confinement that has not started yet (#1270); a duplicate delivery and a
 * replay with ONE effect; a rebuild from the event log that leaves staff work
 * state alone; a withdrawal / opt-out that wins regardless of delivery order;
 * assignment eligibility, concurrent reassignment and idempotent replay; an
 * assignee who loses eligibility being unassigned by the SLA job; and an SLA
 * due time across a night and a holiday in a non-UTC zone, stamped once.
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
import { appendDomainEvent } from "../../src/modules/domain-event-runtime/application/append-domain-event";
import { dispatchDomainEventsForTenant } from "../../src/modules/domain-event-runtime/application/dispatch-domain-events";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import {
  projectEvent,
  rebuildProjection
} from "../../src/modules/omnichannel-inbox/application/conversation-projector";
import { runSlaForTenant } from "../../src/modules/omnichannel-inbox/application/sla-job";
import { officeScopeHierarchyPortAdapter } from "../../src/modules/tenant-admin/application/office-scope-hierarchy-port-adapter";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { GET as listRoute } from "../../src/pages/api/v1/omnichannel-inbox/conversations/index";
import { GET as detailRoute } from "../../src/pages/api/v1/omnichannel-inbox/conversations/[id]/index";
import { POST as assignRoute } from "../../src/pages/api/v1/omnichannel-inbox/conversations/[id]/assignment";
import { POST as statusRoute } from "../../src/pages/api/v1/omnichannel-inbox/conversations/[id]/status";
import { POST as responseRoute } from "../../src/pages/api/v1/omnichannel-inbox/conversations/[id]/responses";
import { PUT as tagsRoute } from "../../src/pages/api/v1/omnichannel-inbox/conversations/[id]/tags";
import { POST as createTagRoute } from "../../src/pages/api/v1/omnichannel-inbox/tags/index";
import { POST as createPolicyRoute } from "../../src/pages/api/v1/omnichannel-inbox/sla-policies/index";
import { POST as rebuildRoute } from "../../src/pages/api/v1/omnichannel-inbox/projection/rebuild";

setDefaultTimeout(60_000);

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const READ = "omnichannel_inbox.conversations.read";
const UPDATE = "omnichannel_inbox.conversations.update";
const ASSIGN = "omnichannel_inbox.conversations.assign";
const ALL = [
  READ,
  UPDATE,
  ASSIGN,
  "omnichannel_inbox.tags.configure",
  "omnichannel_inbox.sla_policies.read",
  "omnichannel_inbox.sla_policies.configure",
  "omnichannel_inbox.projection.configure"
];

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};
type Conversation = {
  id: string;
  sourceKind: string;
  sourceRef: string;
  status: string;
  customerState: string;
  assigneeTenantUserId: string | null;
  businessScope: { type: string; id: string } | null;
  sla: { state: string; dueAt: string | null; dueKind: string | null };
  tagIds: string[];
  version: number;
};

let tenantId = "";
let ownerTenantUserId = "";
let counter = 0;
let updateId = 1000;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "inbox-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Inbox Co",
      tenantCode: "inbox-one",
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
): Promise<{ token: string; tenantUserId: string }> {
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
  const token = `ib-${tag}-${Math.random().toString(36).slice(2)}`;

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
      reason: "inbox fixture"
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

let botSerial = 7_000_000;

async function seedBot(tenant: string, officeId: string | null) {
  botSerial += 1;
  const rows = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider,
       account_kind, external_id, display_name, auth_mode, status)
    VALUES (${tenant}, ${officeId ? "office" : null}, ${officeId},
            'telegram', 'bot', ${String(botSerial)}, ${`bot-${botSerial}`},
            'bot_token', 'connected')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

function telegramMessage(
  accountId: string,
  contactId: string,
  receivedAt: Date
): Record<string, unknown> {
  updateId += 1;
  return {
    contractVersion: "1",
    provider: "telegram",
    channelAccountId: accountId,
    eventKind: "message",
    providerEventId: String(updateId),
    conversationRef: contactId,
    senderRef: contactId,
    contentKinds: ["text"],
    forwarded: false,
    provenance: "secret_header",
    occurredAt: receivedAt.toISOString(),
    receivedAt: receivedAt.toISOString(),
    correlationId: `corr-${updateId}`,
    privacyClass: "customer_content"
  };
}

async function publish(
  tenant: string,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>
): Promise<{ id: string; sequence: number }> {
  const result = await withTenantOrThrow(
    getHandlerDatabaseClient(),
    tenant,
    (tx) =>
      appendDomainEvent(tx, tenant, {
        eventType,
        eventVersion: "1.0",
        aggregateType,
        aggregateId,
        producerModule: eventType.includes("telegram")
          ? "telegram_engagement"
          : "website_engagement",
        payload
      })
  );

  return { id: result.eventId, sequence: Number(result.eventSequence) };
}

async function telegramInbound(
  tenant: string,
  accountId: string,
  contactId: string,
  receivedAt = new Date()
) {
  return publish(
    tenant,
    "awcms.telegram_engagement.interaction.received",
    "telegram_engagement_contact",
    contactId,
    telegramMessage(accountId, contactId, receivedAt)
  );
}

async function dispatch(tenant: string): Promise<void> {
  for (let pass = 0; pass < 5; pass += 1) {
    const result = await dispatchDomainEventsForTenant(
      getHandlerDatabaseClient(),
      tenant,
      { limit: 100 }
    );

    if (result.claimed === 0) return;
  }
}

function headers(token: string, extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": tenantId,
    authorization: `Bearer ${token}`,
    ...extra
  };
}

async function list(token: string, query = "") {
  return invoke<Envelope<{ items: Conversation[]; nextCursor: string | null }>>(
    listRoute,
    {
      path: `/api/v1/omnichannel-inbox/conversations${query}`,
      headers: headers(token)
    }
  );
}

async function detail(token: string, id: string) {
  return invoke<Envelope<Conversation & { activity: { kind: string }[] }>>(
    detailRoute,
    {
      path: `/api/v1/omnichannel-inbox/conversations/${id}`,
      params: { id },
      headers: headers(token)
    }
  );
}

async function assign(
  token: string,
  id: string,
  assignee: string | null,
  version: number,
  key = crypto.randomUUID()
) {
  return invoke<Envelope<{ outcome: string; conversation: Conversation }>>(
    assignRoute,
    {
      method: "POST",
      path: `/api/v1/omnichannel-inbox/conversations/${id}/assignment`,
      params: { id },
      headers: headers(token, { "idempotency-key": key }),
      body: { assigneeTenantUserId: assignee, expectedVersion: version }
    }
  );
}

async function conversationRow(sourceRef: string) {
  const rows = (await admin()`
    SELECT * FROM awcms_inbox_conversations WHERE source_ref = ${sourceRef}
  `) as Record<string, unknown>[];

  return rows[0];
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("omnichannel inbox (#1164, ADR-0160)", () => {
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

  test("off by default: every route is 404 and the projector writes nothing", async () => {
    delete process.env.OMNICHANNEL_INBOX_ENABLED;
    const viewer = await seedUser(tenantId, "off", ALL);
    const bot = await seedBot(tenantId, null);
    const contact = crypto.randomUUID();

    await telegramInbound(tenantId, bot, contact);
    await dispatch(tenantId);

    expect(await conversationRow(contact)).toBeUndefined();
    expect((await list(viewer.token)).status).toBe(404);
  });

  test("two tenants: a conversation is projected only into its own tenant and is invisible across", async () => {
    const tenant2 = crypto.randomUUID();

    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${tenant2}, 'inbox-two', 'Inbox Two')
    `;

    const viewerA = await seedUser(tenantId, "a", ALL);
    const botA = await seedBot(tenantId, null);
    const botB = await seedBot(tenant2, null);
    const contactA = crypto.randomUUID();
    const contactB = crypto.randomUUID();

    await telegramInbound(tenantId, botA, contactA);
    await telegramInbound(tenant2, botB, contactB);
    await dispatch(tenantId);
    await dispatch(tenant2);

    const rowA = await conversationRow(contactA);
    const rowB = await conversationRow(contactB);

    expect(rowA?.tenant_id).toBe(tenantId);
    expect(rowB?.tenant_id).toBe(tenant2);

    const page = await list(viewerA.token);

    expect(page.status).toBe(200);
    expect(page.body.data!.items.map((item) => item.sourceRef)).toEqual([
      contactA
    ]);
    // Tenant B's id through tenant A's session: the same 404 as unknown.
    expect((await detail(viewerA.token, String(rowB!.id))).status).toBe(404);
    // The projection stores no external identifier or body.
    expect(JSON.stringify(page.body)).not.toContain("secret_header");
  });

  test("two brands: a confined viewer sees only their brand, never a tenant-wide conversation; a pending confinement sees nothing", async () => {
    const brandA = await seedOffice("brand-a");
    const brandB = await seedOffice("brand-b");
    const botA = await seedBot(tenantId, brandA);
    const botB = await seedBot(tenantId, brandB);
    const botWide = await seedBot(tenantId, null);
    const [cA, cB, cWide] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID()
    ];

    await telegramInbound(tenantId, botA, cA);
    await telegramInbound(tenantId, botB, cB);
    await telegramInbound(tenantId, botWide, cWide);
    await dispatch(tenantId);

    const unconfined = await seedUser(tenantId, "all", [READ]);
    const confined = await seedUser(tenantId, "brand-a", [READ]);
    const pending = await seedUser(tenantId, "pending", [READ]);

    await holdScope(confined.tenantUserId, brandA);
    await holdScope(pending.tenantUserId, brandA, "1 hour");

    const all = await list(unconfined.token);
    expect(all.body.data!.items.map((i) => i.sourceRef).sort()).toEqual(
      [cA, cB, cWide].sort()
    );

    const mine = await list(confined.token);
    expect(mine.body.data!.items.map((i) => i.sourceRef)).toEqual([cA]);
    expect(mine.body.data!.items[0]!.businessScope).toEqual({
      type: "office",
      id: brandA
    });

    const rowB = await conversationRow(cB);
    const rowWide = await conversationRow(cWide);
    expect((await detail(confined.token, String(rowB!.id))).status).toBe(404);
    expect((await detail(confined.token, String(rowWide!.id))).status).toBe(
      404
    );

    // A confinement that has not started yet confines (fail-closed, #1270).
    const waiting = await list(pending.token);
    expect(waiting.status).toBe(200);
    expect(waiting.body.data!.items).toEqual([]);
  });

  test("a duplicate delivery and a replay have one effect; a rebuild restores the projection and leaves staff work state alone", async () => {
    const staff = await seedUser(tenantId, "staff", ALL);
    const bot = await seedBot(tenantId, null);
    const contact = crypto.randomUUID();
    const event = await telegramInbound(tenantId, bot, contact);

    await dispatch(tenantId);

    const before = await conversationRow(contact);
    expect(before).toBeDefined();

    // The same event, delivered again to the projector (at-least-once).
    await withTenantOrThrow(
      getHandlerDatabaseClient(),
      tenantId,
      async (tx) => {
        const events = (await tx`
        SELECT id, event_type, payload FROM awcms_domain_events WHERE id = ${event.id}
      `) as {
          id: string;
          event_type: string;
          payload: Record<string, unknown>;
        }[];

        await projectEvent(tx, tenantId, {
          id: events[0]!.id,
          eventType: events[0]!.event_type,
          payload: events[0]!.payload
        });
        await rebuildProjection(tx, tenantId);
      }
    );

    const after = await conversationRow(contact);
    expect(after!.version).toBe(before!.version);
    expect(String(after!.last_inbound_at)).toBe(
      String(before!.last_inbound_at)
    );

    const activity = (await admin()`
      SELECT count(*)::int AS n FROM awcms_inbox_activity
      WHERE conversation_id = ${String(after!.id)}
    `) as { n: number }[];
    expect(activity[0]!.n).toBe(0);

    // Staff resolve it, then the projected rows are lost; a rebuild brings the
    // conversation back from the log.
    const view = await detail(staff.token, String(after!.id));
    const resolved = await invoke<Envelope<{ conversation: Conversation }>>(
      statusRoute,
      {
        method: "POST",
        path: `/api/v1/omnichannel-inbox/conversations/${after!.id}/status`,
        params: { id: String(after!.id) },
        headers: headers(staff.token),
        body: { status: "resolved", expectedVersion: view.body.data!.version }
      }
    );
    expect(resolved.status).toBe(200);

    // Replaying the (older) event never reopens settled work.
    await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
      rebuildProjection(tx, tenantId)
    );
    expect((await conversationRow(contact))!.status).toBe("resolved");

    await admin()`DELETE FROM awcms_inbox_conversations WHERE source_ref = ${contact}`;

    const rebuilt = await invoke<
      Envelope<{ processed: number; created: number; complete: boolean }>
    >(rebuildRoute, {
      method: "POST",
      path: "/api/v1/omnichannel-inbox/projection/rebuild",
      headers: headers(staff.token, { "idempotency-key": crypto.randomUUID() }),
      body: {}
    });

    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.data!.created).toBe(1);
    expect(rebuilt.body.data!.complete).toBe(true);
    expect((await conversationRow(contact))?.source_kind).toBe("telegram");
  });

  test("an opt-out or a withdrawal wins whatever the delivery order, and is terminal", async () => {
    const bot = await seedBot(tenantId, null);
    const contact = crypto.randomUUID();

    // The opt-out is in the log BEFORE the conversation exists.
    await publish(
      tenantId,
      "awcms.telegram_engagement.consent.changed",
      "telegram_engagement_contact",
      contact,
      {
        contractVersion: "1",
        provider: "telegram",
        channelAccountId: bot,
        contactRef: contact,
        purpose: "support",
        action: "opt_out",
        method: "stop_command",
        noticeVersion: null,
        occurredAt: new Date().toISOString(),
        privacyClass: "consent"
      }
    );
    await dispatch(tenantId);
    await telegramInbound(tenantId, bot, contact);
    await dispatch(tenantId);

    const opted = await conversationRow(contact);
    expect(opted!.customer_state).toBe("opted_out");
    expect(opted!.awaiting_since).toBeNull();

    // A LATER opt-out of an existing conversation (the dispatcher's role cannot
    // write delivery rows, sql/374, so no consumer subscribes to it): the SLA
    // job's consent sweep applies it, once.
    const bot2 = await seedBot(tenantId, null);
    const contact2 = crypto.randomUUID();
    await telegramInbound(tenantId, bot2, contact2);
    await dispatch(tenantId);
    expect((await conversationRow(contact2))!.customer_state).toBe("active");

    await publish(
      tenantId,
      "awcms.telegram_engagement.consent.changed",
      "telegram_engagement_contact",
      contact2,
      {
        contractVersion: "1",
        provider: "telegram",
        channelAccountId: bot2,
        contactRef: contact2,
        purpose: "support",
        action: "opt_out",
        method: "bot_blocked",
        noticeVersion: null,
        occurredAt: new Date().toISOString(),
        privacyClass: "consent"
      }
    );
    const noDeliveries = (await admin()`
      SELECT count(*)::int AS n FROM awcms_domain_event_deliveries
      WHERE consumer_name = 'omnichannel_inbox.conversation_projector'
        AND event_type = 'awcms.telegram_engagement.consent.changed'
    `) as { n: number }[];
    expect(noDeliveries[0]!.n).toBe(0);

    const sweepDeps = {
      hierarchy: officeScopeHierarchyPortAdapter,
      notifier: { enqueueNotification: async () => ({ queued: 0 }) }
    };
    const sweep1 = await runSlaForTenant(
      getHandlerDatabaseClient(),
      tenantId,
      sweepDeps,
      { correlationId: "corr-consent" }
    );
    const sweep2 = await runSlaForTenant(
      getHandlerDatabaseClient(),
      tenantId,
      sweepDeps,
      { correlationId: "corr-consent" }
    );
    expect(sweep1).toMatchObject({ consentApplied: 1 });
    expect(sweep2).toMatchObject({ consentApplied: 0 });
    expect((await conversationRow(contact2))!.customer_state).toBe("opted_out");

    // A website submission, then its withdrawal, then the submission replayed.
    const submission = crypto.randomUUID();
    const received = {
      contractVersion: "1",
      submissionId: submission,
      sourceId: crypto.randomUUID(),
      sourceCode: "site",
      clientEventId: "evt-1",
      kind: "contact",
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      provenance: {
        sourceAuthenticated: true,
        originVerified: true,
        originHost: "example.com",
        originVia: "origin",
        challenge: "not_required"
      },
      consent: { purposes: ["respond_to_inquiry"] },
      identifiers: ["email"],
      privacyClass: "personal"
    };

    await publish(
      tenantId,
      "awcms.website_engagement.submission.received",
      "website_engagement_submission",
      submission,
      received
    );
    await dispatch(tenantId);
    expect((await conversationRow(submission))!.customer_state).toBe("active");

    await publish(
      tenantId,
      "awcms.website_engagement.submission.withdrawn",
      "website_engagement_submission",
      submission,
      {
        contractVersion: "1",
        submissionId: submission,
        sourceId: received.sourceId,
        sourceCode: "site",
        reason: "data_subject_request",
        withdrawnAt: new Date().toISOString(),
        privacyClass: "personal"
      }
    );
    await dispatch(tenantId);
    await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
      rebuildProjection(tx, tenantId)
    );

    const withdrawn = await conversationRow(submission);
    expect(withdrawn!.customer_state).toBe("withdrawn");
    expect(withdrawn!.status).toBe("closed");
    expect(withdrawn!.response_due_at).toBeNull();

    // The database refuses to revive it.
    let refused = false;
    try {
      await admin()`
        UPDATE awcms_inbox_conversations SET customer_state = 'active'
        WHERE source_ref = ${submission}
      `;
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  test("assignment: eligibility, concurrent reassignment, idempotent replay, and the SLA job unassigning a revoked assignee", async () => {
    const brandA = await seedOffice("asg-a");
    const brandB = await seedOffice("asg-b");
    const bot = await seedBot(tenantId, brandA);
    const contact = crypto.randomUUID();

    await telegramInbound(tenantId, bot, contact);
    await dispatch(tenantId);

    const lead = await seedUser(tenantId, "lead", ALL);
    const agent = await seedUser(tenantId, "agent", [READ, UPDATE]);
    const agent2 = await seedUser(tenantId, "agent2", [READ, UPDATE]);
    const readOnly = await seedUser(tenantId, "ro", [READ]);
    const otherBrand = await seedUser(tenantId, "other", [READ, UPDATE]);

    await holdScope(otherBrand.tenantUserId, brandB);

    const id = String((await conversationRow(contact))!.id);
    const v1 = (await detail(lead.token, id)).body.data!.version;

    const noPermission = await assign(
      lead.token,
      id,
      readOnly.tenantUserId,
      v1
    );
    expect(noPermission.status).toBe(422);

    const wrongBrand = await assign(
      lead.token,
      id,
      otherBrand.tenantUserId,
      v1
    );
    expect(wrongBrand.status).toBe(422);

    // A person without `assign` cannot assign at all.
    expect((await assign(agent.token, id, agent.tenantUserId, v1)).status).toBe(
      403
    );

    const key = crypto.randomUUID();
    const first = await assign(lead.token, id, agent.tenantUserId, v1, key);
    expect(first.status).toBe(200);
    expect(first.body.data!.conversation.assigneeTenantUserId).toBe(
      agent.tenantUserId
    );

    // Same key, same request: the stored answer, no second effect.
    const replay = await assign(lead.token, id, agent.tenantUserId, v1, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    // Two writers holding the same version: exactly one wins.
    const v2 = first.body.data!.conversation.version;
    const [r1, r2] = [
      await assign(lead.token, id, agent2.tenantUserId, v2),
      await assign(lead.token, id, lead.tenantUserId, v2)
    ];
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);

    const history = (await admin()`
      SELECT kind FROM awcms_inbox_activity WHERE conversation_id = ${id}
      ORDER BY created_at
    `) as { kind: string }[];
    expect(history.map((h) => h.kind)).toEqual(["assigned", "assigned"]);

    // The assignee is deactivated: the SLA job unassigns them.
    await admin()`
      UPDATE awcms_tenant_users SET status = 'inactive'
      WHERE id = ${agent2.tenantUserId}
    `;
    const notices: string[][] = [];
    const result = await runSlaForTenant(
      getHandlerDatabaseClient(),
      tenantId,
      {
        hierarchy: officeScopeHierarchyPortAdapter,
        notifier: {
          enqueueNotification: async (_tx, request) => {
            notices.push(request.recipientTenantUserIds);
            return { queued: 1 };
          }
        }
      },
      { correlationId: "corr-it1164" }
    );

    expect(result).not.toBe("skipped");
    expect(
      (await conversationRow(contact))!.assignee_tenant_user_id
    ).toBeNull();

    const revoked = (await admin()`
      SELECT detail_code FROM awcms_inbox_activity
      WHERE conversation_id = ${id} AND kind = 'assignee_revoked'
    `) as { detail_code: string }[];
    expect(revoked.map((r) => r.detail_code)).toEqual(["user_inactive"]);
  });

  test("SLA: business minutes skip the night and a holiday in the policy's zone; the breach is stamped and notified once", async () => {
    const lead = await seedUser(tenantId, "sla", ALL);
    const agent = await seedUser(tenantId, "sla-agent", [READ, UPDATE]);
    const workday = { start: 9 * 60, end: 17 * 60 };

    const created = await invoke<Envelope<{ policy: { id: string } }>>(
      createPolicyRoute,
      {
        method: "POST",
        path: "/api/v1/omnichannel-inbox/sla-policies",
        headers: headers(lead.token, {
          "idempotency-key": crypto.randomUUID()
        }),
        body: {
          name: "Jakarta office hours",
          timezone: "Asia/Jakarta",
          firstResponseMinutes: 60,
          nextResponseMinutes: 30,
          workingHours: [
            workday,
            workday,
            workday,
            workday,
            workday,
            null,
            null
          ],
          holidays: ["2026-11-16"]
        }
      }
    );
    expect(created.status).toBe(201);

    // Friday 2026-11-13 16:30 WIB (09:30Z): 30 minutes left on Friday, the
    // weekend is closed, Monday 16 November is a holiday, so the remaining 30
    // minutes run from Tuesday 09:00 WIB: due 09:30 WIB = 02:30Z.
    const bot = await seedBot(tenantId, null);
    const contact = crypto.randomUUID();

    await telegramInbound(
      tenantId,
      bot,
      contact,
      new Date("2026-11-13T09:30:00Z")
    );
    await dispatch(tenantId);

    const row = await conversationRow(contact);
    expect((row!.response_due_at as Date).toISOString()).toBe(
      "2026-11-17T02:30:00.000Z"
    );
    expect(row!.response_due_kind).toBe("first");

    const id = String(row!.id);
    const v = (await detail(lead.token, id)).body.data!.version;
    expect((await assign(lead.token, id, agent.tenantUserId, v)).status).toBe(
      200
    );

    const notices: string[][] = [];
    const deps = {
      hierarchy: officeScopeHierarchyPortAdapter,
      notifier: {
        enqueueNotification: async (
          _tx: Bun.SQL,
          request: { recipientTenantUserIds: string[] }
        ) => {
          notices.push(request.recipientTenantUserIds);
          return { queued: 1 };
        }
      }
    };
    const late = new Date("2026-11-17T03:00:00Z");

    const run1 = await runSlaForTenant(
      getHandlerDatabaseClient(),
      tenantId,
      deps,
      {
        correlationId: "corr-sla",
        now: late
      }
    );
    const run2 = await runSlaForTenant(
      getHandlerDatabaseClient(),
      tenantId,
      deps,
      {
        correlationId: "corr-sla",
        now: late
      }
    );

    expect(run1).toMatchObject({ breached: 1, notified: 1 });
    expect(run2).toMatchObject({ breached: 0, notified: 0 });
    expect(notices).toEqual([[agent.tenantUserId]]);

    // Recording a response stops the clock; a tag and a status change are
    // version-guarded.
    const current = (await detail(lead.token, id)).body.data!;
    expect(current.sla.state).toBe("breached");

    const answered = await invoke<Envelope<{ conversation: Conversation }>>(
      responseRoute,
      {
        method: "POST",
        path: `/api/v1/omnichannel-inbox/conversations/${id}/responses`,
        params: { id },
        headers: headers(agent.token),
        body: { expectedVersion: current.version }
      }
    );
    expect(answered.status).toBe(200);
    expect(answered.body.data!.conversation.sla.state).toBe("none");

    const tag = await invoke<Envelope<{ tag: { id: string } }>>(
      createTagRoute,
      {
        method: "POST",
        path: "/api/v1/omnichannel-inbox/tags",
        headers: headers(lead.token, {
          "idempotency-key": crypto.randomUUID()
        }),
        body: { code: "vip", label: "VIP" }
      }
    );
    expect(tag.status).toBe(201);

    const stale = await invoke(tagsRoute, {
      method: "PUT",
      path: `/api/v1/omnichannel-inbox/conversations/${id}/tags`,
      params: { id },
      headers: headers(agent.token),
      body: {
        tagIds: [tag.body.data!.tag.id],
        expectedVersion: current.version
      }
    });
    expect(stale.status).toBe(409);

    const tagged = await invoke<Envelope<{ conversation: Conversation }>>(
      tagsRoute,
      {
        method: "PUT",
        path: `/api/v1/omnichannel-inbox/conversations/${id}/tags`,
        params: { id },
        headers: headers(agent.token),
        body: {
          tagIds: [tag.body.data!.tag.id],
          expectedVersion: answered.body.data!.conversation.version
        }
      }
    );
    expect(tagged.status).toBe(200);
    expect(tagged.body.data!.conversation.tagIds).toEqual([
      tag.body.data!.tag.id
    ]);

    // A NEW inbound after the response starts the next-response clock.
    await telegramInbound(
      tenantId,
      bot,
      contact,
      new Date("2026-11-17T04:00:00Z")
    );
    await dispatch(tenantId);
    expect((await conversationRow(contact))!.response_due_kind).toBe("next");
  });
});
