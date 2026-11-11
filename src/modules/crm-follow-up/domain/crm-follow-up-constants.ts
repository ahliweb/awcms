/**
 * Closed vocabularies and fixed names for `crm_follow_up` (Issue #1165,
 * ADR-0159). Every list here is closed ON PURPOSE and is also a CHECK
 * constraint in `sql/369`, so the database refuses what the validator should
 * already have.
 *
 * There is deliberately NO product vocabulary here (ADR-0153 L2): rule codes,
 * names and task titles are tenant data.
 *
 * Pure module: no database, no I/O.
 */

export const CRM_FOLLOW_UP_MODULE_KEY = "crm_follow_up";

export const RULES_ACTIVITY_CODE = "rules";
export const TASKS_ACTIVITY_CODE = "tasks";
export const STOP_SIGNALS_ACTIVITY_CODE = "stop_signals";

/**
 * The route guards (`sql/370`). Written out literally: the enforcement gate
 * reads these object literals.
 */
export const CRM_FOLLOW_UP_GUARDS = {
  readRules: {
    moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
    activityCode: RULES_ACTIVITY_CODE,
    action: "read" as const
  },
  configureRules: {
    moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
    activityCode: RULES_ACTIVITY_CODE,
    action: "configure" as const
  },
  readTasks: {
    moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
    activityCode: TASKS_ACTIVITY_CODE,
    action: "read" as const
  },
  updateTasks: {
    moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
    activityCode: TASKS_ACTIVITY_CODE,
    action: "update" as const
  },
  createStopSignals: {
    moduleKey: CRM_FOLLOW_UP_MODULE_KEY,
    activityCode: STOP_SIGNALS_ACTIVITY_CODE,
    action: "create" as const
  }
} as const;

/** What starts a task (ADR-0159 section 3). */
export const TRIGGER_KINDS = [
  "lead_created",
  "stage_entered",
  "lead_assigned"
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** ADR-0153's closed stage categories, used as a filter only. */
export const STAGE_CATEGORIES = [
  "new",
  "working",
  "qualified",
  "converted",
  "lost",
  "disqualified"
] as const;
export type StageCategory = (typeof STAGE_CATEGORIES)[number];

export const ASSIGNEE_MODES = ["lead_owner", "fixed_user"] as const;
export type AssigneeMode = (typeof ASSIGNEE_MODES)[number];

export const TASK_STATUSES = [
  "open",
  "escalated",
  "completed",
  "cancelled"
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const LIVE_TASK_STATUSES: readonly TaskStatus[] = ["open", "escalated"];

/** A completed task records one of these and no free text. */
export const TASK_OUTCOMES = [
  "reached",
  "no_answer",
  "rescheduled",
  "not_interested",
  "other"
] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

/** Stop kinds (ADR-0159 section 5). */
export const STOP_KINDS = [
  "converted",
  "lost",
  "merged",
  "reply_received",
  "consent_withdrawn",
  "sender_blocked",
  "manual"
] as const;
export type StopKind = (typeof STOP_KINDS)[number];

/** The kinds staff may record by hand; the other three come from lead events only. */
export const STAFF_STOP_KINDS = [
  "reply_received",
  "consent_withdrawn",
  "sender_blocked",
  "manual"
] as const;
export type StaffStopKind = (typeof STAFF_STOP_KINDS)[number];

export type CancelReason = "manual_cancel" | `stop_${StopKind}`;

export const NOTIFICATION_KINDS = ["assigned", "due", "escalated"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The e-mail category per notification kind (`sql/371`, `email-template-categories.ts`). */
export const NOTIFICATION_TEMPLATE_KEYS: Readonly<
  Record<NotificationKind, string>
> = {
  assigned: "crm.follow_up_assigned",
  due: "crm.follow_up_due",
  escalated: "crm.follow_up_escalated"
};

/** Bounds. */
export const MAX_DUE_AFTER_MINUTES = 43200;
export const MAX_ESCALATE_AFTER_MINUTES = 43200;
export const MAX_OPEN_PER_LEAD = 5;
export const MAX_HOLIDAYS = 366;
export const MAX_TITLE_LENGTH = 120;
export const MAX_NAME_LENGTH = 120;
export const MAX_RULES_LISTED = 200;
export const CRM_FOLLOW_UP_BODY_LIMIT_BYTES = 16 * 1024;

/** The lead events this module consumes (published by `crm_leads`). */
export const LEAD_CREATED_EVENT = "awcms.crm_leads.lead.created";
export const LEAD_STAGE_CHANGED_EVENT = "awcms.crm_leads.lead.stage_changed";
export const LEAD_ASSIGNED_EVENT = "awcms.crm_leads.lead.assigned";
export const LEAD_MERGED_EVENT = "awcms.crm_leads.lead.merged";
export const LEAD_CONVERTED_EVENT = "awcms.crm_leads.lead.converted";
export const LEAD_LOST_EVENT = "awcms.crm_leads.lead.lost";

export const CONSUMED_LEAD_EVENT_TYPES = [
  LEAD_CREATED_EVENT,
  LEAD_STAGE_CHANGED_EVENT,
  LEAD_ASSIGNED_EVENT,
  LEAD_MERGED_EVENT,
  LEAD_CONVERTED_EVENT,
  LEAD_LOST_EVENT
] as const;

/** The deployment switch (ADR-0159 section 1: off by default). */
export function isCrmFollowUpEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.CRM_FOLLOW_UP_ENABLED === "true";
}
