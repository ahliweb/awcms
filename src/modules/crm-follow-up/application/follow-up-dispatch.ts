/**
 * `bun run crm-follow-up:dispatch` — the unattended half of follow-up work
 * (Issue #1165, ADR-0159 section 6), one bounded pass per tenant:
 *
 *   1. ESCALATE: an `open` task whose escalation instant has passed becomes
 *      `escalated` (an action row), and the rule's escalation recipient, if
 *      any, is owed an `escalated` notice.
 *   2. DISPATCH: every pending notice whose time has come is RE-CHECKED and
 *      then either handed to the `WorkflowNotificationPort` (one INSERT into
 *      the e-mail outbox; the provider is called later by `email:dispatch`,
 *      outside any transaction), deferred, or settled without sending:
 *
 *        task no longer live              -> cancelled  task_closed
 *        lead has a stop signal           -> cancelled  lead_stopped
 *        recipient no longer the assignee -> cancelled  recipient_changed
 *        recipient not an ACTIVE user     -> suppressed recipient_inactive
 *        outside the rule's working hours -> deferred to the next working instant
 *        recipient over the hourly cap    -> deferred
 *
 * Every decision about one task runs under the same per-lead advisory lock the
 * stop path takes (taken BEFORE any row lock, the order every writer uses), so
 * a stop and a dispatch never interleave: a notice is either handed over
 * before the stop committed (reported by the stop as already enqueued) or
 * cancelled by it.
 *
 * Nothing here is ever sent to a lead: every recipient is a tenant user.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import {
  fetchActiveTenants,
  iterateTenantsInBatches
} from "../../../lib/jobs/batching";
import type { JobContext } from "../../../lib/jobs/job-runner";
import { log } from "../../../lib/logging/logger";
import type { WorkflowNotificationPort } from "../../_shared/ports/workflow-notification-port";
import {
  CRM_FOLLOW_UP_MODULE_KEY,
  isCrmFollowUpEnabled,
  LIVE_TASK_STATUSES,
  NOTIFICATION_TEMPLATE_KEYS,
  type NotificationKind,
  type TaskStatus
} from "../domain/crm-follow-up-constants";
import {
  calendarOf,
  definitionFromRow,
  type RevisionRow,
  type RuleDefinition
} from "../domain/rule-definition";
import { nextWorkingInstant } from "../domain/working-calendar";
import { fetchSettings, isActiveForTenant } from "./settings-directory";
import {
  isActiveTenantUser,
  leadHasStopSignal,
  lockLead,
  nextWorkingInstantOr,
  scheduleNotification
} from "./task-engine";

type Sql = Bun.SQL;

export const DISPATCH_BATCH_SIZE = 50;
/** How long a notice waits when the recipient is over the hourly cap or the port failed. */
export const DEFER_MINUTES = 15;

export type DispatchPass = {
  count: number;
  escalated: number;
  enqueued: number;
  cancelled: number;
  suppressed: number;
  deferred: number;
  failed: number;
};

const EMPTY_PASS: DispatchPass = {
  count: 0,
  escalated: 0,
  enqueued: 0,
  cancelled: 0,
  suppressed: 0,
  deferred: 0,
  failed: 0
};

async function fetchDefinition(
  tx: Sql,
  tenantId: string,
  revisionId: string
): Promise<RuleDefinition | null> {
  const rows = (await tx`
    SELECT trigger_kind, pipeline_id, stage_category, stage_key, task_title,
           due_after_minutes, escalate_after_minutes, escalation_tenant_user_id,
           assignee_mode, fixed_assignee_tenant_user_id, notify_on_assign,
           notify_on_due, max_open_per_lead, time_zone, working_days,
           work_start_minute, work_end_minute, holidays
    FROM awcms_crm_follow_up_rule_revisions
    WHERE tenant_id = ${tenantId} AND id = ${revisionId}
  `) as RevisionRow[];

  return rows[0] ? definitionFromRow(rows[0]) : null;
}

