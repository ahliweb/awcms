/**
 * Creating, stopping, reassigning and closing follow-up tasks (Issue #1165,
 * ADR-0159 sections 4 and 5). Every function runs in the CALLER's tenant
 * transaction (FORCE RLS applies); none calls a provider.
 *
 * ## The per-lead lock: why a stop always wins
 *
 * Task creation, stop recording, reassignment and notification dispatch all
 * take the same transaction-scoped advisory lock keyed on (tenant, lead)
 * before they read anything about the lead. So they serialise: whichever runs
 * second sees what the first committed. A trigger arriving after a stop finds
 * the stop and creates nothing; a stop arriving after a trigger cancels the
 * task it created. sql/369's insert trigger refuses a task for a stopped lead
 * even if a future caller forgets the lock.
 *
 * ## Idempotency
 *
 * A task is unique on (tenant, rule, source event): a redelivered event hits
 * `ON CONFLICT DO NOTHING` and creates nothing. A notification is unique on
 * (task, kind, recipient). A lead-event stop is unique on (source event, kind).
 */
import { log } from "../../../lib/logging/logger";
import {
  CRM_FOLLOW_UP_MODULE_KEY,
  LIVE_TASK_STATUSES,
  type NotificationKind,
  type StopKind,
  type TaskOutcome,
  type TaskStatus,
  type TriggerKind
} from "../domain/crm-follow-up-constants";
import {
  calendarOf,
  definitionFromRow,
  matchesTrigger,
  planTask,
  type RevisionRow,
  type RuleDefinition,
  type TriggerFacts
} from "../domain/rule-definition";
import { nextWorkingInstant } from "../domain/working-calendar";
import { fetchActiveRevisionsForTrigger } from "./rule-directory";

type Sql = Bun.SQL;

/** Serialises everything that concerns one lead (see the file header). */
export async function lockLead(
  tx: Sql,
  tenantId: string,
  leadId: string
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`crm_follow_up:lead:${tenantId}:${leadId}`}, 0)
    )
  `;
}

export async function leadHasStopSignal(
  tx: Sql,
  tenantId: string,
  leadId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_crm_follow_up_stop_signals
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
    LIMIT 1
  `) as { present: number }[];

  return rows.length > 0;
}

