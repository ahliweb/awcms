/**
 * `POST /api/v1/omes/backups/{id}/restore` (Issue ahliweb/omes#198) —
 * guarded by `omes_control.backups.restore`.
 *
 * `restore` is deliberately EXCLUDED from the AWCMS-facing safe-operation
 * enum in `domain/operations.ts` — that enum is kept byte-for-byte
 * identical to the OMES-owned `operation-request.schema.json`'s `operation`
 * enum, whose own description states `install`/`configure`/`restore` are
 * "for direct job-runner use only". This function therefore does NOT reuse
 * `submitOmesOperation`/`OMES_OPERATION_CODES` — restoring from a backup is
 * its own, always-destructive intent, recorded the same way (an
 * `awcms_omes_operation_requests` row, gated by the SAME canonical
 * `workflow-approval` engine — never a second approval authority) but
 * validated by its own rules rather than being smuggled into the safe-op
 * allowlist.
 *
 * Recording this intent does not imply a wire path to OMES accepts it yet:
 * whether/how `ahliweb/omes#199`'s pull worker ever forwards an `approved`
 * `restore` row is that issue's decision, not this one's — this module only
 * ever records what AWCMS itself approved.
 */
import {
  startWorkflowInstance,
  WorkflowDefinitionNotActiveError
} from "../../workflow-approval/application/workflow-instance";
import { redactSensitiveAttributes } from "../../_shared/redaction";
import {
  hasActiveDestructiveWorkflowDefinition,
  type OperationRequestSummary
} from "./operation-submission";
import { OMES_DESTRUCTIVE_WORKFLOW_KEY } from "../domain/operations";

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

export type BackupRestoreOutcome =
  | { outcome: "created"; operationRequest: OperationRequestSummary }
  | { outcome: "approval_workflow_not_configured" }
  | { outcome: "backup_not_found" };

export async function submitBackupRestore(
  tx: Bun.SQL,
  tenantId: string,
  requestedByTenantUserId: string,
  backupId: string,
  now: Date,
  correlationId?: string
): Promise<BackupRestoreOutcome> {
  const backupRows = (await tx`
    SELECT server_id FROM awcms_omes_backup_snapshots
    WHERE tenant_id = ${tenantId} AND id = ${backupId}
  `) as { server_id: string }[];
  const backup = backupRows[0];

  if (!backup) {
    return { outcome: "backup_not_found" };
  }

  if (!(await hasActiveDestructiveWorkflowDefinition(tx, tenantId))) {
    return { outcome: "approval_workflow_not_configured" };
  }

  const requestId = crypto.randomUUID();

  const insertedRows = (await tx`
    INSERT INTO awcms_omes_operation_requests
      (tenant_id, request_id, server_id, operation, parameters, status, requested_by)
    VALUES (
      ${tenantId}, ${requestId}, ${backup.server_id}, 'restore',
      ${{ backupId }}::jsonb, 'requested', ${requestedByTenantUserId}
    )
    RETURNING ${tx.unsafe(OPERATION_REQUEST_RETURNING)}
  `) as OperationRequestRow[];
  const inserted = insertedRows[0]!;

  try {
    const workflow = await startWorkflowInstance(tx, {
      tenantId,
      workflowKey: OMES_DESTRUCTIVE_WORKFLOW_KEY,
      resourceType: "omes_operation_request",
      resourceId: inserted.id,
      requestedByTenantUserId,
      facts: { operation: "restore", serverId: backup.server_id, backupId },
      now,
      correlationId
    });

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
      return { outcome: "approval_workflow_not_configured" };
    }
    throw error;
  }
}