async function escalateDueTasks(
  tx: Sql,
  tenantId: string,
  now: Date
): Promise<number> {
  const candidates = (await tx`
    SELECT id, lead_id FROM awcms_crm_follow_up_tasks
    WHERE tenant_id = ${tenantId} AND status = 'open'
      AND escalate_at IS NOT NULL AND escalate_at <= ${now}
    ORDER BY escalate_at, id
    LIMIT ${DISPATCH_BATCH_SIZE}
  `) as { id: string; lead_id: string }[];
  let escalated = 0;

  for (const candidate of candidates) {
    await lockLead(tx, tenantId, candidate.lead_id);

    const rows = (await tx`
      SELECT id, status, rule_revision_id FROM awcms_crm_follow_up_tasks
      WHERE tenant_id = ${tenantId} AND id = ${candidate.id}
        AND status = 'open' AND escalate_at <= ${now}
      FOR UPDATE SKIP LOCKED
    `) as { id: string; status: TaskStatus; rule_revision_id: string }[];
    const task = rows[0];

    if (!task) continue;

    await tx`
      UPDATE awcms_crm_follow_up_tasks
      SET status = 'escalated', escalated_at = ${now}, version = version + 1,
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${task.id}
    `;
    await tx`
      INSERT INTO awcms_crm_follow_up_task_actions
        (tenant_id, task_id, action, from_status, to_status, reason)
      VALUES (${tenantId}, ${task.id}, 'escalated', 'open', 'escalated', 'overdue')
    `;

    const definition = await fetchDefinition(
      tx,
      tenantId,
      task.rule_revision_id
    );
    const recipient = definition?.escalation?.recipientTenantUserId ?? null;

    if (definition && recipient) {
      await scheduleNotification(tx, tenantId, {
        taskId: task.id,
        kind: "escalated",
        recipient,
        // An unschedulable calendar never stops the pass (audit MEDIUM-1):
        // the notice is due now, and the quiet-hours check below suppresses it.
        scheduledAt: nextWorkingInstantOr(calendarOf(definition), now)
      });
    }

    escalated += 1;
  }

  return escalated;
}

type DueNotice = {
  id: string;
  task_id: string;
  kind: NotificationKind;
  recipient_tenant_user_id: string;
  deferrals: number;
};

type NoticeTask = {
  id: string;
  lead_id: string;
  status: TaskStatus;
  title: string;
  due_at: Date;
  assignee_tenant_user_id: string | null;
  rule_revision_id: string;
};

async function settle(
  tx: Sql,
  tenantId: string,
  noticeId: string,
  status: "enqueued" | "cancelled" | "suppressed",
  reason: string | null
): Promise<void> {
  await tx`
    UPDATE awcms_crm_follow_up_notifications
    SET status = ${status}, settle_reason = ${reason}, settled_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${noticeId}
  `;
}

async function defer(
  tx: Sql,
  tenantId: string,
  noticeId: string,
  until: Date
): Promise<void> {
  await tx`
    UPDATE awcms_crm_follow_up_notifications
    SET scheduled_at = ${until}, deferrals = LEAST(deferrals + 1, 1000)
    WHERE tenant_id = ${tenantId} AND id = ${noticeId}
  `;
}

async function recentlyEnqueuedFor(
  tx: Sql,
  tenantId: string,
  recipient: string,
  now: Date
): Promise<number> {
  const rows = (await tx`
    SELECT count(*)::int AS n FROM awcms_crm_follow_up_notifications
    WHERE tenant_id = ${tenantId} AND recipient_tenant_user_id = ${recipient}
      AND status = 'enqueued'
      AND settled_at > ${new Date(now.getTime() - 3_600_000)}
  `) as { n: number }[];

  return Number(rows[0]?.n ?? 0);
}

