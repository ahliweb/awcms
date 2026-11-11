/**
 * A follow-up rule revision's definition, how a lead event is matched against
 * it, and how a task is planned from it (Issue #1165, ADR-0159 section 3).
 *
 * Everything here is DECLARATIVE and CLOSED: a trigger from a closed list, three
 * optional equality filters, offsets in working minutes and a calendar. There
 * is no expression, script or callback, so a revision can be simulated and
 * audited exactly as it will run.
 *
 * Pure module: no database, no I/O.
 */
import type {
  AssigneeMode,
  StageCategory,
  TriggerKind
} from "./crm-follow-up-constants";
import {
  addWorkingMinutes,
  maskToWeekdays,
  weekdaysToMask,
  type WorkingCalendar
} from "./working-calendar";

export type RuleDefinition = {
  trigger: {
    kind: TriggerKind;
    pipelineId: string | null;
    stageCategory: StageCategory | null;
    stageKey: string | null;
  };
  taskTitle: string;
  dueAfterMinutes: number;
  escalation: {
    afterMinutes: number;
    recipientTenantUserId: string | null;
  } | null;
  assignee: { mode: AssigneeMode; tenantUserId: string | null };
  notify: { onAssign: boolean; onDue: boolean };
  maxOpenPerLead: number;
  calendar: {
    timeZone: string;
    /** ISO weekdays, 1 = Monday .. 7 = Sunday, ascending and distinct. */
    workingDays: number[];
    workStartMinute: number;
    workEndMinute: number;
    /** Local dates `YYYY-MM-DD`, ascending and distinct. */
    holidays: string[];
  };
};

/** What a lead event tells this module (ids and closed codes only). */
export type TriggerFacts = {
  kind: TriggerKind;
  leadId: string;
  pipelineId: string | null;
  stageCategory: StageCategory | null;
  stageKey: string | null;
  /** The lead's owner as the event states it (null when unknown or unassigned). */
  ownerTenantUserId: string | null;
  occurredAt: Date;
};

/** The stored weekday bitmask of a definition's calendar. */
export function weekdayMaskOf(definition: RuleDefinition): number {
  return weekdaysToMask(definition.calendar.workingDays);
}

export function calendarOf(definition: RuleDefinition): WorkingCalendar {
  return {
    timeZone: definition.calendar.timeZone,
    workingDays: weekdayMaskOf(definition),
    workStartMinute: definition.calendar.workStartMinute,
    workEndMinute: definition.calendar.workEndMinute,
    holidays: definition.calendar.holidays
  };
}

/**
 * Whether a revision's trigger matches an event. A filter the event cannot
 * answer (for example a pipeline filter on an event that carries no pipeline)
 * does NOT match: fail closed, never "unknown means yes".
 */
export function matchesTrigger(
  definition: RuleDefinition,
  facts: TriggerFacts
): boolean {
  const trigger = definition.trigger;

  if (trigger.kind !== facts.kind) return false;
  if (trigger.pipelineId !== null && trigger.pipelineId !== facts.pipelineId) {
    return false;
  }
  if (
    trigger.stageCategory !== null &&
    trigger.stageCategory !== facts.stageCategory
  ) {
    return false;
  }
  if (trigger.stageKey !== null && trigger.stageKey !== facts.stageKey) {
    return false;
  }

  return true;
}

export type TaskPlan = {
  dueAt: Date;
  escalateAt: Date | null;
  /** The candidate assignee BEFORE the "still an active user" check. */
  assigneeTenantUserId: string | null;
};

/** Due and escalation instants over the calendar, and the candidate assignee. */
export function planTask(
  definition: RuleDefinition,
  facts: TriggerFacts
): TaskPlan {
  const calendar = calendarOf(definition);
  const dueAt = addWorkingMinutes(
    calendar,
    facts.occurredAt,
    definition.dueAfterMinutes
  );
  const escalateAt = definition.escalation
    ? addWorkingMinutes(calendar, dueAt, definition.escalation.afterMinutes)
    : null;

  return {
    dueAt,
    escalateAt,
    assigneeTenantUserId:
      definition.assignee.mode === "fixed_user"
        ? definition.assignee.tenantUserId
        : facts.ownerTenantUserId
  };
}

/** A canonical string of a definition: same meaning, same string. */
export function canonicalDefinition(definition: RuleDefinition): string {
  return JSON.stringify({
    trigger: {
      kind: definition.trigger.kind,
      pipelineId: definition.trigger.pipelineId,
      stageCategory: definition.trigger.stageCategory,
      stageKey: definition.trigger.stageKey
    },
    taskTitle: definition.taskTitle,
    dueAfterMinutes: definition.dueAfterMinutes,
    escalation: definition.escalation
      ? {
          afterMinutes: definition.escalation.afterMinutes,
          recipientTenantUserId: definition.escalation.recipientTenantUserId
        }
      : null,
    assignee: {
      mode: definition.assignee.mode,
      tenantUserId: definition.assignee.tenantUserId
    },
    notify: {
      onAssign: definition.notify.onAssign,
      onDue: definition.notify.onDue
    },
    maxOpenPerLead: definition.maxOpenPerLead,
    calendar: {
      timeZone: definition.calendar.timeZone,
      workingDays: [...definition.calendar.workingDays],
      workStartMinute: definition.calendar.workStartMinute,
      workEndMinute: definition.calendar.workEndMinute,
      holidays: [...definition.calendar.holidays]
    }
  });
}

export function definitionHash(definition: RuleDefinition): string {
  return new Bun.CryptoHasher("sha256")
    .update(canonicalDefinition(definition))
    .digest("hex");
}

/** The stored revision row, read back into a definition. */
export type RevisionRow = {
  trigger_kind: TriggerKind;
  pipeline_id: string | null;
  stage_category: StageCategory | null;
  stage_key: string | null;
  task_title: string;
  due_after_minutes: number;
  escalate_after_minutes: number | null;
  escalation_tenant_user_id: string | null;
  assignee_mode: AssigneeMode;
  fixed_assignee_tenant_user_id: string | null;
  notify_on_assign: boolean;
  notify_on_due: boolean;
  max_open_per_lead: number;
  time_zone: string;
  working_days: number;
  work_start_minute: number;
  work_end_minute: number;
  holidays: string[] | string;
};

function parseTextArray(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;

  // Defensive: a driver that returns the Postgres text form `{a,b}`.
  const inner = value.replace(/^\{|\}$/g, "");

  return inner.length === 0 ? [] : inner.split(",");
}

export function definitionFromRow(row: RevisionRow): RuleDefinition {
  return {
    trigger: {
      kind: row.trigger_kind,
      pipelineId: row.pipeline_id,
      stageCategory: row.stage_category,
      stageKey: row.stage_key
    },
    taskTitle: row.task_title,
    dueAfterMinutes: Number(row.due_after_minutes),
    escalation:
      row.escalate_after_minutes === null
        ? null
        : {
            afterMinutes: Number(row.escalate_after_minutes),
            recipientTenantUserId: row.escalation_tenant_user_id
          },
    assignee: {
      mode: row.assignee_mode,
      tenantUserId: row.fixed_assignee_tenant_user_id
    },
    notify: { onAssign: row.notify_on_assign, onDue: row.notify_on_due },
    maxOpenPerLead: Number(row.max_open_per_lead),
    calendar: {
      timeZone: row.time_zone,
      workingDays: maskToWeekdays(Number(row.working_days)),
      workStartMinute: Number(row.work_start_minute),
      workEndMinute: Number(row.work_end_minute),
      holidays: parseTextArray(row.holidays)
    }
  };
}
