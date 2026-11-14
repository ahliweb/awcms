/**
 * Settlement of an omes_control request by a workflow's LATER verdict (Issue
 * ahliweb/awcms#1335), through the REAL domain-event dispatcher on the least-
 * privilege `awcms_worker` connection.
 *
 * Before the fix a destructive operation request stayed `requested` (and an AI
 * egress approval `pending`) for ever after a human decided in the workflow
 * inbox, so an approved operation never became a job. Gated on `DATABASE_URL`
 * (harness section Gating); the worker assertions are skipped where
 * `awcms_worker` is not activated.
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
import { appendDomainEvent } from "../../src/modules/domain-event-runtime/application/append-domain-event";
import { dispatchDomainEventsForTenant } from "../../src/modules/domain-event-runtime/application/dispatch-domain-events";
import { buildDomainEventConsumerRegistry } from "../../src/modules/domain-event-runtime/infrastructure/consumer-registry";
import { listModules } from "../../src/modules/index";
import { promoteNextApprovedOperation } from "../../src/modules/omes-control/application/worker-job-queue";

const TENANT = "13350000-0000-4000-8000-00000000000a";
const OTHER = "13350000-0000-4000-8000-00000000000b";
const CONSUMER = "omes_control.workflow_verdict_settler";
const SENTINEL = "SENTINEL-1335-justification-z9";

let counter = 0;

function inTenant<T>(
  tenant: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenant, fn);
}

async function seedUser(tenant: string, tag: string): Promise<string> {
  counter += 1;
  const sql = getAdminSql();
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenant}, 'person', ${`Person ${tag}-${counter}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenant}, ${profile[0]!.id}, ${`u${counter}-${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenant}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

const APPROVAL_GRAPH = {
  startNodeId: "approval",
  nodes: [
    { id: "approval", type: "approval", onApprove: "ok", onReject: "no" },
    { id: "ok", type: "end", outcome: "approved" },
    { id: "no", type: "end", outcome: "rejected" }
  ]
};

type Seeded = {
  instanceId: string;
  taskId: string;
  requester: string;
  rowId: string;
  tenant: string;
};

/** A pending workflow instance plus the omes row linked to it. */
async function pendingRequest(
  tenant: string,
  kind: "operation" | "egress",
  workflowKey: string,
  serverId = "srv-1335"
): Promise<Seeded> {
  const sql = getAdminSql();
  const requester = await seedUser(tenant, "requester");
  const resourceId = crypto.randomUUID();
  const definition = (await sql`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, version, lifecycle_status, graph)
    VALUES (${tenant}, ${`${workflowKey}.${crypto.randomUUID()}`}, 'Verdict', 1,
            'active', ${APPROVAL_GRAPH}::jsonb)
    RETURNING id
  `) as { id: string }[];
  const instance = (await sql`
    INSERT INTO awcms_workflow_instances
      (tenant_id, workflow_definition_id, resource_type, resource_id, status,
       requested_by_tenant_user_id)
    VALUES (${tenant}, ${definition[0]!.id}, ${`omes_${kind}`},
            ${resourceId}, 'pending', ${requester})
    RETURNING id
  `) as { id: string }[];
  const task = (await sql`
    INSERT INTO awcms_workflow_tasks (tenant_id, workflow_instance_id, node_id)
    VALUES (${tenant}, ${instance[0]!.id}, 'approval')
    RETURNING id
  `) as { id: string }[];

  if (kind === "operation") {
    await sql`
      INSERT INTO awcms_omes_operation_requests
        (id, tenant_id, request_id, server_id, operation, parameters, status,
         requested_by, workflow_instance_id)
      VALUES (${resourceId}, ${tenant}, ${`req-${resourceId}`}, ${serverId},
              'stop', ${{ note: SENTINEL }}::jsonb, 'requested', ${requester},
              ${instance[0]!.id})
    `;
  } else {
    await sql`
      INSERT INTO awcms_omes_ai_egress_approvals
        (id, tenant_id, correlation_id, idempotency_key, server_id,
         policy_version, classification, destination, reason_code, justification,
         requested_approve, decision, requested_by_tenant_user_id,
         workflow_instance_id)
      VALUES (${resourceId}, ${tenant}, ${`corr-${resourceId}`},
              ${`idem-${resourceId}`}, ${serverId}, 'v1', 'CONFIDENTIAL',
              'private_endpoint',
              'AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_PRIVATE_ENDPOINT',
              ${SENTINEL}, true, 'pending', ${requester}, ${instance[0]!.id})
    `;
  }

  return {
    instanceId: instance[0]!.id,
    taskId: task[0]!.id,
    requester,
    rowId: resourceId,
    tenant
  };
}

