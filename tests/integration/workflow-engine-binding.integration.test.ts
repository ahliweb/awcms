/**
 * Workflow instance verdicts and decision inserts are bound to what the engine
 * records, against a real PostgreSQL as the least-privilege runtime role with
 * FORCE RLS in force (Issue #1032, `sql/301`, follow-up to #999 / ADR-0144,
 * audit findings H2 and M1).
 *
 * Two halves, both necessary: every FORGERY the audit described is attempted
 * as `awcms_app` and must be refused, and every legitimate ENGINE path
 * (start, decide, quorum, delegation, force-decide, cancel, auto-finishing
 * graphs) must keep working through the real engine functions.
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
  assertRejected as assertRejectedByDatabase,
  appRoleActivated,
  getAdminSql,
  getOwnerSql,
  getWorkerRoleSql,
  workerRoleActivated,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { escalateDueTasksForTenant } from "../../src/modules/workflow-approval/application/workflow-escalation";
import { startWorkflowInstance } from "../../src/modules/workflow-approval/application/workflow-instance";
import {
  fetchTaskWithInstanceForDecision,
  findEligibleAssignment,
  recordWorkflowTaskDecision
} from "../../src/modules/workflow-approval/application/workflow-instance-decision";
import {
  cancelWorkflowInstance,
  forceWorkflowTaskDecision,
  reassignWorkflowTask
} from "../../src/modules/workflow-approval/application/workflow-recovery";

const suite = integrationEnabled ? describe : describe.skip;

async function assertRejected(
  promise: Promise<unknown>,
  expected: RegExp
): Promise<void> {
  const error = await assertRejectedByDatabase(promise, String(expected));
  resetDatabaseCircuitBreakerForTests();
  expect(error.message).toMatch(expected);
}

const TENANT = "a1032000-0000-4000-8000-00000000000a";
const REQUESTER = "a1032000-0000-4000-8000-0000000000a1";
const ALICE = "a1032000-0000-4000-8000-0000000000a2";
const BOB = "a1032000-0000-4000-8000-0000000000a3";
const MALLORY = "a1032000-0000-4000-8000-0000000000a4";
const ADMIN = "a1032000-0000-4000-8000-0000000000a5";

function inTenant<T>(fn: (tx: Bun.TransactionSQL) => Promise<T>): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), TENANT, fn);
}

/** Superuser fixture statements that step outside the triggers (`replica`). */
async function asMaintenance<T>(
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return getAdminSql().begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");

    return fn(tx);
  }) as Promise<T>;
}

/** A real tenant user (profile -> identity -> tenant user) with a chosen id. */
async function seedTenantUser(
  id: string,
  label: string,
  status = "active"
): Promise<void> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${label})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, ${`${label}-${id}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${id}, ${TENANT}, ${identity[0]!.id}, ${status})
  `;
}

type Quorum = "any" | "all" | "quorum";

function approvalGraph(
  quorumRule: Quorum,
  assignees: string[],
  quorumThreshold?: number
) {
  return {
    startNodeId: "approval",
    nodes: [
      {
        id: "approval",
        type: "approval",
        name: "Approval",
        assigneeTenantUserIds: assignees,
        quorumRule,
        ...(quorumThreshold === undefined ? {} : { quorumThreshold }),
        onApprove: "end_ok",
        onReject: "end_no"
      },
      { id: "end_ok", type: "end", outcome: "approved" },
      { id: "end_no", type: "end", outcome: "rejected" }
    ]
  };
}

async function define(
  graph: unknown,
  factsSchema: unknown = []
): Promise<string> {
  const key = `wf.${crypto.randomUUID()}`;

  await getAdminSql()`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
    VALUES (${TENANT}, ${key}, 'Binding', 1, 'active', ${graph}::jsonb, ${factsSchema}::jsonb)
  `;

  return key;
}

type Started = {
  instanceId: string;
  taskId: string | undefined;
  status: string;
};

async function start(key: string, facts: unknown = {}): Promise<Started> {
  return inTenant(async (tx) => {
    const result = await startWorkflowInstance(tx, {
      tenantId: TENANT,
      workflowKey: key,
      resourceType: "doc",
      resourceId: crypto.randomUUID(),
      requestedByTenantUserId: REQUESTER,
      facts
    });
    const tasks = (await tx`
      SELECT id FROM awcms_workflow_tasks WHERE workflow_instance_id = ${result.instanceId}
    `) as { id: string }[];

    return {
      instanceId: result.instanceId,
      taskId: tasks[0]?.id,
      status: result.status
    };
  });
}

/** Decide through the real engine functions, exactly as the route does. */
async function decide(
  taskId: string,
  by: string,
  decision: "approve" | "reject"
) {
  return inTenant(async (tx) => {
    const task = await fetchTaskWithInstanceForDecision(tx, TENANT, taskId);
    const now = new Date();
    const assignment = await findEligibleAssignment(
      tx,
      TENANT,
      taskId,
      by,
      task!.workflow_key,
      task!.resource_type,
      now
    );

    return recordWorkflowTaskDecision(tx, {
      tenantId: TENANT,
      taskId,
      task: task!,
      assignment: assignment!,
      decidingTenantUserId: by,
      decision,
      now
    });
  });
}

async function statusOf(instanceId: string): Promise<string> {
  return (
    (await getAdminSql()`SELECT status FROM awcms_workflow_instances WHERE id = ${instanceId}`) as {
      status: string;
    }[]
  )[0]!.status;
}

function rawDecision(
  taskId: string,
  by: string,
  options: {
    decision?: string;
    onBehalfOf?: string | null;
    override?: boolean;
    overrideReason?: string | null;
  } = {}
) {
  return inTenant(
    (tx) => tx`
      INSERT INTO awcms_workflow_decisions
        (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id,
         on_behalf_of_tenant_user_id, is_administrative_override, override_reason)
      VALUES (${TENANT}, ${taskId}, ${options.decision ?? "approve"}, ${by},
              ${options.onBehalfOf ?? null}, ${options.override ?? false},
              ${options.overrideReason ?? null})
    `
  );
}

function rawApprove(instanceId: string, status = "approved") {
  return inTenant(
    (tx) =>
      tx`UPDATE awcms_workflow_instances SET status = ${status} WHERE tenant_id = ${TENANT} AND id = ${instanceId} AND status = 'pending'`
  );
}

