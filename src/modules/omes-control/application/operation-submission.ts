/**
 * `POST /api/v1/omes/operations` write path, Issue ahliweb/omes#198.
 *
 * Creates an `awcms_omes_operation_requests` row for an allowlisted
 * operation and, for the destructive subset, routes the request through the
 * canonical `workflow-approval` engine (module key `workflow`) instead of
 * marking it approved. This module NEVER executes anything — it records
 * intent; dispatch to a host happens exclusively through the OMES pull
 * worker (ahliweb/omes#199, out of scope here), which reads `status =
 * 'approved'` rows.
 */
import {
  startWorkflowInstance,
  WorkflowDefinitionNotActiveError
} from "../../workflow-approval/application/workflow-instance";
import { redactSensitiveAttributes } from "../../_shared/redaction";
import {
  isDestructiveOmesOperation,
  OMES_DESTRUCTIVE_WORKFLOW_KEY,
  type OperationSubmissionInput
} from "../domain/operations";

export type OperationRequestSummary = {
  id: string;
  requestId: string;
  serverId: string;
  operation: string;
  parameters: unknown;
  status: string;
  requestedBy: string | null;
  approvedBy: string | null;
  workflowInstanceId: string | null;
  createdAt: string;
  updatedAt: string;
};

type OperationRequestRow = {
  id: string;
  request_id: string;
  server_id: string;
  operation: string;
  parameters: Record<string, unknown>;
  status: string;
  requested_by: string | null;
  approved_by: string | null;
  workflow_instance_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const OPERATION_REQUEST_RETURNING = `
  id, request_id, server_id, operation, parameters, status, requested_by,
  approved_by, workflow_instance_id, created_at, updated_at
`;

function toSummary(row: OperationRequestRow): OperationRequestSummary {
  return {
    id: row.id,
    requestId: row.request_id,
    serverId: row.server_id,
    operation: row.operation,
    parameters: redactSensitiveAttributes(row.parameters) ?? {},
    status: row.status,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    workflowInstanceId: row.workflow_instance_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export type SubmitOmesOperationOutcome =
  | { outcome: "created"; operationRequest: OperationRequestSummary }
  | { outcome: "approval_workflow_not_configured" };

/**
 * For a destructive operation, an active PUBLISHED `awcms_workflow_definitions`
 * row under {@link OMES_DESTRUCTIVE_WORKFLOW_KEY} must already exist for this
 * tenant (authored via the existing `/admin/approvals` + workflow-definition
 * API — never created implicitly here). No such row -> the request is
 * refused outright and NOTHING is persisted; there is no silent fallback to
 * auto-approval or direct execution.
 */
export async function hasActiveDestructiveWorkflowDefinition(
  tx: Bun.SQL,
  tenantId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 FROM awcms_workflow_definitions
    WHERE tenant_id = ${tenantId}
      AND workflow_key = ${OMES_DESTRUCTIVE_WORKFLOW_KEY}
      AND lifecycle_status = 'active'
      AND deleted_at IS NULL
    LIMIT 1
  `) as unknown[];

  return rows.length > 0;
}

export async function submitOmesOperation(
  tx: Bun.SQL,
  tenantId: string,
  requestedByTenantUserId: string,
  input: OperationSubmissionInput,
  now: Date,
  correlationId?: string
): Promise<SubmitOmesOperationOutcome> {
  const destructive = isDestructiveOmesOperation(input.operation);

  if (destructive && !(await hasActiveDestructiveWorkflowDefinition(tx, tenantId))) {
    return { outcome: "approval_workflow_not_configured" };
  }

  const requestId = crypto.randomUUID();
  const parametersJson = JSON.stringify(input.parameters ?? {});

  const insertedRows = (await tx`
    INSERT INTO awcms_omes_operation_requests
      (tenant_id, request_id, server_id, operation, parameters, status, requested_by)
    VALUES (
      ${tenantId}, ${requestId}, ${input.serverId}, ${input.operation},
      ${parametersJson}::jsonb, 'requested', ${requestedByTenantUserId}
    )
    RETURNING ${tx.unsafe(OPERATION_REQUEST_RETURNING)}
  `) as OperationRequestRow[];
  const inserted = insertedRows[0]!;

  if (!destructive) {
    // Safe operation: no human approval gate required by this issue's scope.
    // "Approved" here means "AWCMS raised no objection" — it still is NOT
    // dispatched by this endpoint; ahliweb/omes#199's pull worker is the only
    // reader that turns an `approved` row into host execution.
    const approvedRows = (await tx`
      UPDATE awcms_omes_operation_requests
      SET status = 'approved', approved_by = ${requestedByTenantUserId}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${inserted.id}
      RETURNING ${tx.unsafe(OPERATION_REQUEST_RETURNING)}
    `) as OperationRequestRow[];

    return { outcome: "created", operationRequest: toSummary(approvedRows[0]!) };
  }

  try {
    const workflow = await startWorkflowInstance(tx, {
      tenantId,
      workflowKey: OMES_DESTRUCTIVE_WORKFLOW_KEY,
      resourceType: "omes_operation_request",
      resourceId: inserted.id,
      requestedByTenantUserId,
      facts: {
        operation: input.operation,
        serverId: input.serverId,
        deploymentId: input.deploymentId ?? null
      },
      now,
      correlationId
    });

    // A workflow that resolves synchronously (e.g. zero required approvers)
    // is reflected immediately; otherwise the row stays 'requested' —
    // NEVER auto-approved — until a human decides via the pre-existing
    // /workflows/tasks/{id}/decisions endpoint.
    const nextStatus = workflow.finished
      ? workflow.status === "approved"
        ? "approved"
        : "rejected"
      : "requested";

    const linkedRows = (await tx`
      UPDATE awcms_omes_operation_requests
      SET workflow_instance_id = ${workflow.instanceId},
          status = ${nextStatus},
          approved_by = ${nextStatus === "approved" ? requestedByTenantUserId : null},
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${inserted.id}
      RETURNING ${tx.unsafe(OPERATION_REQUEST_RETURNING)}
    `) as OperationRequestRow[];

    return { outcome: "created", operationRequest: toSummary(linkedRows[0]!) };
  } catch (error) {
    if (error instanceof WorkflowDefinitionNotActiveError) {
      // Definition was retired between the pre-check and this call (race) —
      // same refusal as the pre-check, and the row inserted above is left in
      // 'requested' with no workflow link; the caller sees the same refusal
      // either way and the row is still visible/auditable via GET
      // /omes/operations for an operator to clean up.
      return { outcome: "approval_workflow_not_configured" };
    }
    throw error;
  }
}