/** The writes the engine makes for one decision (sql/301 binds each). */
async function decide(seeded: Seeded, by: string, decision: string) {
  await getAdminSql().begin(async (tx) => {
    await tx`
      INSERT INTO awcms_workflow_task_assignments
        (tenant_id, workflow_task_id, tenant_user_id)
      VALUES (${seeded.tenant}, ${seeded.taskId}, ${by})
    `;
    await tx`
      INSERT INTO awcms_workflow_decisions
        (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id)
      VALUES (${seeded.tenant}, ${seeded.taskId}, ${decision}, ${by})
    `;
    await tx`
      UPDATE awcms_workflow_task_assignments
      SET status = 'decided', decided_at = now()
      WHERE workflow_task_id = ${seeded.taskId} AND tenant_user_id = ${by}
    `;
    await tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${seeded.taskId}`;
  });
}

type Verdict = "approved" | "rejected" | "cancelled";

/** Finishes the instance and publishes the event, as the workflow engine does. */
async function finish(seeded: Seeded, verdict: Verdict) {
  await getAdminSql().begin(
    (tx) => tx`
      UPDATE awcms_workflow_instances SET status = ${verdict}
      WHERE id = ${seeded.instanceId}`
  );
  await publish(seeded.tenant, seeded.instanceId, verdict);
}

async function publish(tenant: string, instanceId: string, verdict: Verdict) {
  await inTenant(tenant, async (tx) => {
    await appendDomainEvent(tx, tenant, {
      eventType: `awcms.workflow.instance.${verdict}`,
      eventVersion: "1.0",
      aggregateType: "workflow_instance",
      aggregateId: instanceId,
      producerModule: "workflow",
      payload: { workflowKey: "omes_control.destructive_operation" }
    });
  });
}

function dispatch(tenant = TENANT) {
  return dispatchDomainEventsForTenant(
    workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql(),
    tenant
  );
}

async function operation(id: string) {
  return (
    (await getAdminSql()`
      SELECT status, approved_by FROM awcms_omes_operation_requests WHERE id = ${id}
    `) as { status: string; approved_by: string | null }[]
  )[0]!;
}

async function egress(id: string) {
  return (
    (await getAdminSql()`
      SELECT decision, decided_at FROM awcms_omes_ai_egress_approvals WHERE id = ${id}
    `) as { decision: string; decided_at: Date | null }[]
  )[0]!;
}

async function auditRows(action: string, resourceId: string) {
  return (await getAdminSql()`
    SELECT actor_tenant_user_id, severity, attributes::text AS metadata
    FROM awcms_audit_events
    WHERE action = ${action} AND resource_id = ${resourceId}
  `) as {
    actor_tenant_user_id: string | null;
    severity: string;
    metadata: string;
  }[];
}

async function jobCount(requestId: string): Promise<number> {
  return (
    (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_omes_jobs
      WHERE operation_request_id = ${requestId}`) as { n: number }[]
  )[0]!.n;
}

const DESTRUCTIVE = "omes_control.destructive_operation";
const EGRESS = "omes_control.ai_egress_approval";

const suite = integrationEnabled ? describe : describe.skip;

