/**
 * Automatic settlement of attendance corrections (#998), through the REAL domain-
 * event dispatcher on the least-privilege `awcms_worker` connection.
 *
 * What is proven here and nowhere else: the grants of `sql/280` are enough for the
 * consumer to do what `POST .../settle` does, and not enough to do anything else
 * (the events table accepts only a `correction`-sourced insert from the worker; the
 * proposal columns of a correction are not writable by it; the database guard still
 * refuses an approval the workflow did not give).
 *
 * Gated on `DATABASE_URL` (harness section Gating); the worker assertions are
 * skipped where `awcms_worker` is not activated.
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
import { DEFAULT_EMAIL_TEMPLATES } from "../../src/modules/email/domain/email-default-templates";
import { appendDomainEvent } from "../../src/modules/domain-event-runtime/application/append-domain-event";
import { dispatchDomainEventsForTenant } from "../../src/modules/domain-event-runtime/application/dispatch-domain-events";
import { buildDomainEventConsumerRegistry } from "../../src/modules/domain-event-runtime/infrastructure/consumer-registry";
import { listModules } from "../../src/modules/index";

const TENANT = "a9980000-0000-4000-8000-00000000000a";
const CONSUMER = "hr_workforce.attendance_correction_settler";
const REASON = "SENTINEL-autosettle-reason-q7 my mother was ill";

let counter = 0;

function inTenant<T>(fn: (tx: Bun.TransactionSQL) => Promise<T>): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), TENANT, fn);
}

async function seedUser(tag: string): Promise<string> {
  counter += 1;
  const sql = getAdminSql();
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${`Person ${tag}-${counter}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, ${`u${counter}-${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

async function employ(): Promise<string> {
  counter += 1;
  const profile = (await getAdminSql()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${`Employee ${counter}`})
    RETURNING id
  `) as { id: string }[];

  return inTenant(async (tx) => {
    const header = (await tx`
      INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
      VALUES (${TENANT}, ${profile[0]!.id}, ${`N-${counter}`}, '2026-01-01')
      RETURNING id
    `) as { id: string }[];

    await tx`
      INSERT INTO awcms_hr_employment_terms
        (tenant_id, employment_id, employment_type, status, effective_from)
      VALUES (${TENANT}, ${header[0]!.id}, 'permanent', 'active', '2026-01-01')
    `;

    return header[0]!.id;
  });
}

type Seeded = {
  correctionId: string;
  instanceId: string;
  taskId: string;
  requester: string;
};

/**
 * One approval node whose verdict picks the end, as the engine's graph would:
 * the database accepts an `approved` / `rejected` instance only when the
 * decisions of its completed tasks lead to that end (sql/301).
 */
const APPROVAL_GRAPH = {
  startNodeId: "approval",
  nodes: [
    { id: "approval", type: "approval", onApprove: "ok", onReject: "no" },
    { id: "ok", type: "end", outcome: "approved" },
    { id: "no", type: "end", outcome: "rejected" }
  ]
};

/**
 * For fixtures that deliberately carry a verdict the engine would never
 * produce (a rejection nobody decided): the workflow bindings (sql/252,
 * sql/301) refuse those writes, so these statements step outside them the way
 * a superuser maintenance session does -- `session_replication_role =
 * replica`, for the fixture statements only.
 */
async function asMaintenance<T>(
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return getAdminSql().begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");

    return fn(tx);
  }) as Promise<T>;
}

