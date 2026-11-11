/**
 * `crm_follow_up` against a real PostgreSQL, on the least-privilege roles
 * (Issue #1165, ADR-0159): `awcms_app` for configuration and staff acts,
 * `awcms_worker` for the domain-event consumer and the dispatch job (when the
 * harness activates it).
 *
 *   * two tenants: a lead event of one never creates work in the other, and
 *     FORCE RLS hides the other's rows;
 *   * a replayed or redelivered source event creates ONE task;
 *   * a stop signal wins: before, after and racing a trigger, and racing a
 *     dispatch (reply + send at the same time);
 *   * opt-out (consent withdrawn) cancels the pending notices and nothing is
 *     queued afterwards;
 *   * an assignee whose account was revoked is never notified;
 *   * quiet hours and the calendar: a notice outside working time is deferred
 *     to the next working instant of the rule's zone;
 *   * escalation, owner reassignment, completion with optimistic concurrency;
 *   * simulation writes nothing;
 *   * the database refuses what the application should never do.
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
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type { DomainEventForHandler } from "../../src/modules/_shared/domain-event-consumer-contract";
import { appendDomainEvent } from "../../src/modules/domain-event-runtime/application/append-domain-event";
import { dispatchDomainEventsForTenant } from "../../src/modules/domain-event-runtime/application/dispatch-domain-events";
import { buildDomainEventConsumerRegistry } from "../../src/modules/domain-event-runtime/infrastructure/consumer-registry";
import { createEmailWorkflowNotificationAdapter } from "../../src/modules/email/application/workflow-notification-port-adapter";
import { DEFAULT_EMAIL_TEMPLATES } from "../../src/modules/email/domain/email-default-templates";
import {
  runCrmFollowUpDispatch,
  runFollowUpDispatchPass
} from "../../src/modules/crm-follow-up/application/follow-up-dispatch";
import { handleLeadSignal } from "../../src/modules/crm-follow-up/application/lead-event-consumer";
import { createRule } from "../../src/modules/crm-follow-up/application/rule-directory";
import { simulateRevision } from "../../src/modules/crm-follow-up/application/simulation";
import {
  completeTask,
  createTasksForTrigger,
  recordStopSignal
} from "../../src/modules/crm-follow-up/application/task-engine";
import type { RuleDefinition } from "../../src/modules/crm-follow-up/domain/rule-definition";
import { listModules } from "../../src/modules/index";

const TENANT_A = "a1165000-0000-4000-8000-00000000000a";
const TENANT_B = "a1165000-0000-4000-8000-00000000000b";
const CONSUMER = "crm_follow_up.lead_signals";
const port = createEmailWorkflowNotificationAdapter();

let counter = 0;
let savedEnabled: string | undefined;

const app = () => getRuntimeSql();
const worker = () =>
  workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql();

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>,
  sql: Bun.SQL = app()
): Promise<T> {
  return withTenantOrThrow(sql, tenantId, fn);
}

async function seedUser(tenantId: string, tag: string): Promise<string> {
  counter += 1;
  const sql = getAdminSql();
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Staff ${tag}-${counter}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`s${counter}-${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

async function seedTemplates(tenantId: string, by: string): Promise<void> {
  for (const template of DEFAULT_EMAIL_TEMPLATES.filter((entry) =>
    entry.templateKey.startsWith("crm.follow_up_")
  )) {
    await getAdminSql()`
      INSERT INTO awcms_email_templates
        (tenant_id, template_key, name, subject_template, text_body_template,
         created_by, updated_by)
      VALUES (${tenantId}, ${template.templateKey}, ${template.name},
              ${template.subjectTemplate}, ${template.textBodyTemplate},
              ${by}, ${by})
    `;
  }
}

/** A calendar that is always working time, so instants are easy to reason about. */
const ALWAYS = {
  timeZone: "UTC",
  workingDays: [1, 2, 3, 4, 5, 6, 7],
  workStartMinute: 0,
  workEndMinute: 1440,
  holidays: [] as string[]
};

function definition(over: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    trigger: {
      kind: "lead_created",
      pipelineId: null,
      stageCategory: null,
      stageKey: null
    },
    taskTitle: "Call the new lead",
    dueAfterMinutes: 0,
    escalation: null,
    assignee: { mode: "lead_owner", tenantUserId: null },
    notify: { onAssign: true, onDue: false },
    maxOpenPerLead: 1,
    calendar: ALWAYS,
    ...over
  };
}

