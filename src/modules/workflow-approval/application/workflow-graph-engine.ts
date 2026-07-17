/**
 * Graph traversal engine (Issue #747) — shared by `startWorkflowInstance`
 * (`application/workflow-instance.ts`) and task-decision advancement
 * (`application/workflow-instance-decision.ts`). All I/O lives here; node
 * type semantics/validation live in `domain/workflow-graph.ts`,
 * `domain/workflow-condition.ts`.
 *
 * Fan-out/fan-in (`parallel`/`join`): a `parallel` node pushes each of its
 * `branchNodeIds` onto the work queue, TAGGED with that branch's own node
 * id (`branchNodeId`) — this tag propagates down every node activated as
 * part of that branch's chain (stored on `awcms_workflow_tasks
 * .parent_node_id` whenever an `approval` node blocks the branch). When
 * traversal reaches a `join` node, it records that branch's arrival
 * (`awcms_workflow_join_arrivals`, `INSERT ... ON CONFLICT DO
 * NOTHING` — idempotent, a branch can only arrive once) and only
 * continues past the join once EVERY expected branch (`awaitNodeIds`,
 * validated at publish time to equal the parallel node's own
 * `branchNodeIds`) has arrived. This correctly handles both: (a) two
 * branches racing to the join within the SAME `activateNode` call (e.g.
 * neither has a blocking `approval` node), and (b) one branch blocking on
 * a human decision while another already arrived in an earlier call —
 * the arrivals table is the durable, cross-call memory of who already
 * got there.
 *
 * Bounded by `MAX_NODE_ACTIVATIONS` — `domain/workflow-graph.ts`'s
 * `validateWorkflowGraph` already rejects cyclic graphs at publish time,
 * so this is defense-in-depth against a pathological/oversized graph,
 * never expected to trigger in practice.
 */
import {
  findNode,
  type ApprovalNode,
  type WorkflowGraph
} from "../domain/workflow-graph";
import {
  evaluateCondition,
  type FactsSnapshot
} from "../domain/workflow-condition";
import { WORKFLOW_CONDITION_RESOLVERS } from "../infrastructure/condition-action-registry";
import type { WorkflowNotificationPort } from "../../_shared/ports/workflow-notification-port";

const MAX_NODE_ACTIVATIONS = 128;

export type ActivateNodeDeps = {
  notificationPort?: WorkflowNotificationPort;
  correlationId?: string;
};

export type ActivateNodeOutcome = {
  finished: boolean;
  status?: "approved" | "rejected";
};

type QueueEntry = { nodeId: string; branchNodeId: string | null };

function factsToVariables(facts: FactsSnapshot): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const [key, value] of Object.entries(facts)) {
    variables[key] = String(value);
  }

  return variables;
}

async function createApprovalTask(
  tx: Bun.SQL,
  tenantId: string,
  instanceId: string,
  node: ApprovalNode,
  branchNodeId: string | null,
  now: Date
): Promise<void> {
  const dueAt = node.escalation
    ? new Date(now.getTime() + node.escalation.timeoutMinutes * 60_000)
    : null;

  const taskRows = (await tx`
    INSERT INTO awcms_workflow_tasks
      (tenant_id, workflow_instance_id, node_id, parent_node_id,
       quorum_rule, quorum_threshold, due_at, status)
    VALUES (
      ${tenantId}, ${instanceId}, ${node.id}, ${branchNodeId},
      ${node.quorumRule}, ${node.quorumThreshold ?? null}, ${dueAt}, 'pending'
    )
    RETURNING id
  `) as { id: string }[];
  const taskId = taskRows[0]!.id;

  for (const assigneeTenantUserId of node.assigneeTenantUserIds) {
    // ON CONFLICT DO NOTHING (GHSA-9qwq-cmr5-6wfc): `validateWorkflowGraph`
    // does not reject a node whose `assigneeTenantUserIds` repeats a user, so
    // this loop could give one person two live assignment rows on one task —
    // which inflated the quorum's eligible-approver count and let them clear a
    // multi-person quorum alone. Collapsing to one row per person is both the
    // fix and what migration 018's partial unique index now enforces.
    await tx`
      INSERT INTO awcms_workflow_task_assignments
        (tenant_id, workflow_task_id, tenant_user_id, status)
      VALUES (${tenantId}, ${taskId}, ${assigneeTenantUserId}, 'pending')
      ON CONFLICT DO NOTHING
    `;
  }
}

/**
 * Activates `startNodeId` and traverses forward until every resulting
 * branch either blocks on a new `approval` task, stalls at an unready
 * `join`, or the instance reaches an `end` node. Returns `{finished:
 * true, status}` only when an `end` node was actually reached during THIS
 * call — callers must not assume `finished: false` means "nothing
 * happened" (a `notify`/`condition`-only path still advances silently).
 */
