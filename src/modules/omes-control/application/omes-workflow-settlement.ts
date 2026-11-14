/**
 * Applies a FINISHED approval workflow's verdict to the `omes_control` row that
 * started it (Issue ahliweb/awcms#1335, ADR-0134 pattern).
 *
 * `omes_control` starts a `workflow` instance for two request kinds (workflow
 * key `omes_control.destructive_operation` for `stop` / `rollback` / restore,
 * and `omes_control.ai_egress_approval`) and, until now, reflected only a
 * verdict that arrived SYNCHRONOUSLY (a zero-approver graph). A human decision
 * made later through the workflow inbox left the operation request `requested`
 * and the egress approval `pending` for ever, so an approved destructive
 * operation never became a job (`worker-job-queue.ts` promotes only
 * `status = 'approved'`).
 *
 * The consumer in `module.ts` (`omes_control.workflow_verdict_settler`) calls
 * these functions from the domain-event dispatcher, inside a tenant-scoped
 * transaction on the least-privilege `awcms_worker` connection (`sql/387`).
 *
 * ## What it does and does not do
 *
 *   * It only MOVES a row that is still in its pending state (`requested` /
 *     `pending`) and whose `workflow_instance_id` is the event's instance, in
 *     the event's tenant, under a row lock. Anything else is a no-op, so a
 *     replayed event is harmless and an event of another module's instance
 *     matches no row (the workflow key is therefore implicit: only the two
 *     omes tables are ever consulted).
 *   * It NEVER creates a job and never executes anything: promotion of an
 *     `approved` request stays in `worker-job-queue.ts`.
 *   * The instance's own status is the truth, not the event type.
 *
 * ## `approved_by` (operation requests)
 *
 * The column is free text and the synchronous path stores the REQUESTER there
 * (a zero-approver graph has no human). For a settlement through this consumer
 * it records the HUMAN who approved: the tenant user of the latest approving
 * decision (`approve` / `force_approve`) of the instance, as text. It is never
 * the requester. An approval that no human backs, or one the requester took
 * part in (directly or as the delegator a delegate acted for), is NOT applied:
 * the row stays pending, one `warning` audit row names the outcome, and a
 * person resolves it. A rejection or cancellation stores NULL there.
 *
 * ## Privacy
 *
 * The audit rows carry ids and the outcome only: never `parameters`,
 * `justification` or any workflow free text (`reason`, `override_reason`).
 */
import { recordAuditEvent } from "../../logging/application/audit-log";

const OMES_MODULE_KEY = "omes_control";

export type OmesSettleOutcome =
  | { outcome: "not_ours" }
  | { outcome: "already_settled" }
  | { outcome: "still_pending" }
  | { outcome: "settled"; kind: "operation_request" | "ai_egress"; to: string }
  | {
      outcome: "left_pending";
      kind: "operation_request" | "ai_egress";
      reason: "no_approver" | "self_approved";
    };

type InstanceRow = { status: string };

type DecisionRow = {
  decision: string;
  decided_by_tenant_user_id: string;
  on_behalf_of_tenant_user_id: string | null;
};

type Verdict =
  | { kind: "pending" }
  | { kind: "rejected" }
  | { kind: "approved"; approvers: DecisionRow[] };

async function readVerdict(
  tx: Bun.TransactionSQL,
  tenantId: string,
  instanceId: string
): Promise<Verdict> {
  const instances = (await tx`
    SELECT status FROM awcms_workflow_instances
    WHERE tenant_id = ${tenantId} AND id = ${instanceId}
  `) as InstanceRow[];
  const status = instances[0]?.status;

  if (status === "approved") {
    const decisions = (await tx`
      SELECT d.decision, d.decided_by_tenant_user_id,
             d.on_behalf_of_tenant_user_id
      FROM awcms_workflow_decisions d
      JOIN awcms_workflow_tasks t
        ON t.tenant_id = d.tenant_id AND t.id = d.workflow_task_id
      WHERE d.tenant_id = ${tenantId}
        AND t.workflow_instance_id = ${instanceId}
      ORDER BY d.created_at DESC, d.id DESC
    `) as DecisionRow[];

    return {
      kind: "approved",
      approvers: decisions.filter(
        (d) => d.decision === "approve" || d.decision === "force_approve"
      )
    };
  }

  // `rejected` and `cancelled` both end the request without approval.
  return status === "rejected" || status === "cancelled"
    ? { kind: "rejected" }
    : { kind: "pending" };
}

/** `null` when the approval may be applied, else why it must wait for a person. */
function refuseApproval(
  verdict: Extract<Verdict, { kind: "approved" }>,
  requester: string | null
): "no_approver" | "self_approved" | null {
  if (verdict.approvers.length === 0) {
    return "no_approver";
  }

  if (
    requester !== null &&
    verdict.approvers.some(
      (d) =>
        d.decided_by_tenant_user_id === requester ||
        d.on_behalf_of_tenant_user_id === requester
    )
  ) {
    return "self_approved";
  }

  return null;
}