suite("workflow_approval engine binding (Issue #1032)", () => {
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
      VALUES (${TENANT}, 'wf-bind', 'Workflow binding')
    `;
    // The people an override may name: real, active users of the tenant.
    for (const [id, label] of [
      [REQUESTER, "requester"],
      [ADMIN, "admin"],
      [ALICE, "alice"],
      [BOB, "bob"],
      [MALLORY, "mallory"]
    ] as const) {
      await seedTenantUser(id, label);
    }
  });

  describe("H2: an instance cannot be approved without its decisions", () => {
    test("the audit's one-liner is refused while the task is open", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId } = await start(key);

      await assertRejected(
        rawApprove(instanceId),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
      await assertRejected(
        rawApprove(instanceId, "rejected"),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
      expect(await statusOf(instanceId)).toBe("pending");
    });

    test("cancelling the task first does not unlock a verdict", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId, taskId } = await start(key);

      // A pending instance's task cannot be cancelled or skipped by hand ...
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'cancelled', cancelled_at = now() WHERE id = ${taskId}`
        ),
        /WORKFLOW_TASK_CANCEL_REFUSED/
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'skipped' WHERE id = ${taskId}`
        ),
        /WORKFLOW_TASK_SKIP_REFUSED/
      );
      // ... and even a maintenance-level cancellation leaves the verdict
      // unjustified: the simulation needs a COMPLETED approval.
      await asMaintenance(
        (tx) =>
          tx`UPDATE awcms_workflow_tasks SET status = 'cancelled' WHERE id = ${taskId}`
      );
      await assertRejected(
        rawApprove(instanceId),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
    });

    test("a task cannot be completed without a decision, or on an unmet quorum", async () => {
      const key = await define(approvalGraph("all", [ALICE, BOB]));
      const { taskId } = await start(key);

      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${taskId}`
        ),
        /WORKFLOW_TASK_QUORUM_UNMET/
      );

      // One of two approvals through the engine leaves the task open; forcing
      // the completion by hand is still refused.
      await decide(taskId!, ALICE, "approve");
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${taskId}`
        ),
        /WORKFLOW_TASK_QUORUM_UNMET/
      );
    });

    test("a rejected task cannot be turned into an approved verdict", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId, taskId } = await start(key);

      // Alice's real rejection finishes the instance as rejected; a forger who
      // only completes the task by hand cannot then claim `approved`.
      await rawDecision(taskId!, ALICE, { decision: "reject" });
      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${taskId}`
      );
      await assertRejected(
        rawApprove(instanceId, "approved"),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
      await rawApprove(instanceId, "rejected");
      expect(await statusOf(instanceId)).toBe("rejected");
    });

    test("an instance cannot be INSERTed already finished, nor a task already completed", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const defRows = (await getAdminSql()`
        SELECT id FROM awcms_workflow_definitions WHERE workflow_key = ${key}
      `) as { id: string }[];

      await assertRejected(
        inTenant(
          (tx) => tx`
            INSERT INTO awcms_workflow_instances
              (tenant_id, workflow_definition_id, resource_type, resource_id,
               status, requested_by_tenant_user_id)
            VALUES (${TENANT}, ${defRows[0]!.id}, 'doc', 'r', 'approved', ${REQUESTER})
          `
        ),
        /WORKFLOW_INSTANCE_INSERT_STATUS/
      );

      const { instanceId } = await start(key);
      await assertRejected(
        inTenant(
          (tx) => tx`
            INSERT INTO awcms_workflow_tasks
              (tenant_id, workflow_instance_id, node_id, status)
            VALUES (${TENANT}, ${instanceId}, 'approval', 'completed')
          `
        ),
        /WORKFLOW_TASK_INSERT_STATUS/
      );
    });

    test("a fresh instance on a graph whose every path needs approval cannot be approved with zero tasks", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const defRows = (await getAdminSql()`
        SELECT id FROM awcms_workflow_definitions WHERE workflow_key = ${key}
      `) as { id: string }[];
      const rows = (await inTenant(
        (tx) => tx`
          INSERT INTO awcms_workflow_instances
            (tenant_id, workflow_definition_id, resource_type, resource_id,
             requested_by_tenant_user_id)
          VALUES (${TENANT}, ${defRows[0]!.id}, 'doc', 'r', ${REQUESTER})
          RETURNING id
        `
      )) as { id: string }[];

      await assertRejected(
        rawApprove(rows[0]!.id),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
    });
  });

  describe("M1: a decision insert cannot forge who decided", () => {
    test("a user with no seat cannot decide", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { taskId } = await start(key);

      await assertRejected(
        rawDecision(taskId!, MALLORY),
        /WORKFLOW_DECISION_FORGED/
      );
      // Claiming to act for Alice without a delegation is the same forgery.
      await assertRejected(
        rawDecision(taskId!, MALLORY, { onBehalfOf: ALICE }),
        /WORKFLOW_DECISION_FORGED/
      );
      // Naming yourself as your own principal is nonsense.
      await assertRejected(
        rawDecision(taskId!, ALICE, { onBehalfOf: ALICE }),
        /WORKFLOW_DECISION_FORGED/
      );
    });

    test("a decision cannot claim to be an administrative override, nor hide being one", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { taskId } = await start(key);

      await assertRejected(
        rawDecision(taskId!, MALLORY, { decision: "force_approve" }),
        /WORKFLOW_DECISION_OVERRIDE_MISMATCH/
      );
      await assertRejected(
        rawDecision(taskId!, ALICE, { override: true }),
        /WORKFLOW_DECISION_OVERRIDE_MISMATCH/
      );
      await assertRejected(
        rawDecision(taskId!, ADMIN, {
          decision: "force_approve",
          override: true,
          overrideReason: " "
        }),
        /WORKFLOW_DECISION_OVERRIDE_INVALID/
      );
    });

    test("a delegation must be active, in scope and name the delegate", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { taskId } = await start(key);

      // Expired and revoked delegations carry no authority.
      await getAdminSql()`
        INSERT INTO awcms_workflow_delegations
          (tenant_id, delegator_tenant_user_id, delegate_tenant_user_id, reason,
           created_by_tenant_user_id, effective_from, effective_to)
        VALUES (${TENANT}, ${ALICE}, ${MALLORY}, 'expired', ${ALICE},
                now() - interval '2 days', now() - interval '1 day')
      `;
      await getAdminSql()`
        INSERT INTO awcms_workflow_delegations
          (tenant_id, delegator_tenant_user_id, delegate_tenant_user_id, reason,
           created_by_tenant_user_id, status)
        VALUES (${TENANT}, ${ALICE}, ${MALLORY}, 'revoked', ${ALICE}, 'revoked')
      `;
      // Scoped to another workflow.
      await getAdminSql()`
        INSERT INTO awcms_workflow_delegations
          (tenant_id, delegator_tenant_user_id, delegate_tenant_user_id, reason,
           created_by_tenant_user_id, workflow_key)
        VALUES (${TENANT}, ${ALICE}, ${MALLORY}, 'elsewhere', ${ALICE}, 'other.workflow')
      `;
      // Delegates to somebody else.
      await getAdminSql()`
        INSERT INTO awcms_workflow_delegations
          (tenant_id, delegator_tenant_user_id, delegate_tenant_user_id, reason,
           created_by_tenant_user_id)
        VALUES (${TENANT}, ${ALICE}, ${BOB}, 'bob only', ${ALICE})
      `;

      await assertRejected(
        rawDecision(taskId!, MALLORY, { onBehalfOf: ALICE }),
        /WORKFLOW_DECISION_FORGED/
      );
    });

    test("nothing can be appended after the instance finished or was cancelled", async () => {
      const key = await define(approvalGraph("any", [ALICE, BOB]));
      const done = await start(key);

      await decide(done.taskId!, ALICE, "approve");
      expect(await statusOf(done.instanceId)).toBe("approved");
      await assertRejected(
        rawDecision(done.taskId!, BOB),
        /WORKFLOW_DECISION_NOT_OPEN/
      );

      const cancelled = await start(key);
      await inTenant((tx) =>
        cancelWorkflowInstance(tx, {
          tenantId: TENANT,
          instanceId: cancelled.instanceId,
          cancelledByTenantUserId: ADMIN,
          reason: "withdrawn"
        })
      );
      await assertRejected(
        rawDecision(cancelled.taskId!, ALICE),
        /WORKFLOW_DECISION_NOT_OPEN/
      );
    });

    test("a decision against a task of another tenant is refused", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { taskId } = await start(key);
      const OTHER = "a1032000-0000-4000-8000-0000000000b0";

      await getAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${OTHER}, 'wf-bind-other', 'Other')
      `;
      await assertRejected(
        withTenantOrThrow(
          getRuntimeSql(),
          OTHER,
          (tx) => tx`
            INSERT INTO awcms_workflow_decisions
              (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id)
            VALUES (${OTHER}, ${taskId}, 'approve', ${ALICE})
          `
        ),
        /WORKFLOW_DECISION_TASK_MISMATCH|row-level security|violates/i
      );
    });
  });

  describe("every engine path keeps working", () => {
    test("any / all / quorum approvals finish the instance only when the quorum is met", async () => {
      const any = await start(await define(approvalGraph("any", [ALICE, BOB])));
      await decide(any.taskId!, BOB, "approve");
      expect(await statusOf(any.instanceId)).toBe("approved");

      const all = await start(await define(approvalGraph("all", [ALICE, BOB])));
      await decide(all.taskId!, ALICE, "approve");
      expect(await statusOf(all.instanceId)).toBe("pending");
      await decide(all.taskId!, BOB, "approve");
      expect(await statusOf(all.instanceId)).toBe("approved");

      const quorum = await start(
        await define(approvalGraph("quorum", [ALICE, BOB, MALLORY], 2))
      );
      await decide(quorum.taskId!, ALICE, "approve");
      expect(await statusOf(quorum.instanceId)).toBe("pending");
      await decide(quorum.taskId!, MALLORY, "approve");
      expect(await statusOf(quorum.instanceId)).toBe("approved");
    });

    test("a single reject finishes the instance as rejected", async () => {
      const all = await start(await define(approvalGraph("all", [ALICE, BOB])));

      await decide(all.taskId!, BOB, "reject");
      expect(await statusOf(all.instanceId)).toBe("rejected");
    });

    test("an active delegate decides on behalf of the assignee", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId, taskId } = await start(key);

      await getAdminSql()`
        INSERT INTO awcms_workflow_delegations
          (tenant_id, delegator_tenant_user_id, delegate_tenant_user_id, reason,
           created_by_tenant_user_id)
        VALUES (${TENANT}, ${ALICE}, ${BOB}, 'holiday', ${ALICE})
      `;
      await decide(taskId!, BOB, "approve");

      const rows = (await getAdminSql()`
        SELECT decided_by_tenant_user_id AS by, on_behalf_of_tenant_user_id AS behalf
        FROM awcms_workflow_decisions WHERE workflow_task_id = ${taskId}
      `) as { by: string; behalf: string }[];

      expect(rows).toEqual([{ by: BOB, behalf: ALICE }]);
      expect(await statusOf(instanceId)).toBe("approved");
    });

    test("reassignment seats the new assignee, who then decides", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId, taskId } = await start(key);

      await inTenant((tx) =>
        reassignWorkflowTask(tx, {
          tenantId: TENANT,
          taskId: taskId!,
          toTenantUserId: BOB,
          reassignedByTenantUserId: ADMIN,
          reason: "cover"
        })
      );
      await decide(taskId!, BOB, "approve");
      expect(await statusOf(instanceId)).toBe("approved");
    });

    test("an administrative force decision finishes the instance both ways", async () => {
      for (const [decision, expected] of [
        ["force_approve", "approved"],
        ["force_reject", "rejected"]
      ] as const) {
        const key = await define(approvalGraph("all", [ALICE, BOB]));
        const { instanceId, taskId } = await start(key);

        await inTenant((tx) =>
          forceWorkflowTaskDecision(tx, {
            tenantId: TENANT,
            taskId: taskId!,
            decision,
            forcedByTenantUserId: ADMIN,
            reason: "ops override",
            now: new Date()
          })
        );
        expect(await statusOf(instanceId)).toBe(expected);
      }
    });

    test("cancelling a running instance still works", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId } = await start(key);

      await inTenant((tx) =>
        cancelWorkflowInstance(tx, {
          tenantId: TENANT,
          instanceId,
          cancelledByTenantUserId: ADMIN,
          reason: "withdrawn"
        })
      );
      expect(await statusOf(instanceId)).toBe("cancelled");
    });

    test("a graph that is only an end node finishes with no decision", async () => {
      const key = await define({
        startNodeId: "e",
        nodes: [{ id: "e", type: "end", outcome: "approved" }]
      });
      const result = await start(key);

      expect(result.status).toBe("approved");
      expect(await statusOf(result.instanceId)).toBe("approved");
    });

    test("a condition that skips every approval finishes with no task, while the other branch needs one", async () => {
      const graph = {
        startNodeId: "gate",
        nodes: [
          {
            id: "gate",
            type: "condition",
            factKey: "amount",
            operator: "gt",
            value: 100,
            onTrue: "approval",
            onFalse: "end_ok"
          },
          {
            id: "approval",
            type: "approval",
            name: "Approval",
            assigneeTenantUserIds: [ALICE],
            quorumRule: "any",
            onApprove: "end_ok",
            onReject: "end_no"
          },
          { id: "end_ok", type: "end", outcome: "approved" },
          { id: "end_no", type: "end", outcome: "rejected" }
        ]
      };
      const key = await define(graph, [{ key: "amount", type: "number" }]);

      const small = await start(key, { amount: 10 });
      expect(small.status).toBe("approved");

      // The over-threshold instance has a task, so the approval-free branch
      // cannot be used to approve it, even after cancelling that task.
      const big = await start(key, { amount: 500 });
      expect(big.status).toBe("pending");
      await assertRejected(
        rawApprove(big.instanceId),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'cancelled', cancelled_at = now() WHERE id = ${big.taskId}`
        ),
        /WORKFLOW_TASK_CANCEL_REFUSED/
      );
      // Even with the task cancelled out-of-band, the condition is evaluated
      // against the frozen facts (amount 500 > 100), so `onFalse` is not taken.
      await asMaintenance(
        (tx) =>
          tx`UPDATE awcms_workflow_tasks SET status = 'cancelled' WHERE id = ${big.taskId}`
      );
      await assertRejected(
        rawApprove(big.instanceId),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
    });
  });

  describe("verdict walk: parallel branches (HIGH-2 / HIGH-3)", () => {
    const parallelGraph = {
      startNodeId: "p",
      nodes: [
        {
          id: "p",
          type: "parallel",
          branchNodeIds: ["a", "b"],
          joinNodeId: "j"
        },
        {
          id: "a",
          type: "approval",
          name: "A",
          assigneeTenantUserIds: [ALICE],
          quorumRule: "any",
          onApprove: "j",
          onReject: "end_no"
        },
        {
          id: "b",
          type: "approval",
          name: "B",
          assigneeTenantUserIds: [BOB],
          quorumRule: "any",
          onApprove: "j",
          onReject: "end_no"
        },
        { id: "j", type: "join", awaitNodeIds: ["a", "b"], next: "end_ok" },
        { id: "end_ok", type: "end", outcome: "approved" },
        { id: "end_no", type: "end", outcome: "rejected" }
      ]
    };

    async function parallelTasks(instanceId: string) {
      return (await getAdminSql()`
        SELECT id, node_id, status FROM awcms_workflow_tasks
        WHERE workflow_instance_id = ${instanceId} ORDER BY node_id
      `) as { id: string; node_id: string; status: string }[];
    }

    test("approving both branches passes the join and approves", async () => {
      const started = await start(await define(parallelGraph));
      const tasks = await parallelTasks(started.instanceId);

      expect(tasks.map((t) => t.node_id)).toEqual(["a", "b"]);
      await decide(tasks[0]!.id, ALICE, "approve");
      expect(await statusOf(started.instanceId)).toBe("pending");
      await decide(tasks[1]!.id, BOB, "approve");
      expect(await statusOf(started.instanceId)).toBe("approved");
    });

    test("a reject on one branch rejects the instance and cancels the sibling (no 500)", async () => {
      const started = await start(await define(parallelGraph));
      const tasks = await parallelTasks(started.instanceId);

      const result = await decide(tasks[0]!.id, ALICE, "reject");

      expect(result.instanceStatus).toBe("rejected");
      expect(await statusOf(started.instanceId)).toBe("rejected");
      expect(
        (await parallelTasks(started.instanceId)).map((t) => t.status)
      ).toEqual(["completed", "cancelled"]);
    });

    test("a force_reject on one branch does the same", async () => {
      const started = await start(await define(parallelGraph));
      const tasks = await parallelTasks(started.instanceId);

      await inTenant((tx) =>
        forceWorkflowTaskDecision(tx, {
          tenantId: TENANT,
          taskId: tasks[1]!.id,
          decision: "force_reject",
          forcedByTenantUserId: ADMIN,
          reason: "ops",
          now: new Date()
        })
      );
      expect(await statusOf(started.instanceId)).toBe("rejected");
      expect(
        (await parallelTasks(started.instanceId)).map((t) => t.status)
      ).toEqual(["cancelled", "completed"]);
    });

    test("e1: the sibling branch cannot be cancelled or skipped to approve early", async () => {
      const started = await start(await define(parallelGraph));
      const tasks = await parallelTasks(started.instanceId);

      await decide(tasks[0]!.id, ALICE, "approve");
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'cancelled' WHERE id = ${tasks[1]!.id}`
        ),
        /WORKFLOW_TASK_CANCEL_REFUSED/
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'skipped' WHERE id = ${tasks[1]!.id}`
        ),
        /WORKFLOW_TASK_SKIP_REFUSED/
      );
      // Out-of-band cancellation still cannot pass the join: b never arrived.
      await asMaintenance(
        (tx) =>
          tx`UPDATE awcms_workflow_tasks SET status = 'cancelled' WHERE id = ${tasks[1]!.id}`
      );
      await assertRejected(
        rawApprove(started.instanceId),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
    });
  });

  describe("the verdict simulation reads facts and frozen graphs (HIGH-2 / MEDIUM-1)", () => {
    const thresholdGraph = {
      startNodeId: "a",
      nodes: [
        {
          id: "a",
          type: "approval",
          name: "A",
          assigneeTenantUserIds: [ALICE],
          quorumRule: "any",
          onApprove: "gate",
          onReject: "end_no"
        },
        {
          id: "gate",
          type: "condition",
          factKey: "amount",
          operator: "gt",
          value: 100000,
          onTrue: "b",
          onFalse: "end_ok"
        },
        {
          id: "b",
          type: "approval",
          name: "B",
          assigneeTenantUserIds: [BOB],
          quorumRule: "any",
          onApprove: "end_ok",
          onReject: "end_no"
        },
        { id: "end_ok", type: "end", outcome: "approved" },
        { id: "end_no", type: "end", outcome: "rejected" }
      ]
    };
    const facts = [{ key: "amount", type: "number" }];

    test("e2: above the threshold the second approval is needed even if its task vanishes", async () => {
      const key = await define(thresholdGraph, facts);
      const started = await start(key, { amount: 500000 });

      await decide(started.taskId!, ALICE, "approve");

      const b = (await getAdminSql()`
        SELECT id FROM awcms_workflow_tasks
        WHERE workflow_instance_id = ${started.instanceId} AND node_id = 'b'
      `) as { id: string }[];

      expect(b).toHaveLength(1);
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'cancelled' WHERE id = ${b[0]!.id}`
        ),
        /WORKFLOW_TASK_CANCEL_REFUSED/
      );
      await asMaintenance(
        (tx) =>
          tx`UPDATE awcms_workflow_tasks SET status = 'cancelled' WHERE id = ${b[0]!.id}`
      );
      await assertRejected(
        rawApprove(started.instanceId),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
    });

    test("below the threshold one approval is enough, through the engine", async () => {
      const key = await define(thresholdGraph, facts);
      const started = await start(key, { amount: 5 });

      await decide(started.taskId!, ALICE, "approve");
      expect(await statusOf(started.instanceId)).toBe("approved");
    });

    test("e3: erasing the seat and the task is refused by privilege, and by the walk", async () => {
      const key = await define(thresholdGraph, facts);
      const started = await start(key, { amount: 500000 });

      for (const table of [
        "awcms_workflow_task_assignments",
        "awcms_workflow_tasks",
        "awcms_workflow_join_arrivals"
      ]) {
        await assertRejected(
          inTenant(
            (tx) => tx.unsafe(`DELETE FROM ${table}`) as Promise<unknown>
          ),
          /permission denied/i
        );
      }

      await asMaintenance(async (tx) => {
        await tx`DELETE FROM awcms_workflow_task_assignments WHERE workflow_task_id = ${started.taskId}`;
        await tx`DELETE FROM awcms_workflow_tasks WHERE workflow_instance_id = ${started.instanceId}`;
      });
      await assertRejected(
        rawApprove(started.instanceId),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
    });

    test("e4: the graph of a published definition cannot be rewritten, nor un-published", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const started = await start(key);
      const rewritten = {
        startNodeId: "e",
        nodes: [{ id: "e", type: "end", outcome: "approved" }]
      };

      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_definitions SET graph = ${rewritten}::jsonb WHERE workflow_key = ${key}`
        ),
        /WORKFLOW_DEFINITION_FROZEN/
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_definitions SET lifecycle_status = 'draft' WHERE workflow_key = ${key}`
        ),
        /WORKFLOW_DEFINITION_LIFECYCLE/
      );
      await assertRejected(
        rawApprove(started.instanceId),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
      // A draft is still editable in place, and publishing still works.
      await getAdminSql()`
        INSERT INTO awcms_workflow_definitions
          (tenant_id, workflow_key, name, version, lifecycle_status, graph)
        VALUES (${TENANT}, 'draft.key', 'Draft', 1, 'draft', ${rewritten}::jsonb)
      `;
      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_definitions SET graph = ${approvalGraph("any", [ALICE])}::jsonb WHERE workflow_key = 'draft.key'`
      );
      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_definitions SET lifecycle_status = 'active' WHERE workflow_key = 'draft.key'`
      );
    });
  });

  describe("one approver cannot be several (MEDIUM-2)", () => {
    test("e5: two approve rows from one seat are refused, so 'all' needs both seats", async () => {
      const key = await define(approvalGraph("all", [ALICE, BOB]));
      const { taskId } = await start(key);

      await rawDecision(taskId!, ALICE);
      await assertRejected(
        rawDecision(taskId!, ALICE),
        /awcms_workflow_decisions_one_per_seat|duplicate key/i
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${taskId}`
        ),
        /WORKFLOW_TASK_QUORUM_UNMET/
      );
    });
  });

  describe("the guards cannot be shadowed (HIGH-1)", () => {
    test("e9: a TEMP table named like the decision log decides nothing", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId, taskId } = await start(key);
      const shadow = (tx: Bun.TransactionSQL) =>
        tx.unsafe(`
          CREATE TEMP TABLE awcms_workflow_decisions (
            workflow_task_id uuid, decision text,
            decided_by_tenant_user_id uuid, on_behalf_of_tenant_user_id uuid
          ) ON COMMIT DROP`) as Promise<unknown>;

      await assertRejected(
        inTenant(async (tx) => {
          await shadow(tx);
          await tx.unsafe(
            `INSERT INTO pg_temp.awcms_workflow_decisions (workflow_task_id, decision, decided_by_tenant_user_id)
             VALUES ('${taskId}', 'force_approve', '${ADMIN}')`
          );
          await tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${taskId}`;
        }),
        /WORKFLOW_TASK_QUORUM_UNMET/
      );
      await assertRejected(
        inTenant(async (tx) => {
          await shadow(tx);
          await tx.unsafe(
            `INSERT INTO pg_temp.awcms_workflow_decisions (workflow_task_id, decision, decided_by_tenant_user_id)
             VALUES ('${taskId}', 'force_approve', '${ADMIN}')`
          );
          await tx`UPDATE awcms_workflow_instances SET status = 'approved' WHERE id = ${instanceId}`;
        }),
        /WORKFLOW_INSTANCE_VERDICT_UNJUSTIFIED/
      );
      expect(await statusOf(instanceId)).toBe("pending");
    });

    test("every guard function pins its search_path", async () => {
      const rows = (await getAdminSql()`
        SELECT p.proname, p.proconfig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'awcms_workflow_eval_condition', 'awcms_workflow_task_quorum_outcome',
            'awcms_workflow_instance_verdict_justified',
            'awcms_workflow_decisions_guard', 'awcms_workflow_tasks_guard',
            'awcms_workflow_instances_guard', 'awcms_workflow_definitions_guard',
            'awcms_workflow_role_is_exempt', 'awcms_workflow_task_assignments_insert_guard', 'awcms_workflow_task_assignments_guard',
            'awcms_workflow_reassignment_replacement_check', 'awcms_workflow_reject_delete')
      `) as { proname: string; proconfig: string[] | null }[];

      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(row.proconfig ?? []).toContain(
          "search_path=pg_catalog, public, pg_temp"
        );
      }
    });
  });

  describe("an override needs a real, non-requester person (HIGH-A)", () => {
    test("a forged override principal is refused, a real one works", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId, taskId } = await start(key);
      const stranger = crypto.randomUUID();

      const forced = (by: string) =>
        rawDecision(taskId!, by, {
          decision: "force_approve",
          override: true,
          overrideReason: "ops"
        });

      await assertRejected(
        forced(stranger),
        /WORKFLOW_DECISION_OVERRIDE_PRINCIPAL/
      );

      const inactive = crypto.randomUUID();

      await seedTenantUser(inactive, "inactive", "inactive");
      await assertRejected(
        forced(inactive),
        /WORKFLOW_DECISION_OVERRIDE_PRINCIPAL/
      );
      await assertRejected(
        forced(REQUESTER),
        /WORKFLOW_DECISION_OVERRIDE_SELF/
      );

      // The exploit chain from the audit never gets past the first row.
      await assertRejected(
        inTenant(async (tx) => {
          await tx`INSERT INTO awcms_workflow_decisions
            (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id,
             is_administrative_override, override_reason)
            VALUES (${TENANT}, ${taskId}, 'force_approve', ${stranger}, true, 'x')`;
          await tx`UPDATE awcms_workflow_tasks SET status = 'completed' WHERE id = ${taskId}`;
        }),
        /WORKFLOW_DECISION_OVERRIDE_PRINCIPAL/
      );
      expect(await statusOf(instanceId)).toBe("pending");

      await forced(ADMIN);
    });
  });

  describe("a seat cannot be retired to shrink the quorum (HIGH-B)", () => {
    test("Bob's seat cannot be reassigned into nothing so that Alice alone completes 'all'", async () => {
      const key = await define(approvalGraph("all", [ALICE, BOB]));
      const { instanceId, taskId } = await start(key);

      // No target.
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_task_assignments SET status = 'reassigned'
               WHERE workflow_task_id = ${taskId} AND tenant_user_id = ${BOB}`
        ),
        /WORKFLOW_ASSIGNMENT_REASSIGN/
      );
      // A target who never gets a seat: refused at COMMIT (deferred).
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_task_assignments
               SET status = 'reassigned', reassigned_to_tenant_user_id = ${MALLORY},
                   reassigned_at = now()
               WHERE workflow_task_id = ${taskId} AND tenant_user_id = ${BOB}`
        ),
        /WORKFLOW_ASSIGNMENT_NO_REPLACEMENT/
      );
      // Skipping or marking decided without a decision does not shrink it either.
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_task_assignments SET status = 'skipped'
               WHERE workflow_task_id = ${taskId} AND tenant_user_id = ${BOB}`
        ),
        /WORKFLOW_ASSIGNMENT_STATUS/
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_task_assignments SET status = 'decided', decided_at = now()
               WHERE workflow_task_id = ${taskId} AND tenant_user_id = ${BOB}`
        ),
        /WORKFLOW_ASSIGNMENT_NO_DECISION/
      );
      // Identity is immutable.
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_task_assignments SET tenant_user_id = ${ALICE}
               WHERE workflow_task_id = ${taskId} AND tenant_user_id = ${BOB}`
        ),
        /immutable/i
      );

      await decide(taskId!, ALICE, "approve");
      expect(await statusOf(instanceId)).toBe("pending");
    });

    test("a decided or reassigned seat is final; the engine's own moves keep working", async () => {
      const key = await define(approvalGraph("all", [ALICE, BOB]));
      const { taskId } = await start(key);

      await decide(taskId!, ALICE, "approve");
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_task_assignments SET status = 'pending', decided_at = NULL
               WHERE workflow_task_id = ${taskId} AND tenant_user_id = ${ALICE}`
        ),
        /WORKFLOW_ASSIGNMENT_FINAL/
      );

      // Reassign (retire every pending seat, seat the target) still works.
      await inTenant((tx) =>
        reassignWorkflowTask(tx, {
          tenantId: TENANT,
          taskId: taskId!,
          toTenantUserId: MALLORY,
          reassignedByTenantUserId: ADMIN,
          reason: "cover"
        })
      );
      await decide(taskId!, MALLORY, "approve");
    });
  });

  describe("branches that share an approval node (MEDIUM-A)", () => {
    test("approving one branch's task and rejecting the other's rejects the instance", async () => {
      const graph = {
        startNodeId: "p",
        nodes: [
          {
            id: "p",
            type: "parallel",
            branchNodeIds: ["b1", "b2"],
            joinNodeId: "j"
          },
          {
            id: "b1",
            type: "condition",
            factKey: "go",
            operator: "eq",
            value: true,
            onTrue: "x",
            onFalse: "x"
          },
          {
            id: "b2",
            type: "condition",
            factKey: "go",
            operator: "eq",
            value: true,
            onTrue: "x",
            onFalse: "x"
          },
          {
            id: "x",
            type: "approval",
            name: "X",
            assigneeTenantUserIds: [ALICE],
            quorumRule: "any",
            onApprove: "j",
            onReject: "end_no"
          },
          { id: "j", type: "join", awaitNodeIds: ["b1", "b2"], next: "end_ok" },
          { id: "end_ok", type: "end", outcome: "approved" },
          { id: "end_no", type: "end", outcome: "rejected" }
        ]
      };
      const key = await define(graph, [{ key: "go", type: "boolean" }]);
      const started = await start(key, { go: true });
      const tasks = (await getAdminSql()`
        SELECT id, parent_node_id FROM awcms_workflow_tasks
        WHERE workflow_instance_id = ${started.instanceId} ORDER BY parent_node_id
      `) as { id: string; parent_node_id: string }[];

      expect(tasks.map((t) => t.parent_node_id)).toEqual(["b1", "b2"]);
      await decide(tasks[0]!.id, ALICE, "approve");
      expect(await statusOf(started.instanceId)).toBe("pending");
      await decide(tasks[1]!.id, ALICE, "reject");
      expect(await statusOf(started.instanceId)).toBe("rejected");
    });
  });

  describe("definitions and the instances started on them (MEDIUM-C)", () => {
    const endOnly = {
      startNodeId: "e",
      nodes: [{ id: "e", type: "end", outcome: "approved" }]
    };

    test("the runtime role creates drafts only, and starts instances on the active version only", async () => {
      if (!appRoleActivated) return;

      await assertRejected(
        inTenant(
          (tx) =>
            tx`INSERT INTO awcms_workflow_definitions
               (tenant_id, workflow_key, name, version, lifecycle_status, graph)
               VALUES (${TENANT}, 'forged.active', 'F', 1, 'active', ${endOnly}::jsonb)`
        ),
        /WORKFLOW_DEFINITION_INSERT_STATUS/
      );
      await assertRejected(
        inTenant(
          (tx) =>
            tx`INSERT INTO awcms_workflow_definitions
               (tenant_id, workflow_key, name, version, lifecycle_status, graph)
               VALUES (${TENANT}, 'forged.retired', 'F', 1, 'retired', ${endOnly}::jsonb)`
        ),
        /WORKFLOW_DEFINITION_INSERT_STATUS/
      );

      // A draft is fine, but an instance cannot start on it.
      const draft = (await inTenant(
        (tx) =>
          tx`INSERT INTO awcms_workflow_definitions
             (tenant_id, workflow_key, name, version, lifecycle_status, graph)
             VALUES (${TENANT}, 'ok.draft', 'D', 1, 'draft', ${endOnly}::jsonb)
             RETURNING id`
      )) as { id: string }[];
      const startOn = (definitionId: string, version: number) =>
        inTenant(
          (tx) =>
            tx`INSERT INTO awcms_workflow_instances
               (tenant_id, workflow_definition_id, workflow_definition_version,
                resource_type, resource_id, requested_by_tenant_user_id)
               VALUES (${TENANT}, ${definitionId}, ${version}, 'doc', 'r', ${REQUESTER})`
        );

      await assertRejected(
        startOn(draft[0]!.id, 1),
        /WORKFLOW_INSTANCE_DEFINITION/
      );

      // Publishing through the lifecycle still works; the pinned version must match.
      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_definitions SET lifecycle_status = 'active' WHERE id = ${draft[0]!.id}`
      );
      await assertRejected(
        startOn(draft[0]!.id, 7),
        /WORKFLOW_INSTANCE_DEFINITION/
      );
      await startOn(draft[0]!.id, 1);

      // Retiring the definition later does not touch the instance, and a new
      // instance can no longer start on it.
      await inTenant(
        (tx) =>
          tx`UPDATE awcms_workflow_definitions SET lifecycle_status = 'retired' WHERE id = ${draft[0]!.id}`
      );
      await assertRejected(
        startOn(draft[0]!.id, 1),
        /WORKFLOW_INSTANCE_DEFINITION/
      );
    });
  });

  describe("deletes cannot be restored by a re-grant (LOW)", () => {
    test("a role that is neither owner nor superuser is refused even with DELETE granted", async () => {
      const key = await define(approvalGraph("any", [ALICE]));
      const { taskId } = await start(key);
      const role = `awcms_it_bs_${process.pid}`;

      await getAdminSql().unsafe(`DROP ROLE IF EXISTS "${role}"`);
      await getAdminSql().unsafe(`CREATE ROLE "${role}" NOLOGIN`);
      try {
        await getAdminSql().unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
        await getAdminSql().unsafe(
          `GRANT SELECT, DELETE, TRUNCATE ON awcms_workflow_tasks TO "${role}"`
        );
        await getAdminSql().unsafe(
          `GRANT SELECT, TRUNCATE ON awcms_workflow_join_arrivals TO "${role}"`
        );
        await assertRejected(
          getAdminSql().begin(async (tx) => {
            await tx.unsafe(
              `SELECT set_config('app.current_tenant_id', '${TENANT}', true)`
            );
            await tx.unsafe(`SET LOCAL ROLE "${role}"`);
            await tx.unsafe(
              `DELETE FROM awcms_workflow_tasks WHERE id = '${taskId}'`
            );
          }),
          /never deleted or truncated/
        );
        await assertRejected(
          getAdminSql().begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE "${role}"`);
            await tx.unsafe(`TRUNCATE awcms_workflow_join_arrivals`);
          }),
          /never deleted or truncated/
        );
      } finally {
        await getAdminSql().unsafe(
          `REVOKE ALL ON awcms_workflow_tasks FROM "${role}"`
        );
        await getAdminSql().unsafe(
          `REVOKE ALL ON awcms_workflow_join_arrivals FROM "${role}"`
        );
        await getAdminSql().unsafe(
          `REVOKE USAGE ON SCHEMA public FROM "${role}"`
        );
        await getAdminSql().unsafe(`DROP ROLE "${role}"`);
      }

      // The table owner (migrations, tooling) is exempt.
      await withTenantOrThrow(
        getOwnerSql(),
        TENANT,
        (tx) =>
          tx`DELETE FROM awcms_workflow_task_assignments WHERE workflow_task_id = ${taskId}`
      );
    });
  });

  describe("seats are created only the way the engine creates them (L3)", () => {
    const insertSeat = (
      taskId: string,
      userId: string,
      status = "pending",
      tenantId = TENANT
    ) =>
      withTenantOrThrow(
        getRuntimeSql(),
        tenantId,
        (tx) =>
          tx`INSERT INTO awcms_workflow_task_assignments
             (tenant_id, workflow_task_id, tenant_user_id, status)
             VALUES (${tenantId}, ${taskId}, ${userId}, ${status})`
      );

    test("a forged status, a made-up user, the requester and a closed task are refused", async () => {
      if (!appRoleActivated) return;
      const key = await define(approvalGraph("any", [ALICE]));
      const { instanceId, taskId } = await start(key);

      for (const status of ["decided", "skipped"]) {
        await assertRejected(
          insertSeat(taskId!, MALLORY, status),
          /WORKFLOW_ASSIGNMENT_INSERT_STATUS/
        );
      }
      await assertRejected(
        insertSeat(taskId!, crypto.randomUUID()),
        /WORKFLOW_ASSIGNMENT_INSERT_USER/
      );
      await assertRejected(
        insertSeat(taskId!, REQUESTER),
        /WORKFLOW_ASSIGNMENT_INSERT_REQUESTER/
      );

      // A real, active user on a pending task is what the engine does.
      await insertSeat(taskId!, MALLORY);

      await inTenant((tx) =>
        cancelWorkflowInstance(tx, {
          tenantId: TENANT,
          instanceId,
          cancelledByTenantUserId: ADMIN,
          reason: "withdrawn"
        })
      );
      await assertRejected(
        insertSeat(taskId!, BOB),
        /WORKFLOW_ASSIGNMENT_INSERT_TASK/
      );
    });

    test("a seat cannot be filed under another tenant's task", async () => {
      if (!appRoleActivated) return;
      const key = await define(approvalGraph("any", [ALICE]));
      const { taskId } = await start(key);
      const OTHER = "a1032000-0000-4000-8000-0000000000b1";

      await getAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${OTHER}, 'wf-bind-other2', 'Other')
      `;
      await assertRejected(
        insertSeat(taskId!, MALLORY, "pending", OTHER),
        /WORKFLOW_ASSIGNMENT_INSERT_TASK|foreign key|violates/i
      );

      const fk = (await getAdminSql()`
        SELECT conname FROM pg_constraint
        WHERE conname = 'awcms_workflow_assignments_task_tenant_fkey'
      `) as unknown[];

      expect(fk).toHaveLength(1);
    });

    test("the escalation worker can still seat its target (it cannot read tenant users)", async () => {
      if (!workerRoleActivated) return;
      const graph = {
        startNodeId: "a",
        nodes: [
          {
            id: "a",
            type: "approval",
            name: "A",
            assigneeTenantUserIds: [ALICE],
            quorumRule: "any",
            escalation: {
              timeoutMinutes: 60,
              maxEscalations: 2,
              escalateToTenantUserId: BOB
            },
            onApprove: "end_ok",
            onReject: "end_no"
          },
          { id: "end_ok", type: "end", outcome: "approved" },
          { id: "end_no", type: "end", outcome: "rejected" }
        ]
      };
      const key = await define(graph);
      const { taskId } = await start(key);
      const result = await escalateDueTasksForTenant(
        getWorkerRoleSql(),
        TENANT,
        new Date(Date.now() + 2 * 3_600_000)
      );

      expect(result.count).toBe(1);
      await decide(taskId!, BOB, "approve");
    });
  });

  describe("a retired seat needs a PENDING replacement (L2)", () => {
    test("A decides, then B is 'reassigned' to A: refused, so A alone cannot complete 'all'", async () => {
      const key = await define(approvalGraph("all", [ALICE, BOB]));
      const { instanceId, taskId } = await start(key);

      await decide(taskId!, ALICE, "approve");
      await assertRejected(
        inTenant(
          (tx) =>
            tx`UPDATE awcms_workflow_task_assignments
               SET status = 'reassigned', reassigned_to_tenant_user_id = ${ALICE},
                   reassigned_at = now()
               WHERE workflow_task_id = ${taskId} AND tenant_user_id = ${BOB}`
        ),
        /WORKFLOW_ASSIGNMENT_NO_REPLACEMENT/
      );
      expect(await statusOf(instanceId)).toBe("pending");
    });
  });

  describe("who counts as the runtime role (M1b)", () => {
    test("a login created IN ROLE awcms_app is restricted exactly like awcms_app", async () => {
      if (!appRoleActivated) return;
      const role = `awcms_it_member_${process.pid}`;
      const admin = getAdminSql();
      const endOnly = JSON.stringify({
        startNodeId: "e",
        nodes: [{ id: "e", type: "end", outcome: "approved" }]
      });

      await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
      await admin.unsafe(`CREATE ROLE "${role}" NOLOGIN IN ROLE awcms_app`);
      try {
        await assertRejected(
          admin.begin(async (tx) => {
            await tx.unsafe(
              `SELECT set_config('app.current_tenant_id', '${TENANT}', true)`
            );
            await tx.unsafe(`SET LOCAL ROLE "${role}"`);
            await tx.unsafe(
              `INSERT INTO awcms_workflow_definitions
                 (tenant_id, workflow_key, name, version, lifecycle_status, graph)
               VALUES ('${TENANT}', 'member.active', 'M', 1, 'active', '${endOnly}'::jsonb)`
            );
          }),
          /WORKFLOW_DEFINITION_INSERT_STATUS/
        );
      } finally {
        await admin.unsafe(`DROP OWNED BY "${role}"`);
        await admin.unsafe(`DROP ROLE "${role}"`);
      }
    });
  });

  describe("a graph the validator now refuses could never be approved (M2)", () => {
    test("a branch that approves straight to an approved end cannot even be started", async () => {
      const graph = {
        startNodeId: "p",
        nodes: [
          {
            id: "p",
            type: "parallel",
            branchNodeIds: ["a", "b"],
            joinNodeId: "j"
          },
          {
            id: "a",
            type: "approval",
            name: "A",
            assigneeTenantUserIds: [ALICE],
            quorumRule: "any",
            onApprove: "end_ok",
            onReject: "end_no"
          },
          {
            id: "b",
            type: "approval",
            name: "B",
            assigneeTenantUserIds: [BOB],
            quorumRule: "any",
            onApprove: "j",
            onReject: "end_no"
          },
          { id: "j", type: "join", awaitNodeIds: ["a", "b"], next: "end_ok" },
          { id: "end_ok", type: "end", outcome: "approved" },
          { id: "end_no", type: "end", outcome: "rejected" }
        ]
      };
      // Stored directly (publish refuses it); the engine re-validates the
      // pinned graph at start, so no instance can be created that the database
      // would then refuse to approve (the instance cannot approve with the
      // sibling branch's task still open).
      const key = await define(graph);

      await expect(start(key)).rejects.toThrow(/without passing its join/);
    });
  });
});