/** A pending correction with its workflow instance and one task, ready for a verdict. */
async function pending(
  employmentId: string,
  resourceType = "hr_attendance_correction"
): Promise<Seeded> {
  const sql = getAdminSql();
  const requester = await seedUser("requester");
  const correctionId = crypto.randomUUID();
  const definition = (await sql`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, version, lifecycle_status, graph)
    VALUES (${TENANT}, ${`hr.attendance_correction.${crypto.randomUUID()}`},
            'Correction', 1, 'active',
            ${APPROVAL_GRAPH}::jsonb)
    RETURNING id
  `) as { id: string }[];
  const instance = (await sql`
    INSERT INTO awcms_workflow_instances
      (tenant_id, workflow_definition_id, resource_type, resource_id, status,
       requested_by_tenant_user_id)
    VALUES (${TENANT}, ${definition[0]!.id}, ${resourceType},
            ${correctionId}, 'pending', ${requester})
    RETURNING id
  `) as { id: string }[];
  const task = (await sql`
    INSERT INTO awcms_workflow_tasks (tenant_id, workflow_instance_id, node_id)
    VALUES (${TENANT}, ${instance[0]!.id}, 'approval')
    RETURNING id
  `) as { id: string }[];

  if (resourceType === "hr_attendance_correction") {
    await inTenant(async (tx) => {
      await tx`
        INSERT INTO awcms_hr_attendance_corrections
          (id, tenant_id, employment_id, kind, proposed_kind,
           proposed_occurred_at, reason, workflow_instance_id, requested_by)
        VALUES (${correctionId}, ${TENANT}, ${employmentId}, 'add', 'clock_out',
                now() - interval '1 hour', ${REASON}, ${instance[0]!.id}, ${requester})
      `;
    });
  }

  return {
    correctionId,
    instanceId: instance[0]!.id,
    taskId: task[0]!.id,
    requester
  };
}

/**
 * The writes the engine makes for one decision, in one transaction: the
 * decider holds a pending seat on the task, records the decision, the seat is
 * marked decided and the task completes (sql/301 binds each of them).
 */