async function auditLeftPending(
  tx: Bun.TransactionSQL,
  tenantId: string,
  resourceType: string,
  resourceId: string,
  instanceId: string,
  reason: string,
  correlationId: string | undefined
): Promise<void> {
  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: OMES_MODULE_KEY,
    action: "omes_control.workflow_verdict.left_pending",
    resourceType,
    resourceId,
    severity: "warning",
    message:
      "The approval workflow finished but the request was left pending for a person to resolve.",
    attributes: { workflowInstanceId: instanceId, outcome: reason },
    correlationId
  });
}

async function settleOperationRequest(
  tx: Bun.TransactionSQL,
  tenantId: string,
  instanceId: string,
  correlationId: string | undefined
): Promise<OmesSettleOutcome> {
  const rows = (await tx`
    SELECT id, status, requested_by FROM awcms_omes_operation_requests
    WHERE tenant_id = ${tenantId} AND workflow_instance_id = ${instanceId}
    FOR UPDATE
  `) as { id: string; status: string; requested_by: string | null }[];
  const row = rows[0];

  if (!row) {
    return { outcome: "not_ours" };
  }

  if (row.status !== "requested") {
    return { outcome: "already_settled" };
  }

  const verdict = await readVerdict(tx, tenantId, instanceId);

  if (verdict.kind === "pending") {
    return { outcome: "still_pending" };
  }

  let next = "rejected";
  let approvedBy: string | null = null;

  if (verdict.kind === "approved") {
    const refusal = refuseApproval(verdict, row.requested_by);

    if (refusal) {
      await auditLeftPending(
        tx,
        tenantId,
        "omes_operation_request",
        row.id,
        instanceId,
        refusal,
        correlationId
      );

      return {
        outcome: "left_pending",
        kind: "operation_request",
        reason: refusal
      };
    }

    next = "approved";
    approvedBy = verdict.approvers[0]!.decided_by_tenant_user_id;
  }

  await tx`
    UPDATE awcms_omes_operation_requests
    SET status = ${next}, approved_by = ${approvedBy}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${row.id} AND status = 'requested'
  `;
  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: OMES_MODULE_KEY,
    action: "omes_control.operation_request.settled",
    resourceType: "omes_operation_request",
    resourceId: row.id,
    severity: "warning",
    message: `The approval workflow's verdict was applied to the operation request (${next}).`,
    attributes: {
      workflowInstanceId: instanceId,
      status: next,
      trigger: "workflow_event"
    },
    correlationId
  });

  return { outcome: "settled", kind: "operation_request", to: next };
}

async function settleAiEgress(
  tx: Bun.TransactionSQL,
  tenantId: string,
  instanceId: string,
  now: Date,
  correlationId: string | undefined
): Promise<OmesSettleOutcome> {
  const rows = (await tx`
    SELECT id, decision, requested_by_tenant_user_id
    FROM awcms_omes_ai_egress_approvals
    WHERE tenant_id = ${tenantId} AND workflow_instance_id = ${instanceId}
    FOR UPDATE
  `) as {
    id: string;
    decision: string;
    requested_by_tenant_user_id: string | null;
  }[];
  const row = rows[0];

  if (!row) {
    return { outcome: "not_ours" };
  }

  if (row.decision !== "pending") {
    return { outcome: "already_settled" };
  }

  const verdict = await readVerdict(tx, tenantId, instanceId);

  if (verdict.kind === "pending") {
    return { outcome: "still_pending" };
  }

  let next = "denied";

  if (verdict.kind === "approved") {
    const refusal = refuseApproval(verdict, row.requested_by_tenant_user_id);

    if (refusal) {
      await auditLeftPending(
        tx,
        tenantId,
        "omes_ai_egress_approval",
        row.id,
        instanceId,
        refusal,
        correlationId
      );

      return { outcome: "left_pending", kind: "ai_egress", reason: refusal };
    }

    next = "approved";
  }

  await tx`
    UPDATE awcms_omes_ai_egress_approvals
    SET decision = ${next}, decided_at = ${now.toISOString()}::timestamptz,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${row.id} AND decision = 'pending'
  `;
  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: OMES_MODULE_KEY,
    action: "omes_control.ai_egress_approval.settled",
    resourceType: "omes_ai_egress_approval",
    resourceId: row.id,
    severity: "warning",
    message: `The approval workflow's verdict was applied to the AI egress approval (${next}).`,
    attributes: {
      workflowInstanceId: instanceId,
      decision: next,
      trigger: "workflow_event"
    },
    correlationId
  });

  return { outcome: "settled", kind: "ai_egress", to: next };
}

/**
 * Settle whichever `omes_control` row (operation request or AI egress approval)
 * belongs to the finished workflow instance `workflowInstanceId`, if any. Safe
 * to call for any instance of any module: one that belongs to neither matches no
 * row and does nothing.
 */
export async function settleOmesRequestForInstance(
  tx: Bun.TransactionSQL,
  tenantId: string,
  workflowInstanceId: string,
  correlationId: string | undefined,
  now: Date
): Promise<OmesSettleOutcome> {
  const operation = await settleOperationRequest(
    tx,
    tenantId,
    workflowInstanceId,
    correlationId
  );

  if (operation.outcome !== "not_ours") {
    return operation;
  }

  return settleAiEgress(tx, tenantId, workflowInstanceId, now, correlationId);
}
