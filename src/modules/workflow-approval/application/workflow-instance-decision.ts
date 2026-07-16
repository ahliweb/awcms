/**
 * Task-decision recording + quorum evaluation + graph advancement (Issue
 * #747, evolves Issue 11.1's linear `evaluateDecisionOutcome`). Called by
 * `POST /api/v1/workflows/tasks/{id}/decisions` AFTER the route's own
 * ABAC guard (`evaluateAccess`, including the existing self-approval
 * denial reused unchanged) has already allowed the request — this
 * function additionally enforces the NARROWER business rule "is the
 * calling tenant user actually one of this task's eligible deciders
 * (directly assigned, or an active delegate of an assignee)", which ABAC
 * has no notion of.
 */
import { assertUuid } from "../../../lib/database/tenant-context";
import type { ApprovalNode, WorkflowGraph } from "../domain/workflow-graph";
import { validateWorkflowGraph } from "../domain/workflow-graph";
import { findNode } from "../domain/workflow-graph";
import type { FactsSnapshot } from "../domain/workflow-condition";
import { getWorkflowConditionResolverNames } from "../infrastructure/condition-action-registry";
import {
  resolveEffectiveDeciderIds,
  type WorkflowDelegationRow
} from "../domain/workflow-delegation";
import {
  evaluateQuorumOutcome,
  type TaskDecisionKind
} from "../domain/workflow-quorum";
import { activateNode, type ActivateNodeDeps } from "./workflow-graph-engine";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  WORKFLOW_EVENT_VERSION,
  WORKFLOW_INSTANCE_ADVANCED_EVENT_TYPE,
  WORKFLOW_INSTANCE_APPROVED_EVENT_TYPE,
  WORKFLOW_INSTANCE_REJECTED_EVENT_TYPE
} from "../../domain-event-runtime/domain/event-type-registry";

export type TaskWithInstanceRow = {
  id: string;
  node_id: string;
  parent_node_id: string | null;
  status: string;
  quorum_rule: "all" | "any" | "quorum";
  quorum_threshold: number | null;
  instance_id: string;
  instance_status: string;
  resource_type: string;
  requested_by_tenant_user_id: string;
  facts: unknown;
  graph: unknown;
  facts_schema: unknown;
  workflow_key: string;
};

type AssignmentRow = {
  id: string;
  tenant_user_id: string;
  status: "pending" | "decided" | "reassigned" | "skipped";
};

type DelegationDbRow = {
  id: string;
  delegator_tenant_user_id: string;
  delegate_tenant_user_id: string;
  workflow_key: string | null;
  resource_type: string | null;
  effective_from: Date;
  effective_to: Date | null;
  status: "active" | "revoked";
};

function toDomainDelegationRow(row: DelegationDbRow): WorkflowDelegationRow {
  return {
    id: row.id,
    delegatorTenantUserId: row.delegator_tenant_user_id,
    delegateTenantUserId: row.delegate_tenant_user_id,
    workflowKey: row.workflow_key,
    resourceType: row.resource_type,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status
  };
}

export async function fetchTaskWithInstanceForDecision(
  tx: Bun.SQL,
  tenantId: string,
  taskId: string
): Promise<TaskWithInstanceRow | undefined> {
  const rows = (await tx`
    SELECT t.id, t.node_id, t.parent_node_id, t.status, t.quorum_rule, t.quorum_threshold,
           i.id AS instance_id, i.status AS instance_status, i.resource_type,
           i.requested_by_tenant_user_id, i.facts,
           d.graph, d.facts_schema, d.workflow_key
    FROM awcms_workflow_tasks t
    JOIN awcms_workflow_instances i ON i.id = t.workflow_instance_id
    JOIN awcms_workflow_definitions d ON d.id = i.workflow_definition_id
    WHERE t.tenant_id = ${tenantId} AND t.id = ${taskId}
  `) as TaskWithInstanceRow[];

  return rows[0];
}

/**
 * Returns the assignment row the caller may decide through — either
 * their own direct assignment, or an assignment whose original assignee
 * has an active, in-scope delegation naming the caller as delegate.
 * `null` means the caller is not an eligible decider for this task at
 * all (distinct from a permission/self-approval denial, which the route
 * already checked separately via ABAC).
 */
