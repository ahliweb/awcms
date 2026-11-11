/**
 * Reads of the follow-up queue (Issue #1165, ADR-0159): the task list (the
 * daily worklist and the overdue queue are filters of it), one task with its
 * action history and staff notifications, and a lead's stop signals. Ids,
 * staff ids, closed codes and instants only: there is nothing about the
 * prospect to mask because nothing about the prospect is stored.
 */
import type { TaskListFilter } from "../domain/crm-follow-up-validation";
import {
  TASK_COLUMNS,
  taskView,
  type TaskRow,
  type TaskView
} from "./task-engine";

type Sql = Bun.SQL;

export async function listTasks(
  tx: Sql,
  tenantId: string,
  viewer: string,
  filter: TaskListFilter,
  now: Date = new Date()
): Promise<{ items: TaskView[]; nextCursor: string | null }> {
  const assignee = filter.assignee === "me" ? viewer : filter.assignee;
  const rows = (await tx`
    SELECT ${tx.unsafe(TASK_COLUMNS)}
    FROM awcms_crm_follow_up_tasks
    WHERE tenant_id = ${tenantId}
      AND (${filter.status}::text IS NULL OR status = ${filter.status}::text)
      AND (${assignee}::uuid IS NULL OR assignee_tenant_user_id = ${assignee}::uuid)
      AND (${filter.leadId}::uuid IS NULL OR lead_id = ${filter.leadId}::uuid)
      AND (NOT ${filter.overdue}::boolean
           OR (status IN ('open', 'escalated') AND due_at < ${now}))
      AND (${filter.cursor?.dueAt ?? null}::timestamptz IS NULL
           OR (due_at, id) > (${filter.cursor?.dueAt ?? null}::timestamptz,
                              ${filter.cursor?.id ?? null}::uuid))
    ORDER BY due_at, id
    LIMIT ${filter.limit + 1}
  `) as TaskRow[];
  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];

  return {
    items: page.map((row) => taskView(row, now)),
    nextCursor:
      rows.length > filter.limit && last
        ? `${last.due_at.toISOString()}|${last.id}`
        : null
  };
}

export type TaskActionView = {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorTenantUserId: string | null;
  assigneeTenantUserId: string | null;
  reason: string | null;
  occurredAt: string;
};

export type NotificationView = {
  id: string;
  kind: string;
  recipientTenantUserId: string;
  scheduledAt: string;
  status: string;
  settleReason: string | null;
  deferrals: number;
  settledAt: string | null;
};

export async function fetchTaskDetail(
  tx: Sql,
  tenantId: string,
  taskId: string,
  now: Date = new Date()
): Promise<{
  task: TaskView;
  actions: TaskActionView[];
  notifications: NotificationView[];
} | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(TASK_COLUMNS)} FROM awcms_crm_follow_up_tasks
    WHERE tenant_id = ${tenantId} AND id = ${taskId}
  `) as TaskRow[];
  const row = rows[0];

  if (!row) return null;

  const actions = (await tx`
    SELECT id, action, from_status, to_status, actor_tenant_user_id,
           assignee_tenant_user_id, reason, occurred_at
    FROM awcms_crm_follow_up_task_actions
    WHERE tenant_id = ${tenantId} AND task_id = ${taskId}
    ORDER BY occurred_at, id
    LIMIT 500
  `) as {
    id: string;
    action: string;
    from_status: string | null;
    to_status: string;
    actor_tenant_user_id: string | null;
    assignee_tenant_user_id: string | null;
    reason: string | null;
    occurred_at: Date;
  }[];
  const notifications = (await tx`
    SELECT id, kind, recipient_tenant_user_id, scheduled_at, status,
           settle_reason, deferrals, settled_at
    FROM awcms_crm_follow_up_notifications
    WHERE tenant_id = ${tenantId} AND task_id = ${taskId}
    ORDER BY created_at, id
    LIMIT 100
  `) as {
    id: string;
    kind: string;
    recipient_tenant_user_id: string;
    scheduled_at: Date;
    status: string;
    settle_reason: string | null;
    deferrals: number;
    settled_at: Date | null;
  }[];

  return {
    task: taskView(row, now),
    actions: actions.map((a) => ({
      id: a.id,
      action: a.action,
      fromStatus: a.from_status,
      toStatus: a.to_status,
      actorTenantUserId: a.actor_tenant_user_id,
      assigneeTenantUserId: a.assignee_tenant_user_id,
      reason: a.reason,
      occurredAt: a.occurred_at.toISOString()
    })),
    notifications: notifications.map((n) => ({
      id: n.id,
      kind: n.kind,
      recipientTenantUserId: n.recipient_tenant_user_id,
      scheduledAt: n.scheduled_at.toISOString(),
      status: n.status,
      settleReason: n.settle_reason,
      deferrals: Number(n.deferrals),
      settledAt: n.settled_at?.toISOString() ?? null
    }))
  };
}

export type StopSignalView = {
  id: string;
  leadId: string;
  kind: string;
  source: string;
  sourceEventId: string | null;
  recordedBy: string | null;
  occurredAt: string;
  recordedAt: string;
};

export async function listStopSignals(
  tx: Sql,
  tenantId: string,
  leadId: string
): Promise<StopSignalView[]> {
  const rows = (await tx`
    SELECT id, lead_id, kind, source, source_event_id, recorded_by,
           occurred_at, recorded_at
    FROM awcms_crm_follow_up_stop_signals
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
    ORDER BY recorded_at, id
    LIMIT 100
  `) as {
    id: string;
    lead_id: string;
    kind: string;
    source: string;
    source_event_id: string | null;
    recorded_by: string | null;
    occurred_at: Date;
    recorded_at: Date;
  }[];

  return rows.map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    kind: row.kind,
    source: row.source,
    sourceEventId: row.source_event_id,
    recordedBy: row.recorded_by,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString()
  }));
}