/** True only for an ACTIVE user of this tenant. A revoked assignee is never one. */
export async function isActiveTenantUser(
  tx: Sql,
  tenantId: string,
  tenantUserId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT id FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND id = ${tenantUserId}
      AND status = 'active'
  `) as { id: string }[];

  return rows.length > 0;
}

async function countLiveTasks(
  tx: Sql,
  tenantId: string,
  leadId: string,
  ruleId: string
): Promise<number> {
  const rows = (await tx`
    SELECT count(*)::int AS n FROM awcms_crm_follow_up_tasks
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
      AND rule_id = ${ruleId} AND status IN ('open', 'escalated')
  `) as { n: number }[];

  return Number(rows[0]?.n ?? 0);
}

async function appendAction(
  tx: Sql,
  tenantId: string,
  input: {
    taskId: string;
    action: "created" | "reassigned" | "escalated" | "completed" | "cancelled";
    fromStatus: TaskStatus | null;
    toStatus: TaskStatus;
    actor: string | null;
    assignee: string | null;
    reason: string | null;
  }
): Promise<void> {
  await tx`
    INSERT INTO awcms_crm_follow_up_task_actions
      (tenant_id, task_id, action, from_status, to_status,
       actor_tenant_user_id, assignee_tenant_user_id, reason)
    VALUES (${tenantId}, ${input.taskId}, ${input.action}, ${input.fromStatus},
            ${input.toStatus}, ${input.actor}, ${input.assignee}, ${input.reason})
  `;
}

/** One notification intent; a duplicate (task, kind, recipient) is a no-op. */
export async function scheduleNotification(
  tx: Sql,
  tenantId: string,
  input: {
    taskId: string;
    kind: NotificationKind;
    recipient: string;
    scheduledAt: Date;
  }
): Promise<void> {
  await tx`
    INSERT INTO awcms_crm_follow_up_notifications
      (tenant_id, task_id, kind, recipient_tenant_user_id, scheduled_at)
    VALUES (${tenantId}, ${input.taskId}, ${input.kind}, ${input.recipient},
            ${input.scheduledAt})
    ON CONFLICT (tenant_id, task_id, kind, recipient_tenant_user_id) DO NOTHING
  `;
}

/**
 * The next working instant, or `from` itself when the calendar has no working
 * time ahead (audit of PR #1266, MEDIUM-1): scheduling never throws; the
 * dispatcher then finds the notice outside working time and suppresses it.
 */
export function nextWorkingInstantOr(
  calendar: ReturnType<typeof calendarOf>,
  from: Date
): Date {
  try {
    return nextWorkingInstant(calendar, from);
  } catch (error) {
    if (error instanceof RangeError) return from;
    throw error;
  }
}

/** The assignee's notices a definition asks for, in working time. */
async function scheduleAssigneeNotices(
  tx: Sql,
  tenantId: string,
  taskId: string,
  definition: RuleDefinition,
  assignee: string,
  dueAt: Date,
  now: Date
): Promise<void> {
  const calendar = calendarOf(definition);

  if (definition.notify.onAssign) {
    await scheduleNotification(tx, tenantId, {
      taskId,
      kind: "assigned",
      recipient: assignee,
      scheduledAt: nextWorkingInstantOr(calendar, now)
    });
  }

  if (definition.notify.onDue) {
    await scheduleNotification(tx, tenantId, {
      taskId,
      kind: "due",
      recipient: assignee,
      scheduledAt: nextWorkingInstantOr(
        calendar,
        dueAt.getTime() > now.getTime() ? dueAt : now
      )
    });
  }
}

export type TriggerOutcome = {
  stopped: boolean;
  created: string[];
  skipped: {
    ruleId: string;
    reason: "not_matched" | "capped" | "duplicate" | "failed";
  }[];
};

/**
 * Creates the tasks every ACTIVE rule's current revision owes for one lead
 * event. The caller has already decided the module is active for the tenant.
 */
export async function createTasksForTrigger(
  tx: Bun.TransactionSQL,
  tenantId: string,
  facts: TriggerFacts,
  sourceEventId: string,
  now: Date = new Date()
): Promise<TriggerOutcome> {
  await lockLead(tx, tenantId, facts.leadId);

  if (await leadHasStopSignal(tx, tenantId, facts.leadId)) {
    return { stopped: true, created: [], skipped: [] };
  }

  const revisions = await fetchActiveRevisionsForTrigger(
    tx,
    tenantId,
    facts.kind
  );
  const outcome: TriggerOutcome = { stopped: false, created: [], skipped: [] };

  for (const revision of revisions) {
    if (!matchesTrigger(revision.definition, facts)) {
      outcome.skipped.push({ ruleId: revision.ruleId, reason: "not_matched" });
      continue;
    }

    // Each rule in its own savepoint (audit of PR #1266, MEDIUM-1): a rule
    // that cannot be planned (a calendar with no working time ahead) or whose
    // write fails is skipped and logged, and never fails the other rules or
    // dead-letters the delivery.
    try {
      const result = await tx.savepoint((savepoint) =>
        createTaskForRule(
          savepoint as unknown as Bun.SQL,
          tenantId,
          facts,
          sourceEventId,
          revision,
          now
        )
      );

      if (result.taskId) {
        outcome.created.push(result.taskId);
      } else {
        outcome.skipped.push({ ruleId: revision.ruleId, reason: result.reason! });
      }
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;

      log("warning", "crm_follow_up.rule_trigger_failed", {
        tenantId,
        moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
        ruleId: revision.ruleId,
        errorClass:
          error instanceof Error ? error.constructor.name : typeof error,
        ...(typeof code === "string" ? { errorCode: code } : {})
      });
      outcome.skipped.push({ ruleId: revision.ruleId, reason: "failed" });
    }
  }

  return outcome;
}

async function createTaskForRule(
  tx: Sql,
  tenantId: string,
  facts: TriggerFacts,
  sourceEventId: string,
  revision: { ruleId: string; revisionId: string; definition: RuleDefinition },
  now: Date
): Promise<
  { taskId: string; reason?: never } | { taskId: null; reason: "capped" | "duplicate" }
> {
  if (
    (await countLiveTasks(tx, tenantId, facts.leadId, revision.ruleId)) >=
    revision.definition.maxOpenPerLead
  ) {
    return { taskId: null, reason: "capped" };
  }

  const plan = planTask(revision.definition, facts);
  const candidate = plan.assigneeTenantUserId;
  const assignee =
    candidate !== null && (await isActiveTenantUser(tx, tenantId, candidate))
      ? candidate
      : null;
  const inserted = (await tx`
    INSERT INTO awcms_crm_follow_up_tasks
      (tenant_id, lead_id, rule_id, rule_revision_id, source_event_id,
       trigger_kind, title, assignee_mode, assignee_tenant_user_id, due_at,
       escalate_at)
    VALUES (${tenantId}, ${facts.leadId}, ${revision.ruleId},
            ${revision.revisionId}, ${sourceEventId}, ${facts.kind},
            ${revision.definition.taskTitle},
            ${revision.definition.assignee.mode}, ${assignee}, ${plan.dueAt},
            ${plan.escalateAt})
    ON CONFLICT (tenant_id, rule_id, source_event_id) DO NOTHING
    RETURNING id
  `) as { id: string }[];
  const taskId = inserted[0]?.id;

  if (!taskId) return { taskId: null, reason: "duplicate" };

  await appendAction(tx, tenantId, {
    taskId,
    action: "created",
    fromStatus: null,
    toStatus: "open",
    actor: null,
    assignee,
    reason:
      candidate !== null && assignee === null
        ? "assignee_inactive"
        : "rule_trigger"
  });

  if (assignee !== null) {
    await scheduleAssigneeNotices(
      tx,
      tenantId,
      taskId,
      revision.definition,
      assignee,
      plan.dueAt,
      now
    );
  }

  return { taskId };
}

async function cancelPendingNotifications(
  tx: Sql,
  tenantId: string,
  taskIds: string[],
  reason: "task_closed" | "lead_stopped"
): Promise<number> {
  if (taskIds.length === 0) return 0;

  const rows = (await tx`
    UPDATE awcms_crm_follow_up_notifications
    SET status = 'cancelled', settle_reason = ${reason}, settled_at = now()
    WHERE tenant_id = ${tenantId}
      AND task_id = ANY(${tx.array(taskIds, "uuid")})
      AND status = 'pending'
    RETURNING id
  `) as { id: string }[];

  return rows.length;
}

export type StopInput = {
  leadId: string;
  kind: StopKind;
  source: "lead_event" | "staff";
  sourceEventId: string | null;
  recordedBy: string | null;
  occurredAt: Date;
};

export type StopOutcome = {
  signalId: string | null;
  /**
   * Nothing changed: a lead-event stop already recorded for the same event, or
   * a staff stop of the same kind already recorded for the lead (at most one
   * per (lead, kind); a stop is permanent, so a second one adds nothing).
   */
  replayed: boolean;
  cancelledTaskIds: string[];
  cancelledNotifications: number;
  /**
   * Notices of the cancelled tasks that were ALREADY handed to the e-mail
   * outbox before the stop: reported, never claimed to be recalled.
   */
  alreadyEnqueuedNotifications: number;
};

/**
 * Records a stop signal and cancels the lead's live tasks and their pending
 * notices, under the per-lead lock.
 */
export async function recordStopSignal(
  tx: Sql,
  tenantId: string,
  input: StopInput
): Promise<StopOutcome> {
  await lockLead(tx, tenantId, input.leadId);

  const inserted = (
    input.sourceEventId !== null
      ? await tx`
          INSERT INTO awcms_crm_follow_up_stop_signals
            (tenant_id, lead_id, kind, source, source_event_id, recorded_by,
             occurred_at)
          VALUES (${tenantId}, ${input.leadId}, ${input.kind}, ${input.source},
                  ${input.sourceEventId}, ${input.recordedBy}, ${input.occurredAt})
          ON CONFLICT (tenant_id, source_event_id, kind)
            WHERE source_event_id IS NOT NULL
            DO NOTHING
          RETURNING id`
      : await tx`
          INSERT INTO awcms_crm_follow_up_stop_signals
            (tenant_id, lead_id, kind, source, source_event_id, recorded_by,
             occurred_at)
          VALUES (${tenantId}, ${input.leadId}, ${input.kind}, ${input.source},
                  NULL, ${input.recordedBy}, ${input.occurredAt})
          ON CONFLICT (tenant_id, lead_id, kind) WHERE source = 'staff'
            DO NOTHING
          RETURNING id`
  ) as { id: string }[];
  const signalId = inserted[0]?.id ?? null;

  if (signalId === null) {
    return {
      signalId: null,
      replayed: true,
      cancelledTaskIds: [],
      cancelledNotifications: 0,
      alreadyEnqueuedNotifications: 0
    };
  }

  const live = (await tx`
    SELECT id, status FROM awcms_crm_follow_up_tasks
    WHERE tenant_id = ${tenantId} AND lead_id = ${input.leadId}
      AND status IN ('open', 'escalated')
    ORDER BY created_at, id
    FOR UPDATE
  `) as { id: string; status: TaskStatus }[];
  const reason = `stop_${input.kind}`;

  for (const task of live) {
    await tx`
      UPDATE awcms_crm_follow_up_tasks
      SET status = 'cancelled', cancel_reason = ${reason}, closed_at = now(),
          closed_by = ${input.recordedBy}, version = version + 1,
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${task.id}
    `;
    await appendAction(tx, tenantId, {
      taskId: task.id,
      action: "cancelled",
      fromStatus: task.status,
      toStatus: "cancelled",
      actor: input.recordedBy,
      assignee: null,
      reason
    });
  }

  const taskIds = live.map((task) => task.id);
  const cancelledNotifications = await cancelPendingNotifications(
    tx,
    tenantId,
    taskIds,
    "lead_stopped"
  );
  const enqueued =
    taskIds.length === 0
      ? []
      : ((await tx`
          SELECT count(*)::int AS n FROM awcms_crm_follow_up_notifications
          WHERE tenant_id = ${tenantId}
            AND task_id = ANY(${tx.array(taskIds, "uuid")})
            AND status = 'enqueued'
        `) as { n: number }[]);

  return {
    signalId,
    replayed: false,
    cancelledTaskIds: taskIds,
    cancelledNotifications,
    alreadyEnqueuedNotifications: Number(enqueued[0]?.n ?? 0)
  };
}

type RevisionRowWithId = RevisionRow & { id: string };

async function fetchRevisionDefinition(
  tx: Sql,
  tenantId: string,
  revisionId: string
): Promise<RuleDefinition | null> {
  const rows = (await tx`
    SELECT id, trigger_kind, pipeline_id, stage_category, stage_key, task_title,
           due_after_minutes, escalate_after_minutes, escalation_tenant_user_id,
           assignee_mode, fixed_assignee_tenant_user_id, notify_on_assign,
           notify_on_due, max_open_per_lead, time_zone, working_days,
           work_start_minute, work_end_minute, holidays
    FROM awcms_crm_follow_up_rule_revisions
    WHERE tenant_id = ${tenantId} AND id = ${revisionId}
  `) as RevisionRowWithId[];

  return rows[0] ? definitionFromRow(rows[0]) : null;
}

/**
 * `lead.assigned`: the live `lead_owner` tasks of the lead follow the new
 * owner (an inactive new owner leaves them unassigned); the previous
 * assignee's pending notices are cancelled and the new one's are scheduled.
 */
export async function reassignLeadOwnerTasks(
  tx: Sql,
  tenantId: string,
  leadId: string,
  newOwner: string | null,
  now: Date = new Date()
): Promise<string[]> {
  await lockLead(tx, tenantId, leadId);

  const assignee =
    newOwner !== null && (await isActiveTenantUser(tx, tenantId, newOwner))
      ? newOwner
      : null;
  const tasks = (await tx`
    SELECT id, status, assignee_tenant_user_id, rule_revision_id, due_at
    FROM awcms_crm_follow_up_tasks
    WHERE tenant_id = ${tenantId} AND lead_id = ${leadId}
      AND status IN ('open', 'escalated') AND assignee_mode = 'lead_owner'
    ORDER BY created_at, id
    FOR UPDATE
  `) as {
    id: string;
    status: TaskStatus;
    assignee_tenant_user_id: string | null;
    rule_revision_id: string;
    due_at: Date;
  }[];
  const changed: string[] = [];

  for (const task of tasks) {
    if (task.assignee_tenant_user_id === assignee) continue;

    await tx`
      UPDATE awcms_crm_follow_up_tasks
      SET assignee_tenant_user_id = ${assignee}, version = version + 1,
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${task.id}
    `;
    await appendAction(tx, tenantId, {
      taskId: task.id,
      action: "reassigned",
      fromStatus: task.status,
      toStatus: task.status,
      actor: null,
      assignee,
      reason:
        newOwner !== null && assignee === null
          ? "assignee_inactive"
          : "lead_owner_changed"
    });

    if (task.assignee_tenant_user_id !== null) {
      await tx`
        UPDATE awcms_crm_follow_up_notifications
        SET status = 'cancelled', settle_reason = 'recipient_changed',
            settled_at = now()
        WHERE tenant_id = ${tenantId} AND task_id = ${task.id}
          AND recipient_tenant_user_id = ${task.assignee_tenant_user_id}
          AND status = 'pending'
      `;
    }

    if (assignee !== null && task.status === "open") {
      const definition = await fetchRevisionDefinition(
        tx,
        tenantId,
        task.rule_revision_id
      );

      if (definition) {
        await scheduleAssigneeNotices(
          tx,
          tenantId,
          task.id,
          definition,
          assignee,
          task.due_at,
          now
        );
      }
    }

    changed.push(task.id);
  }

  return changed;
}

export type TaskView = {
  id: string;
  leadId: string;
  ruleId: string;
  ruleRevisionId: string;
  triggerKind: TriggerKind;
  title: string;
  status: TaskStatus;
  overdue: boolean;
  assigneeMode: "lead_owner" | "fixed_user";
  assigneeTenantUserId: string | null;
  dueAt: string;
  escalateAt: string | null;
  escalatedAt: string | null;
  outcome: TaskOutcome | null;
  cancelReason: string | null;
  closedAt: string | null;
  closedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TaskRow = {
  id: string;
  lead_id: string;
  rule_id: string;
  rule_revision_id: string;
  trigger_kind: TriggerKind;
  title: string;
  status: TaskStatus;
  assignee_mode: "lead_owner" | "fixed_user";
  assignee_tenant_user_id: string | null;
  due_at: Date;
  escalate_at: Date | null;
  escalated_at: Date | null;
  outcome: TaskOutcome | null;
  cancel_reason: string | null;
  closed_at: Date | null;
  closed_by: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

/** Every column `TaskRow` reads, spelled out (a fixed string, never input). */
export const TASK_COLUMNS = `id, lead_id, rule_id, rule_revision_id, trigger_kind, title,
  status, assignee_mode, assignee_tenant_user_id, due_at, escalate_at,
  escalated_at, outcome, cancel_reason, closed_at, closed_by, version,
  created_at, updated_at`;

export function taskView(row: TaskRow, now: Date = new Date()): TaskView {
  return {
    id: row.id,
    leadId: row.lead_id,
    ruleId: row.rule_id,
    ruleRevisionId: row.rule_revision_id,
    triggerKind: row.trigger_kind,
    title: row.title,
    status: row.status,
    overdue:
      LIVE_TASK_STATUSES.includes(row.status) &&
      row.due_at.getTime() < now.getTime(),
    assigneeMode: row.assignee_mode,
    assigneeTenantUserId: row.assignee_tenant_user_id,
    dueAt: row.due_at.toISOString(),
    escalateAt: row.escalate_at?.toISOString() ?? null,
    escalatedAt: row.escalated_at?.toISOString() ?? null,
    outcome: row.outcome,
    cancelReason: row.cancel_reason,
    closedAt: row.closed_at?.toISOString() ?? null,
    closedBy: row.closed_by,
    version: Number(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function fetchTask(
  tx: Sql,
  tenantId: string,
  taskId: string,
  forUpdate = false
): Promise<TaskRow | null> {
  const rows = (
    forUpdate
      ? await tx`SELECT ${tx.unsafe(TASK_COLUMNS)} FROM awcms_crm_follow_up_tasks
                 WHERE tenant_id = ${tenantId} AND id = ${taskId} FOR UPDATE`
      : await tx`SELECT ${tx.unsafe(TASK_COLUMNS)} FROM awcms_crm_follow_up_tasks
                 WHERE tenant_id = ${tenantId} AND id = ${taskId}`
  ) as TaskRow[];

  return rows[0] ?? null;
}

export type CloseOutcome =
  | { outcome: "completed" | "cancelled"; task: TaskView }
  | { outcome: "not_found" }
  | { outcome: "version_conflict"; currentVersion: number }
  | { outcome: "closed"; status: TaskStatus };

async function closeTask(
  tx: Sql,
  tenantId: string,
  actor: string,
  taskId: string,
  expectedVersion: number,
  close: { status: "completed"; outcome: TaskOutcome } | { status: "cancelled" }
): Promise<CloseOutcome> {
  // The lead lock first (the same order every writer uses), then the row.
  const peek = await fetchTask(tx, tenantId, taskId);

  if (!peek) return { outcome: "not_found" };

  await lockLead(tx, tenantId, peek.lead_id);

  const task = (await fetchTask(tx, tenantId, taskId, true))!;

  if (Number(task.version) !== expectedVersion) {
    return {
      outcome: "version_conflict",
      currentVersion: Number(task.version)
    };
  }
  if (!LIVE_TASK_STATUSES.includes(task.status)) {
    return { outcome: "closed", status: task.status };
  }

  if (close.status === "completed") {
    await tx`
      UPDATE awcms_crm_follow_up_tasks
      SET status = 'completed', outcome = ${close.outcome}, closed_at = now(),
          closed_by = ${actor}, version = version + 1, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${taskId}
    `;
  } else {
    await tx`
      UPDATE awcms_crm_follow_up_tasks
      SET status = 'cancelled', cancel_reason = 'manual_cancel',
          closed_at = now(), closed_by = ${actor}, version = version + 1,
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${taskId}
    `;
  }

  await appendAction(tx, tenantId, {
    taskId,
    action: close.status,
    fromStatus: task.status,
    toStatus: close.status,
    actor,
    assignee: null,
    reason: close.status === "completed" ? close.outcome : "manual_cancel"
  });
  await cancelPendingNotifications(tx, tenantId, [taskId], "task_closed");

  return {
    outcome: close.status,
    task: taskView((await fetchTask(tx, tenantId, taskId))!)
  };
}

export function completeTask(
  tx: Sql,
  tenantId: string,
  actor: string,
  taskId: string,
  input: { expectedVersion: number; outcome: TaskOutcome }
): Promise<CloseOutcome> {
  return closeTask(tx, tenantId, actor, taskId, input.expectedVersion, {
    status: "completed",
    outcome: input.outcome
  });
}

export function cancelTask(
  tx: Sql,
  tenantId: string,
  actor: string,
  taskId: string,
  expectedVersion: number
): Promise<CloseOutcome> {
  return closeTask(tx, tenantId, actor, taskId, expectedVersion, {
    status: "cancelled"
  });
}