export async function findEligibleAssignment(
  tx: Bun.SQL,
  tenantId: string,
  taskId: string,
  decidingTenantUserId: string,
  workflowKey: string,
  resourceType: string,
  now: Date
): Promise<AssignmentRow | null> {
  const assignments = (await tx`
    SELECT id, tenant_user_id, status
    FROM awcms_workflow_task_assignments
    WHERE tenant_id = ${tenantId} AND workflow_task_id = ${taskId}
      AND status IN ('pending', 'decided')
  `) as AssignmentRow[];

  const delegationRows = (await tx`
    SELECT id, delegator_tenant_user_id, delegate_tenant_user_id, workflow_key,
           resource_type, effective_from, effective_to, status
    FROM awcms_workflow_delegations
    WHERE tenant_id = ${tenantId} AND status = 'active'
      AND delegate_tenant_user_id = ${decidingTenantUserId}
  `) as DelegationDbRow[];
  const delegations = delegationRows.map(toDomainDelegationRow);

  for (const assignment of assignments) {
    if (assignment.status !== "pending") {
      continue;
    }

    const eligibleIds = resolveEffectiveDeciderIds(
      assignment.tenant_user_id,
      delegations,
      now,
      { workflowKey, resourceType }
    );

    if (eligibleIds.includes(decidingTenantUserId)) {
      return assignment;
    }
  }

  return null;
}

export type RecordTaskDecisionParams = {
  tenantId: string;
  taskId: string;
  task: TaskWithInstanceRow;
  assignment: AssignmentRow;
  decidingTenantUserId: string;
  decision: "approve" | "reject";
  reason?: string;
  now: Date;
  correlationId?: string;
} & ActivateNodeDeps;

export type RecordTaskDecisionResult = {
  instanceId: string;
  taskCompleted: boolean;
  instanceFinished: boolean;
  instanceStatus?: "approved" | "rejected";
};

/**
 * Assumes the caller (route) has already: located `task`/`assignment`
 * (via `fetchTaskWithInstanceForDecision`/`findEligibleAssignment`),
 * confirmed `task.status === 'pending'`, and passed ABAC/self-approval
 * (`evaluateAccess`). Records the decision (append-only), marks the
 * assignment `decided`, evaluates quorum, and — only once the task
 * itself completes — advances the graph.
 */
export async function recordWorkflowTaskDecision(
  tx: Bun.SQL,
  params: RecordTaskDecisionParams
): Promise<RecordTaskDecisionResult> {
  const tenantId = assertUuid(params.tenantId);
  const taskId = assertUuid(params.taskId);

  await tx`
    INSERT INTO awcms_workflow_decisions
      (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id,
       on_behalf_of_tenant_user_id, reason)
    VALUES (
      ${tenantId}, ${taskId}, ${params.decision}, ${params.decidingTenantUserId},
      ${params.assignment.tenant_user_id === params.decidingTenantUserId ? null : params.assignment.tenant_user_id},
      ${params.reason ?? null}
    )
  `;

  await tx`
    UPDATE awcms_workflow_task_assignments
    SET status = 'decided', decided_at = ${params.now}
    WHERE tenant_id = ${tenantId} AND id = ${params.assignment.id}
  `;

  const eligibleCountRows = (await tx`
    SELECT COUNT(*) AS count
    FROM awcms_workflow_task_assignments
    WHERE tenant_id = ${tenantId} AND workflow_task_id = ${taskId}
      AND status IN ('pending', 'decided')
  `) as { count: string | number }[];
  const eligibleAssigneeCount = Number(eligibleCountRows[0]?.count ?? 0);

  const decisionRows = (await tx`
    SELECT decision FROM awcms_workflow_decisions
    WHERE tenant_id = ${tenantId} AND workflow_task_id = ${taskId}
  `) as { decision: TaskDecisionKind }[];
  const decisions = decisionRows.map((r) => r.decision);

  const quorumOutcome = evaluateQuorumOutcome({
    quorumRule: params.task.quorum_rule,
    quorumThreshold: params.task.quorum_threshold ?? undefined,
    eligibleAssigneeCount,
    decisions
  });

  if (!quorumOutcome.complete) {
    return {
      instanceId: params.task.instance_id,
      taskCompleted: false,
      instanceFinished: false
    };
  }

  const advanceOutcome = await completeApprovalTaskAndAdvance(tx, tenantId, {
    task: params.task,
    outcome: quorumOutcome.outcome,
    actorTenantUserId: params.decidingTenantUserId,
    now: params.now,
    correlationId: params.correlationId,
    notificationPort: params.notificationPort
  });

  return {
    instanceId: params.task.instance_id,
    taskCompleted: true,
    ...advanceOutcome
  };
}