suite("omes_control workflow verdict settlement (#1335)", () => {
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
      VALUES (${TENANT}, 'omes-v-a', 'Verdict A'), (${OTHER}, 'omes-v-b', 'Verdict B')
    `;
    approver = await seedUser(TENANT, "approver");
  });

  test("the consumer is registered for the three verdict events", () => {
    const registry = buildDomainEventConsumerRegistry(listModules());
    const consumer = registry.find((entry) => entry.name === CONSUMER);

    expect(consumer).toBeDefined();
    expect(consumer!.ownerModuleKey).toBe("omes_control");
    expect([...consumer!.eventTypes].sort()).toEqual([
      "awcms.workflow.instance.approved",
      "awcms.workflow.instance.cancelled",
      "awcms.workflow.instance.rejected"
    ]);
  });

  test("destructive op approved by a human: approved, approved_by is the approver, then promotable to a job (and only by the queue)", async () => {
    const seeded = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    const before = await inTenant(TENANT, (tx) =>
      promoteNextApprovedOperation(tx, TENANT, "srv-1335")
    );
    expect(before).toBeNull();

    await decide(seeded, approver, "approve");
    await finish(seeded, "approved");
    const pass = await dispatch();

    expect(pass.delivered).toBeGreaterThanOrEqual(1);
    const row = await operation(seeded.rowId);
    expect(row.status).toBe("approved");
    expect(row.approved_by).toBe(approver);
    expect(row.approved_by).not.toBe(seeded.requester);
    // The settler creates no job.
    expect(await jobCount(seeded.rowId)).toBe(0);

    const promoted = await inTenant(TENANT, (tx) =>
      promoteNextApprovedOperation(tx, TENANT, "srv-1335")
    );
    expect(promoted).not.toBeNull();
    expect(await jobCount(seeded.rowId)).toBe(1);

    const audit = await auditRows(
      "omes_control.operation_request.settled",
      seeded.rowId
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_tenant_user_id).toBeNull();
    expect(audit[0]!.metadata).toContain("workflow_event");
    expect(audit[0]!.metadata).not.toContain("SENTINEL");
  });

  test("rejected and cancelled: the operation request is rejected and never promotable", async () => {
    const rejected = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    await decide(rejected, approver, "reject");
    await finish(rejected, "rejected");
    const cancelled = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    await finish(cancelled, "cancelled");

    await dispatch();

    for (const item of [rejected, cancelled]) {
      const row = await operation(item.rowId);
      expect(row.status).toBe("rejected");
      expect(row.approved_by).toBeNull();
    }
    expect(
      await inTenant(TENANT, (tx) =>
        promoteNextApprovedOperation(tx, TENANT, "srv-1335")
      )
    ).toBeNull();
  });

  test("replaying the same event is a no-op and the settled row is never moved again", async () => {
    const seeded = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    await decide(seeded, approver, "approve");
    await finish(seeded, "approved");
    await dispatch();
    const first = await operation(seeded.rowId);

    // A second event for the same instance (a replay) after the row moved on.
    await getAdminSql()`
      UPDATE awcms_omes_operation_requests SET status = 'dispatched'
      WHERE id = ${seeded.rowId}`;
    await publish(TENANT, seeded.instanceId, "approved");
    await dispatch();

    expect(first.status).toBe("approved");
    expect((await operation(seeded.rowId)).status).toBe("dispatched");
    expect(
      await auditRows("omes_control.operation_request.settled", seeded.rowId)
    ).toHaveLength(1);
  });

  test("an event that is not a workflow-instance event, or whose instance is still pending, changes nothing", async () => {
    const spoofed = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    await decide(spoofed, approver, "approve");
    await getAdminSql().begin(
      (tx) => tx`UPDATE awcms_workflow_instances SET status = 'approved'
                 WHERE id = ${spoofed.instanceId}`
    );
    await inTenant(TENANT, async (tx) => {
      await appendDomainEvent(tx, TENANT, {
        eventType: "awcms.workflow.instance.approved",
        eventVersion: "1.0",
        aggregateType: "not_a_workflow_instance",
        aggregateId: spoofed.instanceId,
        producerModule: "workflow",
        payload: { workflowKey: "x" }
      });
    });

    const early = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    await publish(TENANT, early.instanceId, "approved");

    await dispatch();

    expect((await operation(spoofed.rowId)).status).toBe("requested");
    expect((await operation(early.rowId)).status).toBe("requested");
  });

  test("an instance that belongs to neither omes table is ignored", async () => {
    const foreign = await pendingRequest(TENANT, "operation", "other.module");
    await getAdminSql()`
      DELETE FROM awcms_omes_operation_requests WHERE id = ${foreign.rowId}`;
    await decide(foreign, approver, "approve");
    await finish(foreign, "approved");

    const pass = await dispatch();

    expect(pass.delivered).toBeGreaterThanOrEqual(1);
  });

  test("an event for another tenant's instance does not touch tenant A (or B)", async () => {
    const mine = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    const theirs = await pendingRequest(OTHER, "operation", DESTRUCTIVE);
    const otherApprover = await seedUser(OTHER, "approver");
    await decide(theirs, otherApprover, "approve");
    await getAdminSql().begin(
      (tx) => tx`UPDATE awcms_workflow_instances SET status = 'approved'
                 WHERE id = ${theirs.instanceId}`
    );
    // Tenant A's stream carries tenant B's instance id.
    await publish(TENANT, theirs.instanceId, "approved");

    await dispatch(TENANT);

    expect((await operation(mine.rowId)).status).toBe("requested");
    expect((await operation(theirs.rowId)).status).toBe("requested");

    // B's own stream settles B's row only.
    await publish(OTHER, theirs.instanceId, "approved");
    await dispatch(OTHER);

    expect((await operation(theirs.rowId)).status).toBe("approved");
    expect((await operation(mine.rowId)).status).toBe("requested");
  });

  test("an approval nobody backs, or the requester gave, is left pending with a warning audit and no details", async () => {
    const nobody = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    // Approved with no approving decision recorded (maintenance fixture: the
    // engine would never write this).
    await getAdminSql().begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      await tx`UPDATE awcms_workflow_instances SET status = 'approved'
               WHERE id = ${nobody.instanceId}`;
    });
    await publish(TENANT, nobody.instanceId, "approved");

    const own = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
    await decide(own, own.requester, "approve");
    await finish(own, "approved");

    await dispatch();

    for (const [item, why] of [
      [nobody, "no_approver"],
      [own, "self_approved"]
    ] as const) {
      expect((await operation(item.rowId)).status).toBe("requested");
      const audit = await auditRows(
        "omes_control.workflow_verdict.left_pending",
        item.rowId
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.severity).toBe("warning");
      expect(audit[0]!.metadata).toContain(why);
      expect(audit[0]!.metadata).not.toContain("SENTINEL");
    }
  });

  test("AI egress approved / denied / cancelled move the decision and stamp decided_at", async () => {
    const approved = await pendingRequest(TENANT, "egress", EGRESS);
    await decide(approved, approver, "approve");
    await finish(approved, "approved");
    const denied = await pendingRequest(TENANT, "egress", EGRESS);
    await decide(denied, approver, "reject");
    await finish(denied, "rejected");
    const cancelled = await pendingRequest(TENANT, "egress", EGRESS);
    await finish(cancelled, "cancelled");

    await dispatch();

    const a = await egress(approved.rowId);
    expect(a.decision).toBe("approved");
    expect(a.decided_at).not.toBeNull();
    for (const item of [denied, cancelled]) {
      const row = await egress(item.rowId);
      expect(row.decision).toBe("denied");
      expect(row.decided_at).not.toBeNull();
    }
    const audit = await auditRows(
      "omes_control.ai_egress_approval.settled",
      approved.rowId
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).not.toContain("SENTINEL");
  });

  describe("what the worker may NOT do (sql/387)", () => {
    test("its column UPDATE grants are exactly the settlement's, and it cannot insert or edit the request itself", async () => {
      if (!workerRoleActivated) return;
      const worker = getWorkerRoleSql();
      const op = await pendingRequest(TENANT, "operation", DESTRUCTIVE);
      const eg = await pendingRequest(TENANT, "egress", EGRESS);
      const attempt = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
        withTenantOrThrow(worker, TENANT, fn);

      await assertRejected(
        attempt(
          (tx) => tx`UPDATE awcms_omes_operation_requests
                     SET parameters = '{}'::jsonb WHERE id = ${op.rowId}`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        attempt(
          (tx) => tx`UPDATE awcms_omes_operation_requests
                     SET requested_by = 'x' WHERE id = ${op.rowId}`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        attempt(
          (tx) => tx`UPDATE awcms_omes_operation_requests
                     SET workflow_instance_id = NULL WHERE id = ${op.rowId}`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        attempt(
          (tx) => tx`INSERT INTO awcms_omes_operation_requests
                     (tenant_id, request_id, server_id, operation, status)
                     VALUES (${TENANT}, 'forged', 's', 'stop', 'approved')`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        attempt(
          (tx) => tx`UPDATE awcms_omes_ai_egress_approvals
                     SET destination = 'cloud_sanitized' WHERE id = ${eg.rowId}`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        attempt(
          (tx) => tx`UPDATE awcms_omes_ai_egress_approvals
                     SET justification = 'x' WHERE id = ${eg.rowId}`
        ),
        "permission denied|42501"
      );
      await assertRejected(
        attempt((tx) => tx`SELECT reason FROM awcms_workflow_decisions`),
        "permission denied|42501"
      );

      const columns = async (table: string) =>
        (
          (await getAdminSql()`
            SELECT column_name FROM information_schema.column_privileges
            WHERE grantee = 'awcms_worker' AND table_name = ${table}
              AND privilege_type = 'UPDATE'
            ORDER BY column_name`) as { column_name: string }[]
        ).map((row) => row.column_name);

      expect(await columns("awcms_omes_operation_requests")).toEqual([
        "approved_by",
        "status",
        "updated_at"
      ]);
      expect(await columns("awcms_omes_ai_egress_approvals")).toEqual([
        "decided_at",
        "decision",
        "updated_at"
      ]);
    });
  });
});
