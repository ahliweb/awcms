/**
 * Consolidated admin approval inbox (Issue #747, extends `GET
 * /api/v1/workflows/tasks` from Issue 11.1). Keyset pagination (doc 16
 * §Pagination keyset, `_shared/keyset-pagination.ts`), filters
 * (workflow key, resource type, status, overdue), and a safe,
 * parameterized search — never raw string concatenation into SQL. Also
 * provides the per-instance action-history view by reusing EXISTING
 * infrastructure (`awcms_workflow_decisions` +
 * `awcms_audit_events`) rather than a new dedicated history table.
 */
import { assertUuid } from "../../../lib/database/tenant-context";
import { encodeKeysetCursor } from "../../_shared/keyset-pagination";

export type WorkflowTaskListFilters = {
  workflowKey?: string;
  resourceType?: string;
  status?: "pending" | "completed" | "skipped" | "cancelled";
  overdueOnly?: boolean;
  /** Free-text search over resourceId/workflowKey/definition name — wildcard characters are escaped before being embedded in an ILIKE pattern (never raw string concatenation). */
  search?: string;
};

export type WorkflowTaskListItem = {
  id: string;
  nodeId: string;
  status: string;
  quorumRule: string;
  dueAt: string | null;
  createdAt: Date;
  instanceId: string;
  resourceType: string;
  resourceId: string;
  requestedByTenantUserId: string;
  workflowDefinitionId: string;
  workflowKey: string;
  workflowName: string;
  overdue: boolean;
};

const TASK_LIST_LIMIT = 100;

/** Escapes ILIKE wildcard/escape characters so a search term is matched LITERALLY except for the leading/trailing `%` this function itself adds — never interpreted as attacker-controlled wildcards. */
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export type WorkflowTaskListResult = {
  tasks: WorkflowTaskListItem[];
  nextCursor: string | null;
};

export async function listWorkflowInboxTasks(
  tx: Bun.SQL,
  tenantId: string,
  filters: WorkflowTaskListFilters,
  now: Date,
  cursor: { createdAt: Date; id: string } | null
): Promise<WorkflowTaskListResult> {
  const safeTenantId = assertUuid(tenantId);
  const statusFilter = filters.status ?? "pending";
  const searchPattern = filters.search
    ? `%${escapeLikePattern(filters.search)}%`
    : null;
  const cursorCreatedAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;

  type Row = {
    id: string;
    node_id: string;
    status: string;
    quorum_rule: string;
    due_at: Date | null;
    created_at: Date;
    instance_id: string;
    resource_type: string;
    resource_id: string;
    requested_by_tenant_user_id: string;
    definition_id: string;
    workflow_key: string;
    definition_name: string;
  };

  const rows = (await tx`
    SELECT t.id, t.node_id, t.status, t.quorum_rule, t.due_at, t.created_at,
           i.id AS instance_id, i.resource_type, i.resource_id,
           i.requested_by_tenant_user_id,
           d.id AS definition_id, d.workflow_key, d.name AS definition_name
    FROM awcms_workflow_tasks t
    JOIN awcms_workflow_instances i ON i.id = t.workflow_instance_id
    JOIN awcms_workflow_definitions d ON d.id = i.workflow_definition_id
    WHERE t.tenant_id = ${safeTenantId}
      AND t.status = ${statusFilter}
      AND (${filters.workflowKey ?? null}::text IS NULL OR d.workflow_key = ${filters.workflowKey ?? null})
      AND (${filters.resourceType ?? null}::text IS NULL OR i.resource_type = ${filters.resourceType ?? null})
      AND (${filters.overdueOnly ?? false} = false OR (t.due_at IS NOT NULL AND t.due_at <= ${now}))
      AND (
        ${searchPattern}::text IS NULL
        OR i.resource_id ILIKE ${searchPattern} ESCAPE '\\'
        OR d.workflow_key ILIKE ${searchPattern} ESCAPE '\\'
        OR d.name ILIKE ${searchPattern} ESCAPE '\\'
      )
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (t.created_at, t.id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${TASK_LIST_LIMIT}
  `) as Row[];

  const nextCursor =
    rows.length === TASK_LIST_LIMIT
      ? encodeKeysetCursor(
          rows[rows.length - 1]!.created_at,
          rows[rows.length - 1]!.id
        )
      : null;

  return {
    tasks: rows.map((row) => ({
      id: row.id,
      nodeId: row.node_id,
      status: row.status,
      quorumRule: row.quorum_rule,
      dueAt: row.due_at ? row.due_at.toISOString() : null,
      createdAt: row.created_at,
      instanceId: row.instance_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      requestedByTenantUserId: row.requested_by_tenant_user_id,
      workflowDefinitionId: row.definition_id,
      workflowKey: row.workflow_key,
      workflowName: row.definition_name,
      overdue: Boolean(row.due_at && row.due_at.getTime() <= now.getTime())
    })),
    nextCursor
  };
}

