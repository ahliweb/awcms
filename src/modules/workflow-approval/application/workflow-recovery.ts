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

  // `FOR UPDATE`: without it this is the one task-row writer left outside the
  // serialisation added for Issue #140 — it could read 'pending', a concurrent
  // decision could complete the task, and this would then retire seats on an
  // already-completed task.
  const taskRows = (await tx`
    SELECT status FROM awcms_workflow_tasks
    WHERE tenant_id = ${tenantId} AND id = ${taskId}
    FOR UPDATE
  `) as { status: string }[];

  if (!taskRows[0]) {
    throw new WorkflowRecoveryError("Workflow task not found.");
  }

  if (taskRows[0].status !== "pending") {
    throw new WorkflowRecoveryError(
      `Only a pending task can be reassigned (current status: "${taskRows[0].status}").`
    );
  }

  // Checked BEFORE the retirement UPDATE below, and deliberately not after it:
  // the route maps `WorkflowRecoveryError` to a 4xx from INSIDE the
  // `withTenant` callback, so returning a response COMMITS the transaction.
  // Throwing after the UPDATE would therefore retire every live seat and still
  // report failure, stranding the task with zero deciders — the very deadlock
  // Issue #140 exists to remove. Every throw here must happen before any write.
  const decidedRows = (await tx`
    SELECT 1 FROM awcms_workflow_task_assignments
    WHERE tenant_id = ${tenantId} AND workflow_task_id = ${taskId}
      AND tenant_user_id = ${params.toTenantUserId} AND status = 'decided'
  `) as unknown[];

  if (decidedRows[0]) {
    throw new WorkflowRecoveryError(
      "That user has already decided this task, so it cannot be reassigned to them."
    );
  }

  await tx`
    UPDATE awcms_workflow_task_assignments
    SET status = 'reassigned', reassigned_to_tenant_user_id = ${params.toTenantUserId},
        reassigned_at = now(), reassigned_by_tenant_user_id = ${params.reassignedByTenantUserId},
        reassign_reason = ${params.reason}
    WHERE tenant_id = ${tenantId} AND workflow_task_id = ${taskId} AND status = 'pending'
  `;

  // The UPDATE above retired every 'pending' row on this task, and a 'decided'
  // row for the target was already rejected before any write, so migration
  // 018's partial unique index (one live assignment per person per task,
  // GHSA-9qwq-cmr5-6wfc) cannot conflict here. `DO NOTHING` is kept only as a
  // belt-and-braces guard against a raw 23505 becoming a 500; it must NOT be
  // turned back into a post-write throw — see the comment on the decided-row
  // check above for why that strands the task.
  const newAssignmentRows = (await tx`
    INSERT INTO awcms_workflow_task_assignments
      (tenant_id, workflow_task_id, tenant_user_id, status)
    VALUES (${tenantId}, ${taskId}, ${params.toTenantUserId}, 'pending')
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (!newAssignmentRows[0]) {
    // Unreachable via the checked paths above. Deliberately NOT a
    // `WorkflowRecoveryError`: that maps to a 4xx returned from inside the
    // transaction callback, which commits. A plain throw propagates out of
    // `withTenant` and rolls the retirement UPDATE back, which is the only
    // safe outcome when the state is not what we proved it was.
    throw new Error(
      "Reassign could not seat the target after retiring the task's assignments."
    );
  }

  return { assignmentId: newAssignmentRows[0].id };
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
