/**
 * `omnichannel_inbox` projector under the PRODUCTION dispatcher role (the #1275
 * audit, H-1).
 *
 * `bun run domain-events:dispatch` runs on `WORKER_DATABASE_URL`, i.e. as
 * `awcms_worker`. The route-level suite drives the dispatcher on the handler
 * database's superuser connection, which bypasses every grant, so it could not
 * see that the worker held no INSERT/UPDATE on the inbox tables: every delivery
 * failed with "permission denied", the projection stayed empty and a website
 * withdrawal dead-lettered while the conversation stayed active.
 *
 * Here events are appended as `awcms_app` (the producers' role) and dispatched
 * as `awcms_worker`, through the real dispatcher and consumer registry. The
 * four envelopes are covered: Telegram interaction, website submission and
 * withdrawal through the consumer, and Telegram consent through the read-back
 * on creation (no consumer subscribes to it: no delivery row may exist). The
 * worker's grants stay narrow: it may not read or write the assignee.
 *
 * World 1 (ephemeral database), gated on `DATABASE_URL`.
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

import {
  assertRejected,
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
import { appendDomainEvent } from "../../src/modules/domain-event-runtime/application/append-domain-event";
import { dispatchDomainEventsForTenant } from "../../src/modules/domain-event-runtime/application/dispatch-domain-events";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { runSlaForTenant } from "../../src/modules/omnichannel-inbox/application/sla-job";
import { officeScopeHierarchyPortAdapter } from "../../src/modules/tenant-admin/application/office-scope-hierarchy-port-adapter";

setDefaultTimeout(60_000);

const TENANT = "a1164000-0000-4000-8000-00000000000a";
const CONSUMER = "omnichannel_inbox.conversation_projector";
let updateId = 5000;
let botSerial = 9_100_000;
let savedSwitch: string | undefined;

async function seedBot(): Promise<string> {
  botSerial += 1;
  const rows = (await getAdminSql()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name, auth_mode,
       status)
    VALUES (${TENANT}, 'telegram', 'bot', ${String(botSerial)},
            ${`bot-${botSerial}`}, 'bot_token', 'connected')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function seedTenantUser(id: string, status: string): Promise<void> {
  const sql = getAdminSql();
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${`Person ${id}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, ${`${id}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await sql`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${id}, ${TENANT}, ${identity[0]!.id}, ${status})
  `;
}

/** A role carrying `permissionKey`, granted TENANT-WIDE through the real writer. */
async function grantTenantWide(
  tenantUserId: string,
  permissionKey: string
): Promise<void> {
  const sql = getAdminSql();
  const [moduleKey, activityCode, action] = permissionKey.split(".");
  const role = (await sql`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${TENANT}, ${`role-${tenantUserId}`}, 'Inbox agent') RETURNING id
  `) as { id: string }[];

  await sql`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    SELECT ${TENANT}, ${role[0]!.id}, id FROM awcms_permissions
    WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
      AND action = ${action!}
  `;
  await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    grantRolePolicy(tx, TENANT, {
      tenantUserId,
      roleId: role[0]!.id,
      grantedByTenantUserId: null,
      reason: "inbox worker fixture"
    })
  );
}