export type WorkflowInstanceHistoryEntry = {
  kind: "decision" | "audit";
  createdAt: Date;
  actorTenantUserId: string | null;
  action: string;
  detail: Record<string, unknown>;
};

const HISTORY_LIMIT = 200;

/** Unions `awcms_workflow_decisions` (this instance's tasks) with `awcms_audit_events` (resourceType `workflow_instance`, this id) — reuse, not a new history mechanism. */
export async function listWorkflowInstanceHistory(
  tx: Bun.SQL,
  tenantId: string,
  instanceId: string
): Promise<WorkflowInstanceHistoryEntry[]> {
  const safeTenantId = assertUuid(tenantId);
  const safeInstanceId = assertUuid(instanceId);

  type DecisionRow = {
    decision: string;
    decided_by_tenant_user_id: string;
    on_behalf_of_tenant_user_id: string | null;
    is_administrative_override: boolean;
    reason: string | null;
    override_reason: string | null;
    created_at: Date;
    node_id: string;
  };

  const decisionRows = (await tx`
    SELECT dec.decision, dec.decided_by_tenant_user_id, dec.on_behalf_of_tenant_user_id,
           dec.is_administrative_override, dec.reason, dec.override_reason,
           dec.created_at, t.node_id
    FROM awcms_workflow_decisions dec
    JOIN awcms_workflow_tasks t ON t.id = dec.workflow_task_id
    WHERE dec.tenant_id = ${safeTenantId} AND t.workflow_instance_id = ${safeInstanceId}
    ORDER BY dec.created_at DESC
    LIMIT ${HISTORY_LIMIT}
  `) as DecisionRow[];

  type AuditRow = {
    actor_tenant_user_id: string | null;
    action: string;
    message: string;
    attributes: unknown;
    created_at: Date;
  };

  const auditRows = (await tx`
    SELECT actor_tenant_user_id, action, message, attributes, created_at
    FROM awcms_audit_events
    WHERE tenant_id = ${safeTenantId} AND resource_type = 'workflow_instance'
      AND resource_id = ${safeInstanceId}
    ORDER BY created_at DESC
    LIMIT ${HISTORY_LIMIT}
  `) as AuditRow[];

  const entries: WorkflowInstanceHistoryEntry[] = [
    ...decisionRows.map((row): WorkflowInstanceHistoryEntry => ({
      kind: "decision",
      createdAt: row.created_at,
      actorTenantUserId: row.decided_by_tenant_user_id,
      action: row.decision,
      detail: {
        nodeId: row.node_id,
        onBehalfOfTenantUserId: row.on_behalf_of_tenant_user_id ?? undefined,
        isAdministrativeOverride: row.is_administrative_override,
        reason: row.reason ?? row.override_reason ?? undefined
      }
    })),
    ...auditRows.map((row): WorkflowInstanceHistoryEntry => ({
      kind: "audit",
      createdAt: row.created_at,
      actorTenantUserId: row.actor_tenant_user_id,
      action: row.action,
      detail: (row.attributes as Record<string, unknown>) ?? {}
    }))
  ];

  entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return entries.slice(0, HISTORY_LIMIT);
}