export type CompleteApprovalTaskParams = {
  task: TaskWithInstanceRow;
  outcome: "approved" | "rejected";
  actorTenantUserId: string;
  now: Date;
  correlationId?: string;
} & ActivateNodeDeps;

export type CompleteApprovalTaskResult = {
  instanceFinished: boolean;
  instanceStatus?: "approved" | "rejected";
};

/**
 * Shared by `recordWorkflowTaskDecision` (once quorum completes the task)
 * and `application/workflow-recovery.ts`'s `forceWorkflowTaskDecision`
 * (an administrative override always completes the task immediately,
 * bypassing quorum). Marks the task `completed`, resolves the graph's
 * `onApprove`/`onReject` target, and advances via `activateNode`.
 */
export async function completeApprovalTaskAndAdvance(
  tx: Bun.SQL,
  tenantId: string,
  params: CompleteApprovalTaskParams
): Promise<CompleteApprovalTaskResult> {
  const taskId = assertUuid(params.task.id);

  await tx`
    UPDATE awcms_workflow_tasks
    SET status = 'completed'
    WHERE tenant_id = ${tenantId} AND id = ${taskId}
  `;

  const graphResult = validateWorkflowGraph(
    params.task.graph,
    params.task.facts_schema,
    getWorkflowConditionResolverNames()
  );

  if (!graphResult.valid) {
    throw new Error(
      `Pinned workflow definition for instance ${params.task.instance_id} has an invalid graph.`
    );
  }

  const graph = graphResult.value as WorkflowGraph;
  const node = findNode(graph, params.task.node_id) as ApprovalNode | undefined;

  if (!node) {
    throw new Error(
      `Task ${taskId} references unknown node id "${params.task.node_id}".`
    );
  }

  const nextNodeId =
    params.outcome === "approved" ? node.onApprove : node.onReject;

  await appendDomainEvent(tx, tenantId, {
    eventType: WORKFLOW_INSTANCE_ADVANCED_EVENT_TYPE,
    eventVersion: WORKFLOW_EVENT_VERSION,
    aggregateType: "workflow_instance",
    aggregateId: params.task.instance_id,
    producerModule: "workflow",
    correlationId: params.correlationId,
    actorTenantUserId: params.actorTenantUserId,
    payload: {
      workflowKey: params.task.workflow_key,
      nodeId: params.task.node_id,
      outcome: params.outcome
    }
  });

  const activateOutcome = await activateNode(
    tx,
    tenantId,
    params.task.instance_id,
    graph,
    (params.task.facts ?? {}) as FactsSnapshot,
    nextNodeId,
    params.task.parent_node_id,
    params.now,
    {
      notificationPort: params.notificationPort,
      correlationId: params.correlationId
    }
  );

  if (activateOutcome.finished) {
    await appendDomainEvent(tx, tenantId, {
      eventType:
        activateOutcome.status === "approved"
          ? WORKFLOW_INSTANCE_APPROVED_EVENT_TYPE
          : WORKFLOW_INSTANCE_REJECTED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      aggregateType: "workflow_instance",
      aggregateId: params.task.instance_id,
      producerModule: "workflow",
      correlationId: params.correlationId,
      payload: { workflowKey: params.task.workflow_key }
    });
  }

  return {
    instanceFinished: activateOutcome.finished,
    instanceStatus: activateOutcome.finished
      ? activateOutcome.status
      : undefined
  };
}
