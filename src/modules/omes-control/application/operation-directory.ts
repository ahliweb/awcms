/**
 * Read-side queries for `GET /api/v1/omes/operations` (list + detail),
 * Issue ahliweb/omes#198.
 */
import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { redactSensitiveAttributes } from "../../_shared/redaction";
import type { OperationRequestSummary } from "./operation-submission";

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
  created_at_cursor: string;
};

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

export const OPERATION_REQUEST_LIST_LIMIT = 100;

export type OperationRequestListPage = {
  operationRequests: OperationRequestSummary[];
  nextCursor: string | null;
};

export async function fetchOperationRequests(
  tx: Bun.SQL,
  tenantId: string,
  options: {
    serverId?: string;
    status?: string;
    /**
     * Issue ahliweb/omes#201 — the backups/recovery screen reuses this same
     * function (rather than a second query) to list its own `restore`
     * requests, which live in this same `awcms_omes_operation_requests`
     * table (see `application/backup-restore.ts`'s header). Optional and
     * additive: every existing caller (the Operations screen, `GET
     * /api/v1/omes/operations`) omits it and sees every operation as before.
     */
    operation?: string;
    cursor?: KeysetCursor;
  } = {}
): Promise<OperationRequestListPage> {
  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const serverIdFilter = options.serverId ?? null;
  const statusFilter = options.status ?? null;
  const operationFilter = options.operation ?? null;

  const rows = (await tx`
    SELECT id, request_id, server_id, operation, parameters, status,
           requested_by, approved_by, workflow_instance_id, created_at, updated_at,
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_omes_operation_requests
    WHERE tenant_id = ${tenantId}
      AND (${serverIdFilter}::text IS NULL OR server_id = ${serverIdFilter})
      AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
      AND (${operationFilter}::text IS NULL OR operation = ${operationFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${OPERATION_REQUEST_LIST_LIMIT}
  `) as OperationRequestRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === OPERATION_REQUEST_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { operationRequests: rows.map(toSummary), nextCursor };
}

export async function fetchOperationRequestDetail(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<OperationRequestSummary | null> {
  const rows = (await tx`
    SELECT id, request_id, server_id, operation, parameters, status,
           requested_by, approved_by, workflow_instance_id, created_at, updated_at,
           '' AS created_at_cursor
    FROM awcms_omes_operation_requests
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as OperationRequestRow[];
  const row = rows[0];

  return row ? toSummary(row) : null;
}