async function dispatchDueNotices(
  tx: Bun.TransactionSQL,
  tenantId: string,
  port: WorkflowNotificationPort,
  now: Date,
  pass: DispatchPass
): Promise<void> {
  const settings = await fetchSettings(tx, tenantId);
  const candidates = (await tx`
    SELECT n.id, t.lead_id
    FROM awcms_crm_follow_up_notifications n
    JOIN awcms_crm_follow_up_tasks t
      ON t.tenant_id = n.tenant_id AND t.id = n.task_id
    WHERE n.tenant_id = ${tenantId} AND n.status = 'pending'
      AND n.scheduled_at <= ${now}
    ORDER BY n.scheduled_at, n.id
    LIMIT ${DISPATCH_BATCH_SIZE}
  `) as { id: string; lead_id: string }[];

  for (const candidate of candidates) {
    await lockLead(tx, tenantId, candidate.lead_id);

    const notices = (await tx`
      SELECT id, task_id, kind, recipient_tenant_user_id, deferrals
      FROM awcms_crm_follow_up_notifications
      WHERE tenant_id = ${tenantId} AND id = ${candidate.id}
        AND status = 'pending' AND scheduled_at <= ${now}
      FOR UPDATE SKIP LOCKED
    `) as DueNotice[];
    const notice = notices[0];

    if (!notice) continue;

    const tasks = (await tx`
      SELECT id, lead_id, status, title, due_at, assignee_tenant_user_id,
             rule_revision_id
      FROM awcms_crm_follow_up_tasks
      WHERE tenant_id = ${tenantId} AND id = ${notice.task_id}
    `) as NoticeTask[];
    const task = tasks[0]!;
    const recipient = notice.recipient_tenant_user_id;

    if (!LIVE_TASK_STATUSES.includes(task.status)) {
      await settle(tx, tenantId, notice.id, "cancelled", "task_closed");
      pass.cancelled += 1;
      continue;
    }

    if (await leadHasStopSignal(tx, tenantId, task.lead_id)) {
      await settle(tx, tenantId, notice.id, "cancelled", "lead_stopped");
      pass.cancelled += 1;
      continue;
    }

    if (
      notice.kind !== "escalated" &&
      task.assignee_tenant_user_id !== recipient
    ) {
      await settle(tx, tenantId, notice.id, "cancelled", "recipient_changed");
      pass.cancelled += 1;
      continue;
    }

    if (!(await isActiveTenantUser(tx, tenantId, recipient))) {
      await settle(tx, tenantId, notice.id, "suppressed", "recipient_inactive");
      pass.suppressed += 1;
      continue;
    }

    const definition = await fetchDefinition(
      tx,
      tenantId,
      task.rule_revision_id
    );

    if (definition) {
      const calendar = calendarOf(definition);
      let next: Date;

      try {
        next = nextWorkingInstant(calendar, now);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        // A calendar with no working time ahead: the notice can never be
        // inside working hours. Settle it instead of failing the tenant pass
        // (audit of PR #1266, MEDIUM-1).
        await settle(
          tx,
          tenantId,
          notice.id,
          "suppressed",
          "calendar_unschedulable"
        );
        pass.suppressed += 1;
        continue;
      }

      if (next.getTime() !== now.getTime()) {
        await defer(tx, tenantId, notice.id, next);
        pass.deferred += 1;
        continue;
      }
    }

    // The hourly cap is counted and consumed under a per-(tenant, recipient)
    // lock, so two dispatchers on two hosts cannot both see "one left" and
    // both send (audit of PR #1266, LOW-6). Taken after the lead lock, the
    // order every dispatcher uses.
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`crm_follow_up:recipient:${tenantId}:${recipient}`}, 0)
      )
    `;

    if (
      (await recentlyEnqueuedFor(tx, tenantId, recipient, now)) >=
      settings.maxNoticesPerRecipientHour
    ) {
      await defer(
        tx,
        tenantId,
        notice.id,
        new Date(now.getTime() + DEFER_MINUTES * 60_000)
      );
      pass.deferred += 1;
      continue;
    }

    let queued = 0;

    try {
      // A savepoint: a failing enqueue rolls back the outbox row alone, and
      // the notice waits for the next run instead of failing the pass.
      await tx.savepoint(async (savepoint) => {
        const outcome = await port.enqueueNotification(savepoint as unknown as Bun.SQL, {
          tenantId,
          templateKey: NOTIFICATION_TEMPLATE_KEYS[notice.kind],
          recipientTenantUserIds: [recipient],
          // The task title (tenant configuration), its due instant and a
          // short opaque reference. Never anything about the lead.
          variables: {
            taskTitle: task.title,
            dueAt: task.due_at.toISOString(),
            taskReference: task.id.slice(0, 8)
          },
          correlationId: `${CRM_FOLLOW_UP_MODULE_KEY}.notice:${notice.id}`
        });

        queued = outcome.queued;
      });
    } catch (error) {
      // Class and code only: a database error's message can carry a value.
      const code = (error as { code?: unknown } | null)?.code;

      log("warning", "crm_follow_up.notice_enqueue_failed", {
        tenantId,
        moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
        noticeId: notice.id,
        errorClass:
          error instanceof Error ? error.constructor.name : typeof error,
        ...(typeof code === "string" ? { errorCode: code } : {})
      });
      await defer(
        tx,
        tenantId,
        notice.id,
        new Date(now.getTime() + DEFER_MINUTES * 60_000)
      );
      pass.failed += 1;
      continue;
    }

    if (queued === 0) {
      // No active template for the tenant (or no reachable address): nothing
      // was queued, so it is not recorded as sent and does not use up the
      // recipient's hourly quota (audit of PR #1266, LOW-5).
      await settle(tx, tenantId, notice.id, "suppressed", "not_queued");
      pass.suppressed += 1;
      continue;
    }

    await settle(tx, tenantId, notice.id, "enqueued", null);
    pass.enqueued += 1;
  }
}

/** One bounded pass for one tenant, in the caller's tenant transaction. */
export async function runFollowUpDispatchPass(
  tx: Bun.TransactionSQL,
  tenantId: string,
  port: WorkflowNotificationPort,
  now: Date = new Date()
): Promise<DispatchPass> {
  if (!(await isActiveForTenant(tx, tenantId))) return { ...EMPTY_PASS };

  const pass: DispatchPass = { ...EMPTY_PASS };

  pass.escalated = await escalateDueTasks(tx, tenantId, now);
  await dispatchDueNotices(tx, tenantId, port, now, pass);
  // Deferred notices are not "work done": counting them would make the batch
  // loop spin on a notice that waits for working hours.
  pass.count =
    pass.escalated + pass.enqueued + pass.cancelled + pass.suppressed;

  return pass;
}

/** `--dry-run`: what is due now, without settling anything. */
export async function countDueFollowUpWork(
  tx: Sql,
  tenantId: string,
  now: Date = new Date()
): Promise<number> {
  if (!(await isActiveForTenant(tx, tenantId))) return 0;

  const rows = (await tx`
    SELECT
      (SELECT count(*) FROM awcms_crm_follow_up_tasks
        WHERE tenant_id = ${tenantId} AND status = 'open'
          AND escalate_at IS NOT NULL AND escalate_at <= ${now})
      +
      (SELECT count(*) FROM awcms_crm_follow_up_notifications
        WHERE tenant_id = ${tenantId} AND status = 'pending'
          AND scheduled_at <= ${now}) AS n
  `) as { n: number | string }[];

  return Number(rows[0]?.n ?? 0);
}

export type FollowUpDispatchJobResult = {
  tenantsChecked: number;
  totals: Omit<DispatchPass, "count">;
  tenantsHitPassLimit: string[];
  /** Tenants whose pass threw (rolled back, logged); the others still ran. */
  failedTenants: string[];
  aborted: boolean;
};

function zeroTotals(): FollowUpDispatchJobResult["totals"] {
  return {
    escalated: 0,
    enqueued: 0,
    cancelled: 0,
    suppressed: 0,
    deferred: 0,
    failed: 0
  };
}

/**
 * Iterates active tenants (a deployment with `CRM_FOLLOW_UP_ENABLED` unset
 * visits none and exits 0). `--dry-run` counts due work and settles nothing.
 */
export async function runCrmFollowUpDispatch(
  sql: Sql,
  ctx: Pick<JobContext, "dryRun"> & Partial<Pick<JobContext, "signal">>,
  port: WorkflowNotificationPort,
  now: () => Date = () => new Date()
): Promise<FollowUpDispatchJobResult> {
  if (!isCrmFollowUpEnabled()) {
    return {
      tenantsChecked: 0,
      totals: zeroTotals(),
      tenantsHitPassLimit: [],
      failedTenants: [],
      aborted: false
    };
  }

  if (ctx.dryRun) {
    const tenants = await fetchActiveTenants(sql);
    const totals = zeroTotals();

    for (const tenant of tenants) {
      totals.enqueued += await withTenantOrThrow(
        sql,
        tenant.id,
        (tx) => countDueFollowUpWork(tx, tenant.id, now()),
        { workClass: "maintenance" }
      );
    }

    return {
      tenantsChecked: tenants.length,
      totals,
      tenantsHitPassLimit: [],
      failedTenants: [],
      aborted: false
    };
  }

  const totals = zeroTotals();
  const failedTenants: string[] = [];
  const outcome = await iterateTenantsInBatches(
    sql,
    async (tenantId) => {
      try {
        const pass = await withTenantOrThrow(
          sql,
          tenantId,
          (tx) => runFollowUpDispatchPass(tx, tenantId, port, now()),
          { workClass: "maintenance" }
        );

        for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
          totals[key] += pass[key];
        }

        return pass;
      } catch (error) {
        // One tenant's failure rolls back that tenant's pass only and never
        // stops the others (audit of PR #1266, MEDIUM-1). Class and code only.
        const code = (error as { code?: unknown } | null)?.code;

        log("error", "crm_follow_up.dispatch_tenant_failed", {
          tenantId,
          moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
          errorClass:
            error instanceof Error ? error.constructor.name : typeof error,
          ...(typeof code === "string" ? { errorCode: code } : {})
        });
        failedTenants.push(tenantId);

        return { ...EMPTY_PASS };
      }
    },
    { ...(ctx.signal ? { signal: ctx.signal } : {}), maxPasses: 50 }
  );

  return {
    tenantsChecked: outcome.tenants.length,
    totals,
    tenantsHitPassLimit: [...outcome.perTenant.entries()]
      .filter(([, value]) => value.hitPassLimit)
      .map(([tenantId]) => tenantId),
    failedTenants,
    aborted: outcome.aborted
  };
}
