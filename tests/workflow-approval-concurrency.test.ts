/**
 * Real-PostgreSQL concurrency tests for workflow approval (Issue #140, Issue
 * #152, GHSA-9qwq-cmr5-6wfc). These CANNOT be written against a fake `Bun.SQL`:
 * every bug under test is a property of PostgreSQL's READ COMMITTED snapshot
 * and row-locking semantics, so a stubbed driver would prove nothing.
 *
 * Requires a throwaway database whose schema has had `sql/` applied
 * (`bun run db:migrate`). Gated on `DATABASE_URL` — the same convention
 * `reporting-projection-rebuild-lock.test.ts` uses, and the reason this suite
 * actually executes somewhere: `ci.yml` has no database so it skips cleanly
 * there, while `release.yml` provides a throwaway `postgres:18.4` service and
 * sets `DATABASE_URL`. Gating on a bespoke variable instead would mean these
 * tests never run in any pipeline. `WORKFLOW_TEST_DATABASE_URL` still
 * overrides it for a local run against a scratch database.
 *
 * The suite only ever touches tenants it creates itself, and deletes them
 * again afterwards.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { activateNode } from "../src/modules/workflow-approval/application/workflow-graph-engine";
import {
  fetchTaskWithInstanceForDecision,
  findEligibleAssignment,
  recordWorkflowTaskDecision
} from "../src/modules/workflow-approval/application/workflow-instance-decision";
import { escalateDueTasksForTenant } from "../src/modules/workflow-approval/application/workflow-escalation";
import {
  WorkflowRecoveryError,
  reassignWorkflowTask
} from "../src/modules/workflow-approval/application/workflow-recovery";
import type { WorkflowGraph } from "../src/modules/workflow-approval/domain/workflow-graph";
import {
  WORKFLOW_INSTANCE_ADVANCED_EVENT_TYPE,
  WORKFLOW_INSTANCE_APPROVED_EVENT_TYPE
} from "../src/modules/domain-event-runtime/domain/event-type-registry";

const DATABASE_URL =
  process.env.WORKFLOW_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUESTER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type QuorumRule = "all" | "any" | "quorum";

function approvalGraph(
  quorumRule: QuorumRule,
  assignees: string[],
  options: {
    quorumThreshold?: number;
    escalation?: { escalateToTenantUserId: string };
  } = {}
): WorkflowGraph {
  const { quorumThreshold, escalation } = options;

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
        onApprove: "end_approved",
        onReject: "end_rejected",
        ...(escalation
          ? {
              escalation: {
                timeoutMinutes: 60,
                maxEscalations: 3,
                escalateToTenantUserId: escalation.escalateToTenantUserId
              }
            }
          : {})
      },
      { id: "end_approved", type: "end", outcome: "approved" },
      { id: "end_rejected", type: "end", outcome: "rejected" }
    ]
  } as unknown as WorkflowGraph;
}

type Seeded = { tenantId: string; instanceId: string; taskId: string };

const describeOrSkip = DATABASE_URL ? describe : describe.skip;

describeOrSkip("workflow approval concurrency (real PostgreSQL)", () => {
  let sql: Bun.SQL;
  const createdTenantIds: string[] = [];

  beforeAll(() => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 10 });
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`DELETE FROM awcms_domain_event_deliveries WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_domain_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_workflow_decisions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_workflow_task_assignments WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_workflow_tasks WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_workflow_instances WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_workflow_definitions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }
    await sql.close({ timeout: 5 });
  });

  /** Fresh tenant + published definition + pending instance + pending task per test — no shared state between tests. */
  async function seed(
    graph: WorkflowGraph,
    assignees: string[],
    quorumRule: QuorumRule,
    options: { dueAt?: Date; quorumThreshold?: number } = {}
  ): Promise<Seeded> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const tenantRows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`wf-race-${suffix}`}, ${"Workflow race test"})
      RETURNING id
    `) as { id: string }[];
    const tenantId = tenantRows[0]!.id;
    createdTenantIds.push(tenantId);

    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;

    const definitionRows = (await sql`
      INSERT INTO awcms_workflow_definitions
        (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
      VALUES (${tenantId}, ${"race"}, ${"Race"}, 1, 'active',
              ${graph}::jsonb, ${[]}::jsonb)
      RETURNING id
    `) as { id: string }[];

    const instanceRows = (await sql`
      INSERT INTO awcms_workflow_instances
        (tenant_id, workflow_definition_id, workflow_definition_version,
         resource_type, resource_id, status, requested_by_tenant_user_id, facts)
      VALUES (${tenantId}, ${definitionRows[0]!.id}, 1, ${"invoice"}, ${"inv-1"},
              'pending', ${REQUESTER}, '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const instanceId = instanceRows[0]!.id;

    const taskRows = (await sql`
      INSERT INTO awcms_workflow_tasks
        (tenant_id, workflow_instance_id, node_id, quorum_rule, quorum_threshold,
         status, due_at)
      VALUES (${tenantId}, ${instanceId}, ${"approval"}, ${quorumRule},
              ${options.quorumThreshold ?? null}, 'pending', ${options.dueAt ?? null})
      RETURNING id
    `) as { id: string }[];
    const taskId = taskRows[0]!.id;

    for (const assignee of assignees) {
      await sql`
        INSERT INTO awcms_workflow_task_assignments
          (tenant_id, workflow_task_id, tenant_user_id, status)
        VALUES (${tenantId}, ${taskId}, ${assignee}, 'pending')
        ON CONFLICT DO NOTHING
      `;
    }

    return { tenantId, instanceId, taskId };
  }

  /** What the route would have returned: 409, 403, or a recorded decision. */
  type DecisionAttempt =
    | { kind: "not_pending" }
    | { kind: "not_eligible" }
    | { kind: "recorded"; taskCompleted: boolean };

  /**
   * One approver's transaction, mirroring what `POST
   * /api/v1/workflows/tasks/{id}/decisions` does in the same order (fetch ->
   * "still pending?" gate -> eligibility -> record).
   *
   * `gate` is awaited AFTER the decision is recorded but BEFORE the
   * transaction commits. That placement is the whole point: it is what lets a
   * test hold one approver's decision uncommitted while a second approver runs
   * the same path, which is precisely the interleaving READ COMMITTED cannot
   * survive unaided. Gating any earlier (e.g. right after the fetch) would let
   * the second approver commit before the first ever wrote its decision — the
   * two would then be sequential, not concurrent, and the bug would not
   * reproduce even on unfixed code.
   */
  async function decide(
    seeded: Seeded,
    decidingTenantUserId: string,
    gate?: Promise<void>
  ): Promise<DecisionAttempt> {
    return sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${seeded.tenantId}, true)`;

      const task = await fetchTaskWithInstanceForDecision(
        tx,
        seeded.tenantId,
        seeded.taskId
      );

      // The route's own gate — with the task-row lock in place, the loser of
      // the race blocks on the fetch above and observes the winner's committed
      // status here.
      if (task!.status !== "pending") {
        return { kind: "not_pending" } as const;
      }

      const assignment = await findEligibleAssignment(
        tx,
        seeded.tenantId,
        seeded.taskId,
        decidingTenantUserId,
        task!.workflow_key,
        task!.resource_type,
        new Date()
      );

      // The route turns this into a 403.
      if (!assignment) {
        return { kind: "not_eligible" } as const;
      }

      const result = await recordWorkflowTaskDecision(tx, {
        tenantId: seeded.tenantId,
        taskId: seeded.taskId,
        task: task!,
        assignment,
        decidingTenantUserId,
        decision: "approve",
        now: new Date(),
        correlationId: undefined
      });

      if (gate) await gate;

      return {
        kind: "recorded",
        taskCompleted: result.taskCompleted
      } as const;
    }) as Promise<DecisionAttempt>;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Drives two approvers into the exact interleaving that breaks READ
   * COMMITTED: A records its decision and holds it uncommitted while B runs
   * the whole decision path. Unfixed, B's snapshot cannot see A's decision, so
   * both evaluate quorum on half the picture. Fixed, B blocks on A's task-row
   * lock at the fetch and only proceeds once A has committed.
   *
   * B is deliberately never awaited before A is released: under the fix B is
   * BLOCKED at that moment, so awaiting it here would hang forever.
   */
  async function raceTwoApprovers(seeded: Seeded) {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = () => resolve();
    });

    const first = decide(seeded, USER_A, firstGate);
    await sleep(250); // A: fetch (taking the lock) + record, then hold

    const second = decide(seeded, USER_B);
    await sleep(250); // B: blocks on the lock, or (unfixed) sails past it

    releaseFirst(); // A commits

    return Promise.all([first, second]);
  }

  test("Issue #140 — concurrent approvals on a quorumRule:'all' task must not deadlock the task", async () => {
    const graph = approvalGraph("all", [USER_A, USER_B]);
    const seeded = await seed(graph, [USER_A, USER_B], "all");

    const [a, b] = await raceTwoApprovers(seeded);

    // Exactly one of the two must observe the completed quorum and advance.
    // Before the fix BOTH saw approveCount = 1 < 2 and concluded "not
    // complete", so neither advanced and the task was stranded forever.
    const completions = [a, b].filter(
      (r) => r.kind === "recorded" && r.taskCompleted
    );
    expect(completions).toHaveLength(1);

    await sql`SELECT set_config('app.current_tenant_id', ${seeded.tenantId}, false)`;

    const taskRows = (await sql`
      SELECT status FROM awcms_workflow_tasks WHERE id = ${seeded.taskId}
    `) as { status: string }[];
    const assignmentRows = (await sql`
      SELECT status FROM awcms_workflow_task_assignments
      WHERE workflow_task_id = ${seeded.taskId}
    `) as { status: string }[];

    // The stranding symptom: every assignment decided but the task still
    // 'pending' -> findEligibleAssignment returns null forever -> everyone
    // 403s and the escalation worker re-escalates forever.
    expect(assignmentRows.every((r) => r.status === "decided")).toBe(true);
    expect(taskRows[0]!.status).toBe("completed");

    const instanceRows = (await sql`
      SELECT status FROM awcms_workflow_instances WHERE id = ${seeded.instanceId}
    `) as { status: string }[];
    expect(instanceRows[0]!.status).toBe("approved");
  });

  test("Issue #140 — concurrent approvals on a quorumRule:'any' task must advance the graph exactly once", async () => {
    const graph = approvalGraph("any", [USER_A, USER_B]);
    const seeded = await seed(graph, [USER_A, USER_B], "any");

    const [a, b] = await raceTwoApprovers(seeded);

    // One advances; the other must find the task no longer pending (the route
    // turns that into a 409). Before the fix both concluded "complete" and ran
    // activateNode twice -> duplicate downstream tasks and doubled events.
    const advanced = [a, b].filter(
      (r) => r.kind === "recorded" && r.taskCompleted
    );
    expect(advanced).toHaveLength(1);

    await sql`SELECT set_config('app.current_tenant_id', ${seeded.tenantId}, false)`;

    const advancedEventRows = (await sql`
      SELECT COUNT(*) AS count FROM awcms_domain_events
      WHERE tenant_id = ${seeded.tenantId}
        AND event_type = ${WORKFLOW_INSTANCE_ADVANCED_EVENT_TYPE}
    `) as { count: string | number }[];
    expect(Number(advancedEventRows[0]!.count)).toBe(1);

    const approvedEventRows = (await sql`
      SELECT COUNT(*) AS count FROM awcms_domain_events
      WHERE tenant_id = ${seeded.tenantId}
        AND event_type = ${WORKFLOW_INSTANCE_APPROVED_EVENT_TYPE}
    `) as { count: string | number }[];
    expect(Number(approvedEventRows[0]!.count)).toBe(1);
  });

  test("Issue #152 — an 'end' node must not resurrect an instance that was cancelled mid-decision", async () => {
    const graph = approvalGraph("any", [USER_A]);
    const seeded = await seed(graph, [USER_A], "any");

    await sql`SELECT set_config('app.current_tenant_id', ${seeded.tenantId}, false)`;
    await sql`
      UPDATE awcms_workflow_instances
      SET status = 'cancelled', cancelled_at = now(), cancel_reason = ${"test"}
      WHERE id = ${seeded.instanceId}
    `;

    // An in-flight decision reaching the 'end' node after the cancellation
    // committed. Before the fix the UPDATE had no status guard and flipped the
    // instance back to 'approved', silently undoing the cancellation.
    const attempt = sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${seeded.tenantId}, true)`;
      return activateNode(
        tx,
        seeded.tenantId,
        seeded.instanceId,
        graph,
        {},
        "end_approved",
        null,
        new Date(),
        {}
      );
    });

    expect(attempt).rejects.toThrow(/no longer pending/);

    const rows = (await sql`
      SELECT status FROM awcms_workflow_instances WHERE id = ${seeded.instanceId}
    `) as { status: string }[];
    expect(rows[0]!.status).toBe("cancelled");
  });

  test("GHSA-9qwq-cmr5-6wfc — one person must not satisfy a 2-person quorum alone by being their own escalation target", async () => {
    // The exact shape of the bypass: a task requiring TWO approvals
    // (quorumRule 'quorum', threshold 2) over [A, B], where A is also the
    // node's escalation target — realistic, since a manager's overdue task
    // commonly escalates into that same manager's queue.
    const graph = approvalGraph("quorum", [USER_A, USER_B], {
      quorumThreshold: 2,
      escalation: { escalateToTenantUserId: USER_A }
    });
    const seeded = await seed(graph, [USER_A, USER_B], "quorum", {
      quorumThreshold: 2,
      dueAt: new Date(Date.now() - 60_000)
    });

    const result = await escalateDueTasksForTenant(
      sql,
      seeded.tenantId,
      new Date()
    );
    expect(result.count).toBe(1);

    await sql`SELECT set_config('app.current_tenant_id', ${seeded.tenantId}, false)`;

    // Unfixed, the escalation INSERT was unconditional and handed USER_A a
    // SECOND live assignment row on the same task.
    const aRows = (await sql`
      SELECT COUNT(*) AS count FROM awcms_workflow_task_assignments
      WHERE workflow_task_id = ${seeded.taskId}
        AND tenant_user_id = ${USER_A}
        AND status IN ('pending', 'decided')
    `) as { count: string | number }[];
    expect(Number(aRows[0]!.count)).toBe(1);

    // The attack: USER_A approves, consuming their first seat...
    const firstApproval = await decide(seeded, USER_A);
    expect(firstApproval).toEqual({ kind: "recorded", taskCompleted: false });

    // ...then approves AGAIN through the duplicate seat. Unfixed,
    // findEligibleAssignment happily returns A's still-'pending' second row,
    // a second 'approve' decision lands, approveCount reaches the threshold of
    // 2, and the task completes — approved by one person acting alone. Fixed,
    // A holds exactly one seat, already spent, so they are no longer an
    // eligible decider and the route 403s.
    const secondApproval = await decide(seeded, USER_A);
    expect(secondApproval).toEqual({ kind: "not_eligible" });

    // The task must still be waiting for a second REAL person (USER_B).
    const taskRows = (await sql`
      SELECT status FROM awcms_workflow_tasks WHERE id = ${seeded.taskId}
    `) as { status: string }[];
    expect(taskRows[0]!.status).toBe("pending");

    const instanceRows = (await sql`
      SELECT status FROM awcms_workflow_instances WHERE id = ${seeded.instanceId}
    `) as { status: string }[];
    expect(instanceRows[0]!.status).toBe("pending");
  });
  test("a rejected reassign must not retire the task's live seats — a 4xx returned from inside the transaction still COMMITS", async () => {
    const graph = approvalGraph("all", [USER_A, USER_B]);
    const { tenantId, taskId } = await seed(graph, [USER_A, USER_B], "all");

    // USER_A decides; USER_B keeps a live 'pending' seat.
    await sql`
      UPDATE awcms_workflow_task_assignments SET status = 'decided'
      WHERE tenant_id = ${tenantId} AND workflow_task_id = ${taskId}
        AND tenant_user_id = ${USER_A}
    `;

    // Mirror the route EXACTLY: it catches WorkflowRecoveryError INSIDE the
    // withTenant callback and returns a 409 response. Returning (rather than
    // throwing) is what makes the transaction COMMIT — throwing out of
    // sql.begin would roll back and hide the bug entirely.
    const outcome = await sql.begin(async (tx: Bun.SQL) => {
      await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
      try {
        await reassignWorkflowTask(tx, {
          tenantId,
          taskId,
          toTenantUserId: USER_A,
          reassignedByTenantUserId: REQUESTER,
          reason: "mistake"
        });
        return "reassigned";
      } catch (error) {
        if (error instanceof WorkflowRecoveryError) return "409";
        throw error;
      }
    });

    expect(outcome).toBe("409");

    // ...without having retired USER_B on the way out. The route maps
    // WorkflowRecoveryError to a 409 from INSIDE the withTenant callback, so a
    // throw that lands after the retirement UPDATE would commit it and leave
    // the task with zero deciders while reporting failure.
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
    const live = (await sql`
      SELECT tenant_user_id, status FROM awcms_workflow_task_assignments
      WHERE tenant_id = ${tenantId} AND workflow_task_id = ${taskId}
        AND status = 'pending'
    `) as { tenant_user_id: string; status: string }[];

    expect(live).toHaveLength(1);
    expect(live[0]!.tenant_user_id).toBe(USER_B);
  });
});