async function decide(taskId: string, by: string, decision: string) {
  await getAdminSql().begin(async (tx) => {
    await tx`
      INSERT INTO awcms_workflow_task_assignments
        (tenant_id, workflow_task_id, tenant_user_id)
      VALUES (${TENANT}, ${taskId}, ${by})
    `;
    await tx`
      INSERT INTO awcms_workflow_decisions
        (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id)
      VALUES (${TENANT}, ${taskId}, ${decision}, ${by})
    `;
    await tx`
      UPDATE awcms_workflow_task_assignments
      SET status = 'decided', decided_at = now()
      WHERE workflow_task_id = ${taskId} AND tenant_user_id = ${by}
    `;
    await tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${taskId}`;
  });
}

type Verdict = "approved" | "rejected" | "cancelled";

async function setVerdict(
  instanceId: string,
  verdict: Verdict,
  cancelledBy: string | null = null,
  forged = false
) {
  const write = (tx: Bun.TransactionSQL) => tx`
    UPDATE awcms_workflow_instances
    SET status = ${verdict},
        cancelled_by_tenant_user_id = ${cancelledBy}
    WHERE id = ${instanceId}
  `;

  if (forged) {
    await asMaintenance(write);
  } else {
    await getAdminSql().begin(write);
  }
}

/**
 * Finishes the instance and publishes the event, as the workflow engine does.
 * `forged` is for a verdict no decision backs (a graph that "rejected" with no
 * human decision): it is written in maintenance mode, because the database
 * refuses it otherwise.
 */
async function finish(
  seeded: Seeded,
  verdict: Verdict,
  cancelledBy: string | null = null,
  forged = false
) {
  await setVerdict(seeded.instanceId, verdict, cancelledBy, forged);
  await inTenant(async (tx) => {
    await appendDomainEvent(tx, TENANT, {
      eventType: `awcms.workflow.instance.${verdict}`,
      eventVersion: "1.0",
      aggregateType: "workflow_instance",
      aggregateId: seeded.instanceId,
      producerModule: "workflow",
      payload: { workflowKey: "hr.attendance_correction" }
    });
  });
}

function dispatch() {
  return dispatchDomainEventsForTenant(
    workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql(),
    TENANT
  );
}

async function correction(id: string) {
  const rows = (await getAdminSql()`
    SELECT status, decided_by, reason FROM awcms_hr_attendance_corrections
    WHERE id = ${id}
  `) as { status: string; decided_by: string | null; reason: string }[];

  return rows[0]!;
}

async function correctionEvents(id: string) {
  return (await getAdminSql()`
    SELECT source, recorded_by, supersedes_event_id
    FROM awcms_hr_attendance_events WHERE correction_id = ${id}
  `) as {
    source: string;
    recorded_by: string | null;
    supersedes_event_id: string | null;
  }[];
}

async function auditRows(action: string, resourceId: string) {
  return (await getAdminSql()`
    SELECT actor_tenant_user_id, severity, attributes::text AS metadata
    FROM awcms_audit_events
    WHERE tenant_id = ${TENANT} AND action = ${action}
      AND resource_id = ${resourceId}
  `) as {
    actor_tenant_user_id: string | null;
    severity: string;
    metadata: string;
  }[];
}

async function deliveryStatuses(instanceId: string) {
  const rows = (await getAdminSql()`
    SELECT d.status
    FROM awcms_domain_event_deliveries d
    JOIN awcms_domain_events e ON e.tenant_id = d.tenant_id AND e.id = d.event_id
    WHERE d.tenant_id = ${TENANT} AND d.consumer_name = ${CONSUMER}
      AND e.aggregate_id = ${instanceId}
  `) as { status: string }[];

  return rows.map((row) => row.status);
}

/** The tenant's active `hr.attendance_correction_*` e-mail templates (what turns the notice on). */
async function seedNoticeTemplates(by: string): Promise<void> {
  const sql = getAdminSql();

  for (const template of DEFAULT_EMAIL_TEMPLATES.filter((entry) =>
    entry.templateKey.startsWith("hr.attendance_correction_")
  )) {
    await sql`
      INSERT INTO awcms_email_templates
        (tenant_id, template_key, name, subject_template, text_body_template,
         created_by, updated_by)
      VALUES (${TENANT}, ${template.templateKey}, ${template.name},
              ${template.subjectTemplate}, ${template.textBodyTemplate},
              ${by}, ${by})
    `;
  }
}

type QueuedNotice = {
  template_key: string;
  correlation_id: string;
  to_address: string;
  subject: string;
  status: string;
  variables: Record<string, string>;
  raw: string;
};

async function queuedNotices(correctionId?: string): Promise<QueuedNotice[]> {
  return (await getAdminSql()`
    SELECT template_key, correlation_id, to_address, subject, status,
           variables, (variables::text || ' ' || subject) AS raw
    FROM awcms_email_messages
    WHERE tenant_id = ${TENANT} AND template_key LIKE 'hr.attendance_correction_%'
      AND (${correctionId ?? null}::text IS NULL
           OR correlation_id LIKE ${`%:${correctionId ?? ""}:%`})
    ORDER BY created_at
  `) as QueuedNotice[];
}

const suite = integrationEnabled ? describe : describe.skip;

suite("hr_workforce automatic settlement of corrections (#998)", () => {
  let employment = "";
  let approver = "";

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT}, 'at-auto', 'Autosettle')
    `;
    employment = await employ();
    approver = await seedUser("approver");
  });

  test("the consumer is registered for the three verdict events", () => {
    const registry = buildDomainEventConsumerRegistry(listModules());
    const consumer = registry.find((entry) => entry.name === CONSUMER);

    expect(consumer).toBeDefined();
    expect(consumer!.ownerModuleKey).toBe("hr_workforce");
    expect([...consumer!.eventTypes].sort()).toEqual([
      "awcms.workflow.instance.approved",
      "awcms.workflow.instance.cancelled",
      "awcms.workflow.instance.rejected"
    ]);
  });

  test("approved: the correction is approved and the superseding event appended, with no acting user", async () => {
    const seeded = await pending(employment);
    await decide(seeded.taskId, approver, "approve");
    await finish(seeded, "approved");

    const pass = await dispatch();

    expect(pass.delivered).toBeGreaterThanOrEqual(1);
    const row = await correction(seeded.correctionId);
    expect(row.status).toBe("approved");
    expect(row.decided_by).toBe(approver);
    const events = await correctionEvents(seeded.correctionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("correction");
    // The workflow, not a person, settled it: no recorder on the event.
    expect(events[0]!.recorded_by).toBeNull();

    const audit = await auditRows(
      "hr_workforce.attendance_correction.settled",
      seeded.correctionId
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_tenant_user_id).toBeNull();
    expect(audit[0]!.severity).toBe("warning");
    expect(audit[0]!.metadata).toContain("workflow_event");
    expect(audit[0]!.metadata).not.toContain("SENTINEL");
    expect(await deliveryStatuses(seeded.instanceId)).toEqual(["delivered"]);
  });

  test("rejected and cancelled: the correction is rejected / withdrawn and no event is written", async () => {
    const rejected = await pending(employment);
    await decide(rejected.taskId, approver, "reject");
    await finish(rejected, "rejected");

    const cancelled = await pending(employment);
    await finish(cancelled, "cancelled", approver);

    await dispatch();

    const first = await correction(rejected.correctionId);
    expect(first.status).toBe("rejected");
    expect(first.decided_by).toBe(approver);
    expect(await correctionEvents(rejected.correctionId)).toHaveLength(0);

    const second = await correction(cancelled.correctionId);
    expect(second.status).toBe("withdrawn");
    expect(second.decided_by).toBe(approver);
    expect(await correctionEvents(cancelled.correctionId)).toHaveLength(0);
  });

  test("a rejection or cancellation that names nobody is settled with decided_by NULL (never the settler), audited with the trigger", async () => {
    const rejected = await pending(employment);
    // The graph rejected with no human decision recorded: state the engine
    // would never write, so it is forged in maintenance mode.
    await finish(rejected, "rejected", null, true);

    const cancelled = await pending(employment);
    await finish(cancelled, "cancelled", null);

    await dispatch();

    const first = await correction(rejected.correctionId);
    const second = await correction(cancelled.correctionId);

    expect(first.status).toBe("rejected");
    expect(first.decided_by).toBeNull();
    expect(second.status).toBe("withdrawn");
    expect(second.decided_by).toBeNull();

    for (const item of [rejected, cancelled]) {
      const audit = await auditRows(
        "hr_workforce.attendance_correction.settled",
        item.correctionId
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actor_tenant_user_id).toBeNull();
      expect(audit[0]!.metadata).toContain("workflow_event");
      expect(
        await auditRows(
          "hr_workforce.attendance_correction.auto_settle_skipped",
          item.correctionId
        )
      ).toHaveLength(0);
    }
  });

  test("a requester settling a rejection nobody decided is NOT recorded as its decider; the audit row names the settler", async () => {
    const seeded = await pending(employment);
    await finish(seeded, "rejected", null, true);
    // Remove the delivery's effect: settle by hand, as the requester.
    await inTenant(async (tx) => {
      const { settleCorrection } =
        await import("../../src/modules/hr-workforce/application/hr-attendance-directory");
      const result = await settleCorrection(
        tx,
        TENANT,
        seeded.correctionId,
        { actorTenantUserId: seeded.requester, correlationId: undefined },
        new Date()
      );
      expect(result.outcome).toBe("ok");
    });

    const row = await correction(seeded.correctionId);
    expect(row.status).toBe("rejected");
    expect(row.decided_by).toBeNull();
    const audit = await auditRows(
      "hr_workforce.attendance_correction.settled",
      seeded.correctionId
    );
    expect(audit[0]!.actor_tenant_user_id).toBe(seeded.requester);
  });

  test("an event that is not a workflow-instance event, or whose instance is still pending, is ignored without a warning row", async () => {
    const spoofed = await pending(employment);
    await decide(spoofed.taskId, approver, "approve");
    await setVerdict(spoofed.instanceId, "approved");
    await inTenant(async (tx) => {
      await appendDomainEvent(tx, TENANT, {
        eventType: "awcms.workflow.instance.approved",
        eventVersion: "1.0",
        aggregateType: "not_a_workflow_instance",
        aggregateId: spoofed.instanceId,
        producerModule: "workflow",
        payload: { workflowKey: "x" }
      });
    });

    const early = await pending(employment);
    await inTenant(async (tx) => {
      await appendDomainEvent(tx, TENANT, {
        eventType: "awcms.workflow.instance.approved",
        eventVersion: "1.0",
        aggregateType: "workflow_instance",
        aggregateId: early.instanceId,
        producerModule: "workflow",
        payload: { workflowKey: "x" }
      });
    });

    await dispatch();

    for (const item of [spoofed, early]) {
      expect((await correction(item.correctionId)).status).toBe("pending");
      expect(
        await auditRows(
          "hr_workforce.attendance_correction.auto_settle_skipped",
          item.correctionId
        )
      ).toHaveLength(0);
      expect(await deliveryStatuses(item.instanceId)).toEqual(["delivered"]);
    }
  });

  test("segregation of duties still holds: a requester-approved instance is left pending, not applied", async () => {
    const seeded = await pending(employment);
    // Forged around the engine's own guard (the database repeats the check).
    await decide(seeded.taskId, seeded.requester, "approve");
    await finish(seeded, "approved");

    await dispatch();

    expect((await correction(seeded.correctionId)).status).toBe("pending");
    expect(await correctionEvents(seeded.correctionId)).toHaveLength(0);
    const audit = await auditRows(
      "hr_workforce.attendance_correction.auto_settle_skipped",
      seeded.correctionId
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toContain("self_approved");
    // A refusal is an answer, not a failure: nothing to retry or dead-letter.
    expect(await deliveryStatuses(seeded.instanceId)).toEqual(["delivered"]);
  });

  test("an instance that is not a correction's is ignored, and a redelivery changes nothing", async () => {
    const other = await pending(employment, "procurement_document");
    await decide(other.taskId, approver, "approve");
    await finish(other, "approved");
    const done = await pending(employment);
    await decide(done.taskId, approver, "approve");
    await finish(done, "approved");

    await dispatch();
    await dispatch();

    expect(await deliveryStatuses(other.instanceId)).toEqual(["delivered"]);
    expect((await correction(done.correctionId)).status).toBe("approved");
    expect(await correctionEvents(done.correctionId)).toHaveLength(1);
    expect(
      await auditRows(
        "hr_workforce.attendance_correction.settled",
        done.correctionId
      )
    ).toHaveLength(1);
  });

  test("the manual route's result and the consumer's agree: a correction settled by hand is a no-op for the consumer", async () => {
    const seeded = await pending(employment);
    await decide(seeded.taskId, approver, "approve");
    await finish(seeded, "approved");

    // Somebody got there first (the manual path leaves the same end state).
    await inTenant(async (tx) => {
      const { settleCorrection } =
        await import("../../src/modules/hr-workforce/application/hr-attendance-directory");
      const result = await settleCorrection(
        tx,
        TENANT,
        seeded.correctionId,
        { actorTenantUserId: approver, correlationId: undefined },
        new Date()
      );
      expect(result.outcome).toBe("ok");
    });

    await dispatch();

    expect(await correctionEvents(seeded.correctionId)).toHaveLength(1);
    expect(await deliveryStatuses(seeded.instanceId)).toEqual(["delivered"]);
  });

  describe("the requester is told how it ended (#1044)", () => {
    test("approved: one e-mail is queued to the requester, in the outbox, naming the employee and the date and never the reason", async () => {
      await seedNoticeTemplates(approver);
      const seeded = await pending(employment);
      await decide(seeded.taskId, approver, "approve");
      await finish(seeded, "approved");

      await dispatch();

      expect((await correction(seeded.correctionId)).status).toBe("approved");
      const notices = await queuedNotices(seeded.correctionId);
      expect(notices).toHaveLength(1);
      const notice = notices[0]!;
      expect(notice.template_key).toBe("hr.attendance_correction_applied");
      expect(notice.correlation_id).toBe(
        `hr_workforce.attendance_correction:${seeded.correctionId}:applied`
      );
      expect(notice.to_address).toContain("-requester@example.com");
      // The outbox, not a send: the provider is called later, by email:dispatch.
      expect(notice.status).toBe("queued");
      expect(notice.variables.employeeName).toMatch(/^Employee \d+$/);
      expect(notice.variables.correctionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(notice.raw).not.toContain("SENTINEL");
      expect(notice.raw).not.toContain("mother");
      expect(Object.keys(notice.variables).sort()).toEqual([
        "correctionDate",
        "employeeName",
        "userName"
      ]);
      expect(await deliveryStatuses(seeded.instanceId)).toEqual(["delivered"]);
    });

    test("a redelivered or second event for the same instance does not notify twice", async () => {
      await seedNoticeTemplates(approver);
      const seeded = await pending(employment);
      await decide(seeded.taskId, approver, "approve");
      await finish(seeded, "approved");
      await dispatch();

      // A second event for the same instance (the settled correction is final).
      await inTenant(async (tx) => {
        await appendDomainEvent(tx, TENANT, {
          eventType: "awcms.workflow.instance.approved",
          eventVersion: "1.0",
          aggregateType: "workflow_instance",
          aggregateId: seeded.instanceId,
          producerModule: "workflow",
          payload: { workflowKey: "hr.attendance_correction" }
        });
      });
      await dispatch();

      // The same delivery put back to pending: the effect ledger makes it a no-op.
      await getAdminSql()`
        UPDATE awcms_domain_event_deliveries
        SET status = 'pending', next_attempt_at = now()
        WHERE tenant_id = ${TENANT} AND consumer_name = ${CONSUMER}
      `;
      await dispatch();

      expect(await queuedNotices(seeded.correctionId)).toHaveLength(1);
      expect(
        await auditRows(
          "hr_workforce.attendance_correction.settled",
          seeded.correctionId
        )
      ).toHaveLength(1);
    });

    test("rejected and cancelled each queue one notice with their own outcome", async () => {
      await seedNoticeTemplates(approver);
      const rejected = await pending(employment);
      await decide(rejected.taskId, approver, "reject");
      await finish(rejected, "rejected");
      const cancelled = await pending(employment);
      await finish(cancelled, "cancelled", approver);

      await dispatch();

      const first = await queuedNotices(rejected.correctionId);
      expect(first).toHaveLength(1);
      expect(first[0]!.template_key).toBe("hr.attendance_correction_rejected");
      expect(first[0]!.correlation_id).toEndWith(":rejected");
      expect(first[0]!.raw).not.toContain("SENTINEL");

      const second = await queuedNotices(cancelled.correctionId);
      expect(second).toHaveLength(1);
      expect(second[0]!.template_key).toBe(
        "hr.attendance_correction_cancelled"
      );
      expect(second[0]!.correlation_id).toEndWith(":cancelled");
      expect(second[0]!.raw).not.toContain("SENTINEL");
    });

    test("the subject is rendered in the tenant's default locale", async () => {
      await seedNoticeTemplates(approver);
      await getAdminSql()`
        UPDATE awcms_tenants SET default_locale = 'id' WHERE id = ${TENANT}
      `;
      const seeded = await pending(employment);
      await decide(seeded.taskId, approver, "approve");
      await finish(seeded, "approved");

      await dispatch();

      const notices = await queuedNotices(seeded.correctionId);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.subject).toContain("disetujui");
    });

    test("a tenant with no notice templates is unaffected: the correction settles and nothing is queued", async () => {
      const seeded = await pending(employment);
      await decide(seeded.taskId, approver, "approve");
      await finish(seeded, "approved");

      await dispatch();

      expect((await correction(seeded.correctionId)).status).toBe("approved");
      expect(await queuedNotices()).toHaveLength(0);
      expect(await deliveryStatuses(seeded.instanceId)).toEqual(["delivered"]);
    });

    test("a refused settlement (segregation of duties) tells nobody", async () => {
      await seedNoticeTemplates(approver);
      const seeded = await pending(employment);
      await decide(seeded.taskId, seeded.requester, "approve");
      await finish(seeded, "approved");

      await dispatch();

      expect((await correction(seeded.correctionId)).status).toBe("pending");
      expect(await queuedNotices()).toHaveLength(0);
    });

    test("an unmailable requester (inactive login) costs neither the settlement nor a notice", async () => {
      await seedNoticeTemplates(approver);
      const seeded = await pending(employment);
      await decide(seeded.taskId, approver, "approve");
      await getAdminSql()`
        UPDATE awcms_tenant_users SET status = 'inactive'
        WHERE id = ${seeded.requester}
      `;
      await finish(seeded, "approved");

      await dispatch();

      expect((await correction(seeded.correctionId)).status).toBe("approved");
      expect(await queuedNotices()).toHaveLength(0);
    });

    test("a notifier that throws, or fails in SQL, never costs the settlement (the savepoint)", async () => {
      const { settleCorrectionForInstance } =
        await import("../../src/modules/hr-workforce/application/hr-attendance-settlement");
      const failures: Record<string, (tx: Bun.SQL) => Promise<void>> = {
        throws: async () => {
          throw new Error("provider exploded");
        },
        sql: async (tx) => {
          await tx`SELECT * FROM awcms_table_that_does_not_exist`;
        }
      };

      for (const [label, enqueue] of Object.entries(failures)) {
        const seeded = await pending(employment);
        await decide(seeded.taskId, approver, "approve");
        await setVerdict(seeded.instanceId, "approved");

        const result = await inTenant((tx) =>
          settleCorrectionForInstance(
            tx,
            TENANT,
            seeded.instanceId,
            undefined,
            new Date(),
            { enqueueNotification: (sp) => enqueue(sp) }
          )
        );

        expect(result.outcome, label).toBe("settled");
        expect((await correction(seeded.correctionId)).status, label).toBe(
          "approved"
        );
        expect(await correctionEvents(seeded.correctionId), label).toHaveLength(
          1
        );
        expect(await queuedNotices(seeded.correctionId), label).toHaveLength(0);
      }
    });

    test("a newline in the employee's name cannot break the subject", async () => {
      await seedNoticeTemplates(approver);
      await getAdminSql()`
        UPDATE awcms_profiles SET display_name = E'Eve\r\nBcc: x@evil.test'
        WHERE id = (SELECT profile_id FROM awcms_hr_employments WHERE id = ${employment})
      `;
      const seeded = await pending(employment);
      await decide(seeded.taskId, approver, "approve");
      await finish(seeded, "approved");

      await dispatch();

      const notices = await queuedNotices(seeded.correctionId);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.subject).not.toMatch(/[\r\n\t]/);
      expect(notices[0]!.subject).toContain("Eve Bcc: x@evil.test");
    });

    test("the worker can queue only the allow-listed categories (row guard, sql/302)", async () => {
      if (!workerRoleActivated) return;
      const worker = getWorkerRoleSql();
      const insert = (category: string) =>
        withTenantOrThrow(
          worker,
          TENANT,
          (tx) => tx`
            INSERT INTO awcms_email_messages
              (tenant_id, category, template_key, to_address, to_address_hash,
               to_address_masked, subject)
            VALUES (${TENANT}, ${category}, ${category}, 'a@b.test', 'h', 'm', 's')`
        );

      await assertRejected(
        insert("derived.transactional"),
        "EMAIL_WORKER_CATEGORY_NOT_ALLOWED|42501"
      );
      await assertRejected(
        insert("system.announcement"),
        "EMAIL_WORKER_CATEGORY_NOT_ALLOWED|42501"
      );
      await insert("hr.attendance_correction_applied");
      expect(await queuedNotices()).toHaveLength(1);
    });

    test("the worker may queue the notice but not choose the state of the row it creates", async () => {
      if (!workerRoleActivated) return;
      const worker = getWorkerRoleSql();

      await assertRejected(
        withTenantOrThrow(
          worker,
          TENANT,
          (tx) => tx`
            INSERT INTO awcms_email_messages
              (tenant_id, category, to_address, to_address_hash,
               to_address_masked, subject, status)
            VALUES (${TENANT}, 'hr.attendance_correction_applied', 'a@b.c',
                    'h', 'm', 's', 'sent')`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        withTenantOrThrow(
          worker,
          TENANT,
          (tx) => tx`SELECT created_at FROM awcms_tenant_users LIMIT 1`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        withTenantOrThrow(
          worker,
          TENANT,
          (tx) => tx`SELECT profile_type FROM awcms_profiles LIMIT 1`
        ),
        "permission denied|42501"
      );
    });
  });

  describe("what the worker may NOT do (sql/280)", () => {
    test("it cannot read the sensitive text columns, and its column UPDATE grants are exactly the settlement's", async () => {
      if (!workerRoleActivated) return;
      const worker = getWorkerRoleSql();
      const seeded = await pending(employment);
      await decide(seeded.taskId, approver, "approve");
      const attempt = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
        withTenantOrThrow(worker, TENANT, fn);

      // Allowed: the columns a settlement reads.
      await attempt(
        (tx) =>
          tx`SELECT status, decided_by FROM awcms_hr_attendance_corrections`
      );
      await attempt(
        (tx) => tx`SELECT decision, decided_by_tenant_user_id,
                          on_behalf_of_tenant_user_id
                   FROM awcms_workflow_decisions`
      );

      // Not the free text (SELECT * is refused too: it names every column).
      for (const probe of [
        (tx: Bun.TransactionSQL) =>
          tx`SELECT reason FROM awcms_hr_attendance_corrections`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT * FROM awcms_hr_attendance_corrections`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT reason FROM awcms_workflow_decisions`,
        (tx: Bun.TransactionSQL) =>
          tx`SELECT override_reason FROM awcms_workflow_decisions`
      ]) {
        await assertRejected(attempt(probe), "permission denied|42501");
      }

      const columns = async (table: string, privilege: string) =>
        (
          (await getAdminSql()`
            SELECT column_name FROM information_schema.column_privileges
            WHERE grantee = 'awcms_worker' AND table_name = ${table}
              AND privilege_type = ${privilege}
            ORDER BY column_name`) as { column_name: string }[]
        ).map((row) => row.column_name);

      expect(
        await columns("awcms_hr_attendance_corrections", "UPDATE")
      ).toEqual(["decided_at", "decided_by", "status", "updated_at"]);
      expect(
        await columns("awcms_hr_attendance_corrections", "SELECT")
      ).not.toContain("reason");
      expect(await columns("awcms_workflow_decisions", "SELECT")).not.toContain(
        "reason"
      );
      expect(await columns("awcms_workflow_decisions", "SELECT")).not.toContain(
        "override_reason"
      );
      expect(await columns("awcms_hr_employments", "UPDATE")).toEqual([
        "updated_at"
      ]);
      expect(await columns("awcms_workflow_instances", "UPDATE")).toEqual([
        "updated_at"
      ]);
    });

    test("a login that is merely a MEMBER of awcms_worker cannot forge a non-correction event either", async () => {
      if (!workerRoleActivated) return;
      const admin = getAdminSql();
      const role = `awcms_t998_${crypto.randomUUID().slice(0, 8)}`;
      const password = crypto.randomUUID();
      const database = (
        (await admin`SELECT current_database() AS name`) as { name: string }[]
      )[0]!.name;
      const url = new URL(process.env.DATABASE_URL!);
      url.username = role;
      url.password = password;
      url.pathname = `/${database}`;

      await admin.unsafe(
        `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' IN ROLE awcms_worker`
      );
      const member = new Bun.SQL(url.toString(), { max: 1 });

      try {
        await assertRejected(
          withTenantOrThrow(
            member,
            TENANT,
            (tx) => tx`
              INSERT INTO awcms_hr_attendance_events
                (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
              VALUES (${TENANT}, ${employment}, 'clock_in', now(), 'self', 'forged-m')`
          ),
          "HR_ATTENDANCE_WORKER_CORRECTION_ONLY|42501"
        );
        expect(
          (
            await getAdminSql()`
            SELECT count(*)::int AS n FROM awcms_hr_attendance_events
            WHERE client_event_key = 'forged-m'`
          )[0].n
        ).toBe(0);
      } finally {
        await member.close();
        await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
      }
    });

    test("it cannot write a non-correction event, edit a proposal, or delete", async () => {
      if (!workerRoleActivated) return;
      const worker = getWorkerRoleSql();
      const seeded = await pending(employment);

      const attempt = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
        withTenantOrThrow(worker, TENANT, fn);

      // Not an event of a person: the worker guard admits only a correction.
      await assertRejected(
        attempt(
          (tx) => tx`
            INSERT INTO awcms_hr_attendance_events
              (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
            VALUES (${TENANT}, ${employment}, 'clock_in', now(), 'self', 'forged-1')`
        ),
        "HR_ATTENDANCE_WORKER_CORRECTION_ONLY|42501"
      );
      // Not the proposal: column-scoped UPDATE.
      await assertRejected(
        attempt(
          (tx) => tx`
            UPDATE awcms_hr_attendance_corrections SET reason = 'edited'
            WHERE id = ${seeded.correctionId}`
        ),
        "permission denied|42501"
      );
      // Not an approval the workflow did not give: the guard trigger.
      await assertRejected(
        attempt(
          (tx) => tx`
            UPDATE awcms_hr_attendance_corrections
            SET status = 'approved', decided_by = ${approver}, decided_at = now()
            WHERE id = ${seeded.correctionId}`
        ),
        "HR_CORRECTION_VERDICT_MISMATCH|23514"
      );
      await assertRejected(
        attempt(
          (tx) => tx`DELETE FROM awcms_hr_attendance_events
                     WHERE tenant_id = ${TENANT}`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        attempt(
          (tx) => tx`UPDATE awcms_hr_employments SET employee_no = 'X'
                     WHERE tenant_id = ${TENANT}`
        ),
        "permission denied|42501"
      );
      expect((await correction(seeded.correctionId)).status).toBe("pending");
    });
  });
});