/** As `awcms_app`: the role the producing modules publish under. */
async function publish(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    appendDomainEvent(tx, TENANT, {
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
}

function telegramInbound(bot: string, contact: string, at = new Date()) {
  updateId += 1;
  return publish(
    "awcms.telegram_engagement.interaction.received",
    "telegram_engagement_contact",
    contact,
    {
      contractVersion: "1",
      provider: "telegram",
      channelAccountId: bot,
      eventKind: "message",
      providerEventId: String(updateId),
      conversationRef: contact,
      senderRef: contact,
      contentKinds: ["text"],
      forwarded: false,
      provenance: "secret_header",
      occurredAt: at.toISOString(),
      receivedAt: at.toISOString(),
      correlationId: `corr-${updateId}`,
      privacyClass: "customer_content"
    }
  );
}

function telegramOptOut(bot: string, contact: string) {
  return publish(
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
}

const SOURCE_ID = "b1164000-0000-4000-8000-0000000000b1";

function websiteReceived(submission: string) {
  return publish(
    "awcms.website_engagement.submission.received",
    "website_engagement_submission",
    submission,
    {
      contractVersion: "1",
      submissionId: submission,
      sourceId: SOURCE_ID,
      sourceCode: "site",
      clientEventId: `evt-${submission}`,
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
    }
  );
}

function websiteWithdrawn(submission: string) {
  return publish(
    "awcms.website_engagement.submission.withdrawn",
    "website_engagement_submission",
    submission,
    {
      contractVersion: "1",
      submissionId: submission,
      sourceId: SOURCE_ID,
      sourceCode: "site",
      reason: "data_subject_request",
      withdrawnAt: new Date().toISOString(),
      privacyClass: "personal"
    }
  );
}

/** The production dispatcher posture: `awcms_worker`, never a superuser. */
async function dispatchAsWorker(): Promise<void> {
  for (let pass = 0; pass < 5; pass += 1) {
    const result = await dispatchDomainEventsForTenant(
      getWorkerRoleSql(),
      TENANT,
      { limit: 100 }
    );

    if (result.claimed === 0) return;
  }
}

async function conversation(sourceRef: string) {
  const rows = (await getAdminSql()`
    SELECT * FROM awcms_inbox_conversations
    WHERE tenant_id = ${TENANT} AND source_ref = ${sourceRef}
  `) as Record<string, unknown>[];

  return rows[0];
}

async function deliveries() {
  return (await getAdminSql()`
    SELECT event_type, status, last_error_message
    FROM awcms_domain_event_deliveries
    WHERE tenant_id = ${TENANT} AND consumer_name = ${CONSUMER}
    ORDER BY event_sequence
  `) as {
    event_type: string;
    status: string;
    last_error_message: string | null;
  }[];
}

const suite = integrationEnabled ? describe : describe.skip;

suite("omnichannel inbox projector as awcms_worker (#1275 H-1)", () => {
  beforeAll(async () => {
    savedSwitch = process.env.OMNICHANNEL_INBOX_ENABLED;
    process.env.OMNICHANNEL_INBOX_ENABLED = "true";
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    if (savedSwitch === undefined) delete process.env.OMNICHANNEL_INBOX_ENABLED;
    else process.env.OMNICHANNEL_INBOX_ENABLED = savedSwitch;
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    expect(
      workerRoleActivated,
      "awcms_worker must exist: the point of this suite is its grants"
    ).toBe(true);
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT}, 'inbox-worker', 'Inbox Worker')
    `;
  });

  test("all four envelopes reach the projection through the worker dispatcher", async () => {
    // A tenant default SLA policy: starting a clock reads its terms as the worker.
    await getAdminSql()`
      INSERT INTO awcms_inbox_sla_policies
        (tenant_id, name, timezone, first_response_minutes,
         next_response_minutes, working_hours)
      VALUES (${TENANT}, 'Default', 'UTC', 60, 60,
              '[{"start":0,"end":1440},{"start":0,"end":1440},{"start":0,"end":1440},{"start":0,"end":1440},{"start":0,"end":1440},{"start":0,"end":1440},{"start":0,"end":1440}]'::jsonb)
    `;

    // 1. Telegram interaction.
    const bot = await seedBot();
    const contact = crypto.randomUUID();
    await telegramInbound(bot, contact);
    await dispatchAsWorker();

    const active = await conversation(contact);
    expect(
      active,
      "the worker projected the Telegram interaction"
    ).toBeDefined();
    expect(active!.customer_state).toBe("active");
    expect(active!.response_due_at).not.toBeNull();

    // A settled conversation REOPENS on a later inbound: the worker writes the
    // status and appends the activity row.
    await getAdminSql()`
      UPDATE awcms_inbox_conversations
      SET status = 'resolved', answered_through = now(), awaiting_since = NULL,
          response_due_kind = NULL, response_due_at = NULL, sla_policy_id = NULL
      WHERE tenant_id = ${TENANT} AND source_ref = ${contact}
    `;
    await telegramInbound(bot, contact, new Date(Date.now() + 60_000));
    await dispatchAsWorker();
    expect((await conversation(contact))!.status).toBe("open");

    const reopened = (await getAdminSql()`
      SELECT kind, detail_code FROM awcms_inbox_activity
      WHERE tenant_id = ${TENANT}
    `) as { kind: string; detail_code: string }[];
    expect(reopened).toEqual([{ kind: "status_changed", detail_code: "open" }]);

    // 2. Telegram consent: in the log before the conversation exists. No
    // delivery row (nothing subscribes); the worker reads it back on creation.
    const optedContact = crypto.randomUUID();
    await telegramOptOut(bot, optedContact);
    await telegramInbound(bot, optedContact);
    await dispatchAsWorker();
    expect((await conversation(optedContact))!.customer_state).toBe(
      "opted_out"
    );

    // 3 and 4. A website submission, then its withdrawal.
    const submission = crypto.randomUUID();
    await websiteReceived(submission);
    await dispatchAsWorker();
    expect((await conversation(submission))!.customer_state).toBe("active");

    await websiteWithdrawn(submission);
    await dispatchAsWorker();

    const withdrawn = await conversation(submission);
    expect(withdrawn!.customer_state).toBe("withdrawn");
    expect(withdrawn!.status).toBe("closed");

    const rows = await deliveries();
    expect(rows.every((row) => row.status === "delivered")).toBe(true);
    expect(rows.map((row) => row.event_type).sort()).toEqual(
      [
        "awcms.telegram_engagement.interaction.received",
        "awcms.telegram_engagement.interaction.received",
        "awcms.telegram_engagement.interaction.received",
        "awcms.website_engagement.submission.received",
        "awcms.website_engagement.submission.withdrawn"
      ].sort()
    );
  });

  test("the worker's grants stay narrow: no assignee, no response stamps, append-only activity", async () => {
    const bot = await seedBot();
    const contact = crypto.randomUUID();
    await telegramInbound(bot, contact);
    await dispatchAsWorker();

    const asWorker = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
      withTenantOrThrow(getWorkerRoleSql(), TENANT, fn);
    const denied = async (statement: Promise<unknown>, what: string) => {
      const error = await assertRejected(statement, what);

      expect(error.message, what).toContain("permission denied");
    };

    await denied(
      asWorker(
        (tx) =>
          tx`SELECT assignee_tenant_user_id FROM awcms_inbox_conversations`
      ),
      "reading the assignee"
    );
    await denied(
      asWorker(
        (tx) =>
          tx`UPDATE awcms_inbox_conversations SET last_responded_at = now()`
      ),
      "faking a response"
    );
    await denied(
      asWorker(
        (tx) => tx`UPDATE awcms_inbox_conversations SET assigned_at = now()`
      ),
      "writing an assignment"
    );
    await denied(
      asWorker((tx) => tx`UPDATE awcms_inbox_activity SET detail_code = 'x'`),
      "editing the activity history"
    );
    await denied(
      asWorker((tx) => tx`SELECT created_by FROM awcms_inbox_sla_policies`),
      "reading a policy's author"
    );
  });

  test("the assignee re-check reaches every pair past the batch of 500 (#1275 M-2)", async () => {
    // An eligible, unconfined assignee holding 501 (assignee, scope) pairs, and
    // a deactivated assignee whose one pair sorts AFTER all of them. A fixed
    // order with a LIMIT never reaches the latter; least-recently-checked-first
    // reaches it on the next run.
    const eligible = "00000000-0000-4000-8000-000000000001";
    const revoked = "ffffffff-0000-4000-8000-000000000002";

    await seedTenantUser(eligible, "active");
    await seedTenantUser(revoked, "inactive");
    await grantTenantWide(eligible, "omnichannel_inbox.conversations.update");

    await getAdminSql()`
      INSERT INTO awcms_inbox_conversations
        (tenant_id, source_kind, source_ref, business_scope_type,
         business_scope_id, first_inbound_at, last_inbound_at,
         assignee_tenant_user_id, assigned_at)
      SELECT ${TENANT}, 'website', gen_random_uuid(), 'office',
             gen_random_uuid(), now(), now(), ${eligible}::uuid, now()
      FROM generate_series(1, 501)
    `;
    const lastPair = crypto.randomUUID();
    await getAdminSql()`
      INSERT INTO awcms_inbox_conversations
        (tenant_id, source_kind, source_ref, first_inbound_at, last_inbound_at,
         assignee_tenant_user_id, assigned_at)
      VALUES (${TENANT}, 'website', ${lastPair}, now(), now(), ${revoked}, now())
    `;

    const deps = {
      hierarchy: officeScopeHierarchyPortAdapter,
      notifier: { enqueueNotification: async () => ({ queued: 0 }) }
    };
    const runs = [];

    for (let run = 0; run < 2; run += 1) {
      runs.push(
        await runSlaForTenant(getRuntimeSql(), TENANT, deps, {
          correlationId: `corr-m2-${run}`
        })
      );
    }

    expect(runs.map((run) => (run as { revoked: number }).revoked)).toEqual([
      0, 1
    ]);

    const row = await conversation(lastPair);
    expect(row!.assignee_tenant_user_id).toBeNull();

    const stillAssigned = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_inbox_conversations
      WHERE tenant_id = ${TENANT} AND assignee_tenant_user_id = ${eligible}
    `) as { n: number }[];
    expect(stillAssigned[0]!.n).toBe(501);
  });

  test("the SLA job's sweep applies a withdrawal the consumer never delivered (safety net)", async () => {
    const submission = crypto.randomUUID();
    await websiteReceived(submission);
    await dispatchAsWorker();
    expect((await conversation(submission))!.customer_state).toBe("active");

    // The delivery dead-lettered (or the consumer was off): the event is only
    // in the log.
    await websiteWithdrawn(submission);
    await getAdminSql()`
      UPDATE awcms_domain_event_deliveries
      SET status = 'dead_letter', dead_letter_at = now(),
          dead_letter_reason = 'test'
      WHERE tenant_id = ${TENANT} AND consumer_name = ${CONSUMER}
        AND event_type = 'awcms.website_engagement.submission.withdrawn'
    `;

    const deps = {
      hierarchy: officeScopeHierarchyPortAdapter,
      notifier: { enqueueNotification: async () => ({ queued: 0 }) }
    };
    const first = await runSlaForTenant(getRuntimeSql(), TENANT, deps, {
      correlationId: "corr-sweep"
    });
    const second = await runSlaForTenant(getRuntimeSql(), TENANT, deps, {
      correlationId: "corr-sweep"
    });

    expect(first).toMatchObject({ customerStateApplied: 1 });
    expect(second).toMatchObject({ customerStateApplied: 0 });

    const row = await conversation(submission);
    expect(row!.customer_state).toBe("withdrawn");
    expect(row!.status).toBe("closed");
  });
});