export async function activateNode(
  tx: Bun.SQL,
  tenantId: string,
  instanceId: string,
  graph: WorkflowGraph,
  facts: FactsSnapshot,
  startNodeId: string,
  startBranchNodeId: string | null,
  now: Date,
  deps: ActivateNodeDeps
): Promise<ActivateNodeOutcome> {
  const queue: QueueEntry[] = [
    { nodeId: startNodeId, branchNodeId: startBranchNodeId }
  ];
  let iterations = 0;

  while (queue.length > 0) {
    iterations += 1;

    if (iterations > MAX_NODE_ACTIVATIONS) {
      throw new Error(
        `Workflow instance ${instanceId} exceeded ${MAX_NODE_ACTIVATIONS} node activations in a single advance — likely a malformed graph.`
      );
    }

    const entry = queue.shift()!;
    const node = findNode(graph, entry.nodeId);

    if (!node) {
      throw new Error(
        `Workflow graph references unknown node id "${entry.nodeId}".`
      );
    }

    if (node.type === "approval") {
      await createApprovalTask(
        tx,
        tenantId,
        instanceId,
        node,
        entry.branchNodeId,
        now
      );
      continue;
    }

    if (node.type === "condition") {
      const outcome = evaluateCondition(
        node,
        facts,
        tenantId,
        WORKFLOW_CONDITION_RESOLVERS
      );
      queue.push({
        nodeId: outcome ? node.onTrue : node.onFalse,
        branchNodeId: entry.branchNodeId
      });
      continue;
    }

    if (node.type === "parallel") {
      for (const branchNodeId of node.branchNodeIds) {
        queue.push({ nodeId: branchNodeId, branchNodeId });
      }
      continue;
    }

    if (node.type === "join") {
      if (entry.branchNodeId) {
        await tx`
          INSERT INTO awcms_workflow_join_arrivals
            (tenant_id, workflow_instance_id, join_node_id, branch_node_id)
          VALUES (${tenantId}, ${instanceId}, ${node.id}, ${entry.branchNodeId})
          ON CONFLICT (workflow_instance_id, join_node_id, branch_node_id) DO NOTHING
        `;
      }

      const arrivalRows = (await tx`
        SELECT COUNT(DISTINCT branch_node_id) AS arrived
        FROM awcms_workflow_join_arrivals
        WHERE tenant_id = ${tenantId}
          AND workflow_instance_id = ${instanceId}
          AND join_node_id = ${node.id}
      `) as { arrived: string | number }[];
      const arrived = Number(arrivalRows[0]?.arrived ?? 0);

      if (arrived < node.awaitNodeIds.length) {
        continue;
      }

      queue.push({ nodeId: node.next, branchNodeId: null });
      continue;
    }

    if (node.type === "notify") {
      if (deps.notificationPort) {
        await deps.notificationPort.enqueueNotification(tx, {
          tenantId,
          templateKey: node.templateKey,
          recipientTenantUserIds: node.recipientTenantUserIds,
          variables: factsToVariables(facts),
          correlationId: deps.correlationId
        });
      }
      queue.push({ nodeId: node.next, branchNodeId: entry.branchNodeId });
      continue;
    }

    // node.type === "end"
    //
    // `AND status = 'pending'` (Issue #152) matches the guard
    // `cancelWorkflowInstance` (`workflow-recovery.ts`) already uses. Without
    // it this UPDATE overwrote the status unconditionally, so a decision that
    // was in flight when the instance got cancelled RESURRECTED it as
    // approved/rejected — silently undoing the cancellation.
    //
    // Zero rows means someone else moved the instance out of 'pending' (a
    // concurrent cancel) while this decision was mid-flight. Throwing rolls
    // the whole transaction back, which is the only safe answer: returning
    // `finished: false` would leave the task marked 'completed' and the
    // decision recorded against an instance that never finished, and any
    // task/notification this traversal already created would survive. The
    // task-row `FOR UPDATE` in `fetchTaskWithInstanceForDecision` makes this
    // near-unreachable (a cancel marks this task 'cancelled', so the route
    // 409s long before here) — this is the defence-in-depth backstop for the
    // remaining lock-order window, not the primary guard.
    const finishedRows = (await tx`
      UPDATE awcms_workflow_instances
      SET status = ${node.outcome}, updated_at = ${now}
      WHERE tenant_id = ${tenantId} AND id = ${instanceId} AND status = 'pending'
      RETURNING id
    `) as { id: string }[];

    if (!finishedRows[0]) {
      throw new Error(
        `Workflow instance ${instanceId} is no longer pending (concurrently cancelled or finished); refusing to overwrite its status with "${node.outcome}".`
      );
    }

    return { finished: true, status: node.outcome };
  }

  return { finished: false };
}
