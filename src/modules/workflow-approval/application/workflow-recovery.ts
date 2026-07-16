/**
 * Administrative recovery actions (Issue #747): reassign a pending task,
 * cancel a running instance, or force-approve/force-reject a pending task
 * bypassing quorum. Every action here is high-risk — the calling route
 * (`src/pages/api/v1/workflows/**`) is responsible for the explicit
 * permission gate (`workflow.recovery.*`, doc 17), `Idempotency-Key`, and
 * `recordAuditEvent`; this module focuses on the state transition itself,
 * always by APPENDING a new row/status transition — never overwriting or
 * deleting a prior decision/task/assignment row (AGENTS.md rule #12).
 */
import { assertUuid } from "../../../lib/database/tenant-context";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  WORKFLOW_EVENT_VERSION,
  WORKFLOW_INSTANCE_CANCELLED_EVENT_TYPE
} from "../../domain-event-runtime/domain/event-type-registry";
import {
  completeApprovalTaskAndAdvance,
  fetchTaskWithInstanceForDecision,
  type CompleteApprovalTaskResult
} from "./workflow-instance-decision";
import type { ActivateNodeDeps } from "./workflow-graph-engine";

export class WorkflowRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRecoveryError";
  }
}

export type ReassignWorkflowTaskParams = {
  tenantId: string;
  taskId: string;
  toTenantUserId: string;
  reassignedByTenantUserId: string;
  reason: string;
};

export type ReassignWorkflowTaskResult = { assignmentId: string };

/**
 * Marks every currently-`pending` assignment on the task `reassigned`
 * (never deleted) and appends ONE new `pending` assignment for
 * `toTenantUserId` — the task itself stays `pending`, now decidable by
 * the new assignee (or any other still-pending original assignee, for a
 * multi-assignee quorum/any/all task where only one seat is being
 * reassigned is out of scope here; this reassigns the WHOLE task's
 * currently-open seats to the single new assignee, the common case).
 */
export async function reassignWorkflowTask(
  tx: Bun.SQL,
  params: ReassignWorkflowTaskParams
): Promise<ReassignWorkflowTaskResult> {
  const tenantId = assertUuid(params.tenantId);
  const taskId = assertUuid(params.taskId);

  const taskRows = (await tx`
    SELECT status FROM awcms_workflow_tasks
    WHERE tenant_id = ${tenantId} AND id = ${taskId}
  `) as { status: string }[];

  if (!taskRows[0]) {
    throw new WorkflowRecoveryError("Workflow task not found.");
  }

  if (taskRows[0].status !== "pending") {
    throw new WorkflowRecoveryError(
      `Only a pending task can be reassigned (current status: "${taskRows[0].status}").`
    );
  }

  await tx`
    UPDATE awcms_workflow_task_assignments
    SET status = 'reassigned', reassigned_to_tenant_user_id = ${params.toTenantUserId},
        reassigned_at = now(), reassigned_by_tenant_user_id = ${params.reassignedByTenantUserId},
        reassign_reason = ${params.reason}
    WHERE tenant_id = ${tenantId} AND workflow_task_id = ${taskId} AND status = 'pending'
  `;

  const newAssignmentRows = (await tx`
    INSERT INTO awcms_workflow_task_assignments
      (tenant_id, workflow_task_id, tenant_user_id, status)
    VALUES (${tenantId}, ${taskId}, ${params.toTenantUserId}, 'pending')
    RETURNING id
  `) as { id: string }[];

  return { assignmentId: newAssignmentRows[0]!.id };
}

export type CancelWorkflowInstanceParams = {
  tenantId: string;
  instanceId: string;
  cancelledByTenantUserId: string;
  reason: string;
  correlationId?: string;
};

export async function cancelWorkflowInstance(
  tx: Bun.SQL,
  params: CancelWorkflowInstanceParams
): Promise<void> {
  const tenantId = assertUuid(params.tenantId);
  const instanceId = assertUuid(params.instanceId);

  const rows = (await tx`
    UPDATE awcms_workflow_instances
    SET status = 'cancelled', cancelled_at = now(),
        cancelled_by_tenant_user_id = ${params.cancelledByTenantUserId},
        cancel_reason = ${params.reason}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${instanceId} AND status = 'pending'
    RETURNING id
  `) as { id: string }[];

  if (!rows[0]) {
    throw new WorkflowRecoveryError(
      "Workflow instance not found, or is not in a cancellable (pending) state."
    );
  }

  await tx`
    UPDATE awcms_workflow_tasks
    SET status = 'cancelled', cancelled_at = now()
    WHERE tenant_id = ${tenantId} AND workflow_instance_id = ${instanceId} AND status = 'pending'
  `;

  await appendDomainEvent(tx, tenantId, {
    eventType: WORKFLOW_INSTANCE_CANCELLED_EVENT_TYPE,
    eventVersion: WORKFLOW_EVENT_VERSION,
    aggregateType: "workflow_instance",
    aggregateId: instanceId,
    producerModule: "workflow",
    correlationId: params.correlationId,
    actorTenantUserId: params.cancelledByTenantUserId,
    payload: { reason: params.reason }
  });
}

export type ForceWorkflowTaskDecisionParams = {
  tenantId: string;
  taskId: string;
  decision: "force_approve" | "force_reject";
  forcedByTenantUserId: string;
  reason: string;
  now: Date;
  correlationId?: string;
} & ActivateNodeDeps;

export type ForceWorkflowTaskDecisionResult = {
  instanceId: string;
} & CompleteApprovalTaskResult;

/**
 * Administrative override — bypasses quorum entirely (a single forced
 * decision always completes the task), still recorded as an append-only
 * `awcms_workflow_decisions` row with `is_administrative_override:
 * true` and a mandatory `override_reason`, never overwriting the
 * existing (possibly partial) decision history for the task.
 */
export async function forceWorkflowTaskDecision(
  tx: Bun.SQL,
  params: ForceWorkflowTaskDecisionParams
): Promise<ForceWorkflowTaskDecisionResult> {
  const tenantId = assertUuid(params.tenantId);
  const taskId = assertUuid(params.taskId);

  const task = await fetchTaskWithInstanceForDecision(tx, tenantId, taskId);

  if (!task) {
    throw new WorkflowRecoveryError("Workflow task not found.");
  }

  if (task.status !== "pending") {
    throw new WorkflowRecoveryError(
      `Only a pending task can be force-decided (current status: "${task.status}").`
    );
  }

  await tx`
    INSERT INTO awcms_workflow_decisions
      (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id,
       is_administrative_override, override_reason, reason)
    VALUES (
      ${tenantId}, ${taskId}, ${params.decision}, ${params.forcedByTenantUserId},
      true, ${params.reason}, ${params.reason}
    )
  `;

  const outcome: "approved" | "rejected" =
    params.decision === "force_approve" ? "approved" : "rejected";

  const advanceOutcome = await completeApprovalTaskAndAdvance(tx, tenantId, {
    task,
    outcome,
    actorTenantUserId: params.forcedByTenantUserId,
    now: params.now,
    correlationId: params.correlationId,
    notificationPort: params.notificationPort
  });

  return { instanceId: task.instance_id, ...advanceOutcome };
}