async function newRule(
  tenantId: string,
  actor: string,
  def: RuleDefinition = definition(),
  code = `rule-${(counter += 1)}`
): Promise<string> {
  const result = await inTenant(tenantId, (tx) =>
    createRule(tx, tenantId, actor, { code, name: "Rule", definition: def })
  );

  expect(result.outcome).toBe("created");
  return result.outcome === "created" ? result.rule.id : "";
}

async function enable(tenantId: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_crm_follow_up_settings (tenant_id, enabled)
    VALUES (${tenantId}, true)
    ON CONFLICT (tenant_id) DO UPDATE SET enabled = true
  `;
}

/** Publishes a crm_leads event the way crm_leads does (outbox row). */
async function publish(
  tenantId: string,
  eventType: string,
  leadId: string,
  payload: Record<string, unknown>
): Promise<string> {
  return inTenant(tenantId, async (tx) => {
    const result = await appendDomainEvent(tx, tenantId, {
      eventType,
      eventVersion: "1.0",
      aggregateType: "crm_leads.lead",
      aggregateId: leadId,
      producerModule: "crm_leads",
      payload: {
        contractVersion: "1",
        privacyClass: "pseudonymous",
        ...payload
      }
    });

    return result.eventId;
  });
}

function leadCreated(
  tenantId: string,
  leadId: string,
  owner: string | null,
  occurredAt = new Date()
) {
  return publish(tenantId, "awcms.crm_leads.lead.created", leadId, {
    leadId,
    pipelineId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    stageKey: "new",
    stageCategory: "new",
    ownerTenantUserId: owner,
    source: { touchId: crypto.randomUUID(), kind: "manual" },
    contactPointKinds: ["email"],
    occurredAt: occurredAt.toISOString(),
    recordedAt: occurredAt.toISOString()
  });
}

function dispatchEvents(tenantId: string) {
  return dispatchDomainEventsForTenant(worker(), tenantId);
}

function dispatchNotices(tenantId: string, now: Date) {
  return withTenantOrThrow(worker(), tenantId, (tx) =>
    runFollowUpDispatchPass(tx, tenantId, port, now)
  );
}

async function tasksOf(tenantId: string, leadId: string) {
  return (await getAdminSql()`
    SELECT id, status, assignee_tenant_user_id, cancel_reason, version, due_at
    FROM awcms_crm_follow_up_tasks
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
    ORDER BY created_at
  `) as {
    id: string;
    status: string;
    assignee_tenant_user_id: string | null;
    cancel_reason: string | null;
    version: number;
    due_at: Date;
  }[];
}

async function noticesOf(taskId: string) {
  return (await getAdminSql()`
    SELECT id, kind, recipient_tenant_user_id, status, settle_reason, scheduled_at
    FROM awcms_crm_follow_up_notifications
    WHERE task_id = ${taskId}
    ORDER BY created_at, kind
  `) as {
    id: string;
    kind: string;
    recipient_tenant_user_id: string;
    status: string;
    settle_reason: string | null;
    scheduled_at: Date;
  }[];
}

async function queuedMails(tenantId: string) {
  return (await getAdminSql()`
    SELECT template_key, to_address, subject, variables::text AS variables
    FROM awcms_email_messages
    WHERE tenant_id = ${tenantId} AND template_key LIKE 'crm.follow_up_%'
    ORDER BY created_at
  `) as {
    template_key: string;
    to_address: string;
    subject: string;
    variables: string;
  }[];
}

const inAMinute = () => new Date(Date.now() + 60_000);

const suite = integrationEnabled ? describe : describe.skip;

suite("crm_follow_up engine on the least-privilege roles (#1165)", () => {
  let owner = "";
  let other = "";
  let ownerB = "";

  beforeAll(async () => {
    savedEnabled = process.env.CRM_FOLLOW_UP_ENABLED;
    process.env.CRM_FOLLOW_UP_ENABLED = "true";
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    if (savedEnabled === undefined) delete process.env.CRM_FOLLOW_UP_ENABLED;
    else process.env.CRM_FOLLOW_UP_ENABLED = savedEnabled;
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'fu-a', 'Follow-up A'), (${TENANT_B}, 'fu-b', 'Follow-up B')
    `;
    owner = await seedUser(TENANT_A, "owner");
    other = await seedUser(TENANT_A, "other");
    ownerB = await seedUser(TENANT_B, "owner-b");
    await enable(TENANT_A);
    await enable(TENANT_B);
    await seedTemplates(TENANT_A, owner);
  });

  test("the consumer is registered for the six crm_leads events", () => {
    const registry = buildDomainEventConsumerRegistry(listModules());
    const consumer = registry.find((entry) => entry.name === CONSUMER);

    expect(consumer).toBeDefined();
    expect(consumer!.ownerModuleKey).toBe("crm_follow_up");
    expect(consumer!.eventTypes).toHaveLength(6);
  });

  test("a lead event creates one task for the owner with its notice, in its own tenant only", async () => {
    await newRule(TENANT_A, owner);
    await newRule(TENANT_B, ownerB);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);

    const tasks = await tasksOf(TENANT_A, lead);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe("open");
    expect(tasks[0]!.assignee_tenant_user_id).toBe(owner);
    expect((await noticesOf(tasks[0]!.id)).map((n) => n.kind)).toEqual([
      "assigned"
    ]);
    // Tenant B saw nothing, and RLS hides A's task from a B-scoped session.
    expect(await tasksOf(TENANT_B, lead)).toHaveLength(0);
    const visibleFromB = await inTenant(
      TENANT_B,
      (tx) => tx`SELECT id FROM awcms_crm_follow_up_tasks`
    );
    expect(visibleFromB).toHaveLength(0);
  });

  test("a replayed source event creates ONE task (handler called twice, then redelivered)", async () => {
    const ruleId = await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();
    const event: DomainEventForHandler = {
      id: crypto.randomUUID(),
      eventType: "awcms.crm_leads.lead.created",
      eventVersion: "1.0",
      aggregateType: "crm_leads.lead",
      aggregateId: lead,
      orderKey: `crm_leads.lead:${lead}`,
      correlationId: null,
      causationId: null,
      producerModule: "crm_leads",
      payload: {
        leadId: lead,
        pipelineId: crypto.randomUUID(),
        stageKey: "new",
        stageCategory: "new",
        ownerTenantUserId: owner,
        occurredAt: new Date().toISOString()
      },
      occurredAt: new Date(),
      recordedAt: new Date()
    };

    for (let i = 0; i < 3; i += 1) {
      await withTenantOrThrow(worker(), TENANT_A, (tx) =>
        handleLeadSignal(tx, TENANT_A, event)
      );
    }

    const tasks = await tasksOf(TENANT_A, lead);
    expect(tasks).toHaveLength(1);
    const actions = (await getAdminSql()`
      SELECT action FROM awcms_crm_follow_up_task_actions WHERE task_id = ${tasks[0]!.id}
    `) as { action: string }[];
    expect(actions).toHaveLength(1);
    expect(ruleId).not.toBe("");

    // Through the runtime: a second dispatch delivers nothing new.
    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    await dispatchEvents(TENANT_A);
    // The second, DIFFERENT event is capped by maxOpenPerLead = 1.
    expect(await tasksOf(TENANT_A, lead)).toHaveLength(1);
  });

  test("a stop recorded first blocks every later trigger, and the database refuses the insert", async () => {
    const ruleId = await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await inTenant(TENANT_A, (tx) =>
      recordStopSignal(tx, TENANT_A, {
        leadId: lead,
        kind: "consent_withdrawn",
        source: "staff",
        sourceEventId: null,
        recordedBy: owner,
        occurredAt: new Date()
      })
    );
    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);

    expect(await tasksOf(TENANT_A, lead)).toHaveLength(0);

    const revision = (await getAdminSql()`
      SELECT id FROM awcms_crm_follow_up_rule_revisions WHERE rule_id = ${ruleId}
    `) as { id: string }[];
    const error = await assertRejected(
      inTenant(
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_crm_follow_up_tasks
            (tenant_id, lead_id, rule_id, rule_revision_id, source_event_id,
             trigger_kind, title, assignee_mode, due_at)
          VALUES (${TENANT_A}, ${lead}, ${ruleId}, ${revision[0]!.id},
                  ${crypto.randomUUID()}, 'lead_created', 'x', 'lead_owner', now())`
      ),
      "a task for a stopped lead"
    );
    expect(error.message).toContain("CRM_FOLLOW_UP_LEAD_STOPPED");
  });

  test("a stop racing a trigger always wins: no live task survives", async () => {
    await newRule(TENANT_A, owner);

    for (let round = 0; round < 6; round += 1) {
      const lead = crypto.randomUUID();
      const trigger = withTenantOrThrow(worker(), TENANT_A, (tx) =>
        createTasksForTrigger(
          tx,
          TENANT_A,
          {
            kind: "lead_created",
            leadId: lead,
            pipelineId: null,
            stageCategory: "new",
            stageKey: "new",
            ownerTenantUserId: owner,
            occurredAt: new Date()
          },
          crypto.randomUUID()
        )
      );
      const stop = inTenant(TENANT_A, (tx) =>
        recordStopSignal(tx, TENANT_A, {
          leadId: lead,
          kind: "reply_received",
          source: "staff",
          sourceEventId: null,
          recordedBy: owner,
          occurredAt: new Date()
        })
      );

      await Promise.all(round % 2 === 0 ? [trigger, stop] : [stop, trigger]);

      const live = (await tasksOf(TENANT_A, lead)).filter((task) =>
        ["open", "escalated"].includes(task.status)
      );
      expect(live).toHaveLength(0);
    }
  });

  test("the dispatcher hands a due notice to the e-mail outbox with nothing about the lead", async () => {
    await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    const pass = await dispatchNotices(TENANT_A, inAMinute());

    expect(pass.enqueued).toBe(1);
    const mails = await queuedMails(TENANT_A);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.template_key).toBe("crm.follow_up_assigned");
    expect(mails[0]!.variables).not.toContain(lead);

    const task = (await tasksOf(TENANT_A, lead))[0]!;
    expect((await noticesOf(task.id))[0]!.status).toBe("enqueued");
  });

  test("opt-out (consent withdrawn) cancels the task and its pending notices; nothing is queued", async () => {
    await newRule(
      TENANT_A,
      owner,
      definition({ notify: { onAssign: true, onDue: true } })
    );
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    const task = (await tasksOf(TENANT_A, lead))[0]!;

    const stop = await inTenant(TENANT_A, (tx) =>
      recordStopSignal(tx, TENANT_A, {
        leadId: lead,
        kind: "consent_withdrawn",
        source: "staff",
        sourceEventId: null,
        recordedBy: owner,
        occurredAt: new Date()
      })
    );

    expect(stop.cancelledTaskIds).toEqual([task.id]);
    expect(stop.cancelledNotifications).toBe(2);
    expect(stop.alreadyEnqueuedNotifications).toBe(0);
    expect((await tasksOf(TENANT_A, lead))[0]!.cancel_reason).toBe(
      "stop_consent_withdrawn"
    );
    await dispatchNotices(TENANT_A, inAMinute());
    expect(await queuedMails(TENANT_A)).toHaveLength(0);
    expect(
      (await noticesOf(task.id)).every(
        (n) => n.status === "cancelled" && n.settle_reason === "lead_stopped"
      )
    ).toBe(true);
  });

  test("a reply racing a send: the notice is either sent and reported, or cancelled, never both", async () => {
    await newRule(TENANT_A, owner);

    for (let round = 0; round < 4; round += 1) {
      const lead = crypto.randomUUID();

      await leadCreated(TENANT_A, lead, owner);
      await dispatchEvents(TENANT_A);
      const task = (await tasksOf(TENANT_A, lead))[0]!;
      const [stop] = await Promise.all([
        inTenant(TENANT_A, (tx) =>
          recordStopSignal(tx, TENANT_A, {
            leadId: lead,
            kind: "reply_received",
            source: "staff",
            sourceEventId: null,
            recordedBy: owner,
            occurredAt: new Date()
          })
        ),
        dispatchNotices(TENANT_A, inAMinute())
      ]);
      const notice = (await noticesOf(task.id))[0]!;

      expect(["enqueued", "cancelled"]).toContain(notice.status);
      expect(notice.status === "enqueued").toBe(
        stop.alreadyEnqueuedNotifications === 1
      );
    }
  });

  test("an assignee whose account was revoked is never notified", async () => {
    await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, other);
    await dispatchEvents(TENANT_A);
    const task = (await tasksOf(TENANT_A, lead))[0]!;
    expect(task.assignee_tenant_user_id).toBe(other);

    await getAdminSql()`
      UPDATE awcms_tenant_users SET status = 'inactive' WHERE id = ${other}
    `;
    const pass = await dispatchNotices(TENANT_A, inAMinute());

    expect(pass.suppressed).toBe(1);
    expect(await queuedMails(TENANT_A)).toHaveLength(0);
    expect((await noticesOf(task.id))[0]!.settle_reason).toBe(
      "recipient_inactive"
    );

    // A task triggered for an already-inactive owner is left unassigned.
    const lead2 = crypto.randomUUID();
    await leadCreated(TENANT_A, lead2, other);
    await dispatchEvents(TENANT_A);
    expect((await tasksOf(TENANT_A, lead2))[0]!.assignee_tenant_user_id).toBe(
      null
    );
  });

  test("quiet hours: a notice outside the rule's working time waits for the next working instant", async () => {
    await newRule(
      TENANT_A,
      owner,
      definition({
        calendar: {
          timeZone: "Asia/Jakarta",
          workingDays: [1, 2, 3, 4, 5],
          workStartMinute: 540,
          workEndMinute: 1020,
          holidays: ["2030-01-07"]
        }
      })
    );
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    const task = (await tasksOf(TENANT_A, lead))[0]!;
    // Saturday 5 Jan 2030, 12:00 Jakarta. The next working instant skips the
    // weekend AND the Monday holiday: Tuesday 8 Jan 09:00 Jakarta = 02:00Z.
    const saturday = new Date("2030-01-05T05:00:00Z");
    const pass = await dispatchNotices(TENANT_A, saturday);

    expect(pass.deferred).toBe(1);
    expect(await queuedMails(TENANT_A)).toHaveLength(0);
    const notice = (await noticesOf(task.id))[0]!;
    expect(notice.status).toBe("pending");
    expect(notice.scheduled_at.toISOString()).toBe("2030-01-08T02:00:00.000Z");
  });

  test("escalation: an overdue open task escalates and notifies the escalation recipient", async () => {
    await newRule(
      TENANT_A,
      owner,
      definition({
        notify: { onAssign: false, onDue: false },
        escalation: { afterMinutes: 1, recipientTenantUserId: other }
      })
    );
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    const later = new Date(Date.now() + 5 * 60_000);
    const pass = await dispatchNotices(TENANT_A, later);

    expect(pass.escalated).toBe(1);
    const task = (await tasksOf(TENANT_A, lead))[0]!;
    expect(task.status).toBe("escalated");
    const notices = await noticesOf(task.id);
    expect(notices.map((n) => [n.kind, n.recipient_tenant_user_id])).toEqual([
      ["escalated", other]
    ]);
    expect(notices[0]!.status).toBe("enqueued");
    expect((await queuedMails(TENANT_A))[0]!.template_key).toBe(
      "crm.follow_up_escalated"
    );
  });

  test("lead.assigned moves a live lead-owner task to the new owner", async () => {
    await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    const task = (await tasksOf(TENANT_A, lead))[0]!;

    await publish(TENANT_A, "awcms.crm_leads.lead.assigned", lead, {
      leadId: lead,
      fromOwnerTenantUserId: owner,
      toOwnerTenantUserId: other,
      assignedAt: new Date().toISOString()
    });
    await dispatchEvents(TENANT_A);

    expect((await tasksOf(TENANT_A, lead))[0]!.assignee_tenant_user_id).toBe(
      other
    );
    const notices = await noticesOf(task.id);
    expect(
      notices.find((n) => n.recipient_tenant_user_id === owner)!.settle_reason
    ).toBe("recipient_changed");
    expect(
      notices.find((n) => n.recipient_tenant_user_id === other)!.status
    ).toBe("pending");
  });

  test("lead.converted stops the cadence through the consumer", async () => {
    await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    await publish(TENANT_A, "awcms.crm_leads.lead.converted", lead, {
      leadId: lead,
      conversionId: crypto.randomUUID(),
      mode: "authority_confirmed",
      externalCustomerRef: "CUST-1",
      evidenceRef: "INV-1",
      toStageKey: "won",
      occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString()
    });
    await dispatchEvents(TENANT_A);

    const task = (await tasksOf(TENANT_A, lead))[0]!;
    expect(task.status).toBe("cancelled");
    expect(task.cancel_reason).toBe("stop_converted");
  });

  test("completion uses optimistic concurrency; a closed task is frozen in the database", async () => {
    await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    const task = (await tasksOf(TENANT_A, lead))[0]!;

    const stale = await inTenant(TENANT_A, (tx) =>
      completeTask(tx, TENANT_A, owner, task.id, {
        expectedVersion: task.version + 5,
        outcome: "reached"
      })
    );
    expect(stale.outcome).toBe("version_conflict");

    const done = await inTenant(TENANT_A, (tx) =>
      completeTask(tx, TENANT_A, owner, task.id, {
        expectedVersion: task.version,
        outcome: "reached"
      })
    );
    expect(done.outcome).toBe("completed");

    const again = await inTenant(TENANT_A, (tx) =>
      completeTask(tx, TENANT_A, owner, task.id, {
        expectedVersion: task.version + 1,
        outcome: "other"
      })
    );
    expect(again.outcome).toBe("closed");

    await assertRejected(
      inTenant(
        TENANT_A,
        (tx) => tx`
          UPDATE awcms_crm_follow_up_tasks SET status = 'open', version = version + 1
          WHERE id = ${task.id}`
      ),
      "reopening a closed task"
    );
  });

  test("simulation reports the plan and writes nothing", async () => {
    const lead = crypto.randomUUID();

    await inTenant(TENANT_A, (tx) =>
      recordStopSignal(tx, TENANT_A, {
        leadId: lead,
        kind: "manual",
        source: "staff",
        sourceEventId: null,
        recordedBy: owner,
        occurredAt: new Date()
      })
    );
    const count = async () =>
      (await getAdminSql()`
        SELECT
          (SELECT count(*) FROM awcms_crm_follow_up_tasks)
          + (SELECT count(*) FROM awcms_crm_follow_up_task_actions)
          + (SELECT count(*) FROM awcms_crm_follow_up_notifications)
          + (SELECT count(*) FROM awcms_crm_follow_up_stop_signals)
          + (SELECT count(*) FROM awcms_crm_follow_up_rules)
          + (SELECT count(*) FROM awcms_audit_events)
          + (SELECT count(*) FROM awcms_domain_events) AS n
      `) as { n: string }[];
    const before = await count();
    const result = await inTenant(TENANT_A, (tx) =>
      simulateRevision(
        tx,
        TENANT_A,
        {
          definition: definition({
            trigger: {
              kind: "stage_entered",
              pipelineId: null,
              stageCategory: "qualified",
              stageKey: null
            },
            dueAfterMinutes: 90
          }),
          trigger: {
            kind: "stage_entered",
            pipelineId: null,
            stageCategory: "qualified",
            stageKey: "qualified",
            ownerTenantUserId: owner,
            occurredAt: new Date("2030-01-08T03:00:00Z")
          },
          leadId: lead
        },
        new Date("2030-01-08T03:00:00Z")
      )
    );

    expect(result.matches).toBe(true);
    expect(result.wouldCreateTask).toBe(false);
    expect(result.blockedBy).toEqual(["lead_stopped"]);
    expect(result.dueAt).toBe("2030-01-08T04:30:00.000Z");
    expect(result.assigneeTenantUserId).toBe(owner);
    expect(await count()).toEqual(before);
  });

  test("the runtime roles cannot delete, and the worker cannot write configuration", async () => {
    const ruleId = await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);

    await assertRejected(
      inTenant(TENANT_A, (tx) => tx`DELETE FROM awcms_crm_follow_up_tasks`),
      "awcms_app deleting a task"
    );
    await assertRejected(
      inTenant(
        TENANT_A,
        (
          tx
        ) => tx`UPDATE awcms_crm_follow_up_rule_revisions SET task_title = 'x'
                   WHERE rule_id = ${ruleId}`
      ),
      "editing a published revision"
    );
    await assertRejected(
      inTenant(
        TENANT_A,
        (tx) => tx`UPDATE awcms_crm_follow_up_stop_signals SET kind = 'manual'`
      ),
      "editing a stop signal"
    );

    if (workerRoleActivated) {
      await assertRejected(
        withTenantOrThrow(
          getWorkerRoleSql(),
          TENANT_A,
          (tx) => tx`UPDATE awcms_crm_follow_up_rules SET name = 'x'`
        ),
        "the worker writing a rule"
      );
      await assertRejected(
        withTenantOrThrow(
          getWorkerRoleSql(),
          TENANT_A,
          (tx) => tx`DELETE FROM awcms_crm_follow_up_notifications`
        ),
        "the worker deleting a notice"
      );
    }
  });

  test("a tenant whose switch is off gets no task", async () => {
    await newRule(TENANT_A, owner);
    await getAdminSql()`
      UPDATE awcms_crm_follow_up_settings SET enabled = false WHERE tenant_id = ${TENANT_A}
    `;
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);

    expect(await tasksOf(TENANT_A, lead)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Audit of PR #1266
  // -------------------------------------------------------------------------

  /** A revision with a calendar validation would refuse, written past it. */
  async function brokenRule(): Promise<string> {
    const ruleId = await newRule(TENANT_A, owner, definition(), "zz-broken");

    await getAdminSql().begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      await tx`
        UPDATE awcms_crm_follow_up_rule_revisions
        SET working_days = 1, work_start_minute = 0, work_end_minute = 1,
            due_after_minutes = 43200
        WHERE rule_id = ${ruleId}
      `;
    });

    return ruleId;
  }

  test("MEDIUM-1 (P2): a rule that cannot be planned is skipped; the healthy rule still creates its task and the delivery is not dead-lettered", async () => {
    const healthy = await newRule(TENANT_A, owner, definition(), "aa-healthy");
    await brokenRule();
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    const pass = await dispatchEvents(TENANT_A);

    const tasks = (await getAdminSql()`
      SELECT rule_id FROM awcms_crm_follow_up_tasks WHERE lead_id = ${lead}
    `) as { rule_id: string }[];
    expect(tasks.map((t) => t.rule_id)).toEqual([healthy]);
    expect(pass.deadLettered).toBe(0);
    const statuses = (await getAdminSql()`
      SELECT status FROM awcms_domain_event_deliveries
      WHERE tenant_id = ${TENANT_A} AND consumer_name = ${CONSUMER}
    `) as { status: string }[];
    expect(statuses.every((row) => row.status === "delivered")).toBe(true);
  });

  test("MEDIUM-1 (P3): a notice whose calendar has no working time is suppressed, and a failing tenant never stops the others", async () => {
    const ruleId = await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    await getAdminSql().begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      await tx`
        UPDATE awcms_crm_follow_up_rule_revisions
        SET time_zone = 'Mars/Base' WHERE rule_id = ${ruleId}
      `;
    });

    const pass = await dispatchNotices(TENANT_A, inAMinute());
    expect(pass.suppressed).toBe(1);
    const task = (await tasksOf(TENANT_A, lead))[0]!;
    expect((await noticesOf(task.id))[0]!.settle_reason).toBe(
      "calendar_unschedulable"
    );

    // Tenant isolation of the job: the first tenant visited fails, the
    // second still dispatches.
    await seedTemplates(TENANT_B, ownerB);
    await newRule(TENANT_A, owner, definition(), "second-a");
    await newRule(TENANT_B, ownerB);
    await leadCreated(TENANT_A, crypto.randomUUID(), owner);
    await leadCreated(TENANT_B, crypto.randomUUID(), ownerB);
    await dispatchEvents(TENANT_A);
    await dispatchEvents(TENANT_B);
    let calls = 0;
    const run = await runCrmFollowUpDispatch(
      worker(),
      { dryRun: false },
      port,
      () => {
        calls += 1;
        if (calls === 1) throw new Error("injected tenant failure");
        return inAMinute();
      }
    );

    expect(run.failedTenants).toHaveLength(1);
    expect(run.tenantsChecked).toBe(2);
    expect(run.totals.enqueued).toBe(1);
  });

  test("MEDIUM-2: Module Management's per-tenant switch stops the consumer and the dispatcher", async () => {
    await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    await getAdminSql()`
      INSERT INTO awcms_modules (module_key, module_name)
      VALUES ('crm_follow_up', 'CRM Follow-up')
      ON CONFLICT (module_key) DO NOTHING
    `;
    await getAdminSql()`
      INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
      VALUES (${TENANT_A}, 'crm_follow_up', false)
    `;

    const pass = await dispatchNotices(TENANT_A, inAMinute());
    expect(pass.enqueued).toBe(0);
    expect(await queuedMails(TENANT_A)).toHaveLength(0);

    const lead2 = crypto.randomUUID();
    await leadCreated(TENANT_A, lead2, owner);
    await dispatchEvents(TENANT_A);
    expect(await tasksOf(TENANT_A, lead2)).toHaveLength(0);
  });

  test("MEDIUM-2: the deployment switch off means no task and no notice", async () => {
    await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();

    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);
    process.env.CRM_FOLLOW_UP_ENABLED = "false";

    try {
      expect((await dispatchNotices(TENANT_A, inAMinute())).enqueued).toBe(0);
      const lead2 = crypto.randomUUID();
      await leadCreated(TENANT_A, lead2, owner);
      await dispatchEvents(TENANT_A);
      expect(await tasksOf(TENANT_A, lead2)).toHaveLength(0);
    } finally {
      process.env.CRM_FOLLOW_UP_ENABLED = "true";
    }

    expect(await queuedMails(TENANT_A)).toHaveLength(0);
  });

  test("MEDIUM-2: the hourly cap per recipient defers the notice over the cap", async () => {
    await getAdminSql()`
      UPDATE awcms_crm_follow_up_settings SET max_notices_per_recipient_hour = 1
      WHERE tenant_id = ${TENANT_A}
    `;
    await newRule(TENANT_A, owner);
    await leadCreated(TENANT_A, crypto.randomUUID(), owner);
    await leadCreated(TENANT_A, crypto.randomUUID(), owner);
    await dispatchEvents(TENANT_A);

    const pass = await dispatchNotices(TENANT_A, inAMinute());

    expect(pass.enqueued).toBe(1);
    expect(pass.deferred).toBe(1);
    expect(await queuedMails(TENANT_A)).toHaveLength(1);
  });

  test("LOW-5: no template means suppressed (not_queued), and the quota is not used", async () => {
    await getAdminSql()`DELETE FROM awcms_email_templates WHERE tenant_id = ${TENANT_A}`;
    await getAdminSql()`
      UPDATE awcms_crm_follow_up_settings SET max_notices_per_recipient_hour = 1
      WHERE tenant_id = ${TENANT_A}
    `;
    await newRule(TENANT_A, owner);
    await leadCreated(TENANT_A, crypto.randomUUID(), owner);
    await leadCreated(TENANT_A, crypto.randomUUID(), owner);
    await dispatchEvents(TENANT_A);

    const pass = await dispatchNotices(TENANT_A, inAMinute());

    expect(pass.enqueued).toBe(0);
    expect(pass.suppressed).toBe(2);
    expect(pass.deferred).toBe(0);
    const reasons = (await getAdminSql()`
      SELECT settle_reason FROM awcms_crm_follow_up_notifications
      WHERE tenant_id = ${TENANT_A}
    `) as { settle_reason: string }[];
    expect(reasons.every((row) => row.settle_reason === "not_queued")).toBe(
      true
    );
  });

  test("LOW-2: a stop event is recorded while the tenant switch is off, and still wins after it is switched on", async () => {
    await newRule(TENANT_A, owner);
    const lead = crypto.randomUUID();
    await getAdminSql()`
      UPDATE awcms_crm_follow_up_settings SET enabled = false WHERE tenant_id = ${TENANT_A}
    `;

    await publish(TENANT_A, "awcms.crm_leads.lead.lost", lead, {
      leadId: lead,
      pipelineId: crypto.randomUUID(),
      transitionId: crypto.randomUUID(),
      toStageKey: "lost",
      toCategory: "lost",
      occurredAt: new Date().toISOString()
    });
    await dispatchEvents(TENANT_A);
    await enable(TENANT_A);
    await leadCreated(TENANT_A, lead, owner);
    await dispatchEvents(TENANT_A);

    expect(await tasksOf(TENANT_A, lead)).toHaveLength(0);
    const stops = (await getAdminSql()`
      SELECT kind FROM awcms_crm_follow_up_stop_signals WHERE lead_id = ${lead}
    `) as { kind: string }[];
    expect(stops.map((row) => row.kind)).toEqual(["lost"]);
  });

  test("LOW-4: a staff stop is recorded once per (lead, kind)", async () => {
    const lead = crypto.randomUUID();
    const stop = () =>
      inTenant(TENANT_A, (tx) =>
        recordStopSignal(tx, TENANT_A, {
          leadId: lead,
          kind: "manual",
          source: "staff",
          sourceEventId: null,
          recordedBy: owner,
          occurredAt: new Date()
        })
      );

    expect((await stop()).replayed).toBe(false);
    expect((await stop()).replayed).toBe(true);
    const rows = (await getAdminSql()`
      SELECT id FROM awcms_crm_follow_up_stop_signals WHERE lead_id = ${lead}
    `) as { id: string }[];
    expect(rows).toHaveLength(1);
  });

  test("LOW-1: the worker cannot queue a crm notice to an outside address or with an unknown variable", async () => {
    if (!workerRoleActivated) return;
    const ownerAddress = (await getAdminSql()`
      SELECT lower(i.login_identifier) AS address
      FROM awcms_tenant_users tu JOIN awcms_identities i ON i.id = tu.identity_id
      WHERE tu.id = ${owner}
    `) as { address: string }[];
    const insert = (to: string, variables: Record<string, string>) =>
      withTenantOrThrow(
        getWorkerRoleSql(),
        TENANT_A,
        (tx) => tx`
          INSERT INTO awcms_email_messages
            (tenant_id, category, template_key, to_address, to_address_hash,
             to_address_masked, subject, variables)
          VALUES (${TENANT_A}, 'crm.follow_up_due', 'crm.follow_up_due', ${to},
                  'h', 'm', 's', ${variables}::jsonb)`
      );

    const outside = await assertRejected(
      insert("attacker@evil.test", { taskTitle: "x" }),
      "a crm notice to an outside address"
    );
    expect(outside.message).toContain("EMAIL_WORKER_RECIPIENT_NOT_STAFF");
    const variable = await assertRejected(
      insert(ownerAddress[0]!.address, { leadName: "Jane Prospect" }),
      "a crm notice with an unknown variable"
    );
    expect(variable.message).toContain("EMAIL_WORKER_VARIABLE_NOT_ALLOWED");
    await insert(ownerAddress[0]!.address, { taskTitle: "x", dueAt: "y" });
    expect(await queuedMails(TENANT_A)).toHaveLength(1);
  });
});
