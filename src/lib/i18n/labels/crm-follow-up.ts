/**
 * Translated labels for the closed vocabularies of the follow-up screens
 * (Issue #1165, ADR-0159): task status, outcome, trigger, stop kind, action
 * kind, notice kind and its settlement.
 *
 * Shared by three screens, so one helper (`docs/awcms/14_ui_ux_design_system.md`
 * "No raw enums"). Each value is a database token, not English prose, so `t()`
 * cannot translate it in place; the raw token stays in a `data-*` attribute for
 * tests and CSS. An unrecognised value falls back to the raw string, never a
 * crash or a blank cell.
 */
import type { Translator } from "../catalog";

type T = Translator["t"];

export type FollowUpTone =
  "success" | "warning" | "danger" | "info" | "neutral";

const STATUS_TONE: Record<string, FollowUpTone> = {
  open: "info",
  escalated: "warning",
  completed: "success",
  cancelled: "neutral"
};

export function taskStatusLabel(t: T, status: string): string {
  switch (status) {
    case "open":
      return t("Open");
    case "escalated":
      return t("Escalated");
    case "completed":
      return t("Completed");
    case "cancelled":
      return t("Cancelled");
    default:
      return status;
  }
}

export function taskStatusTone(status: string): FollowUpTone {
  return STATUS_TONE[status] ?? "neutral";
}

export function taskOutcomeLabel(t: T, outcome: string): string {
  switch (outcome) {
    case "reached":
      return t("Reached the lead");
    case "no_answer":
      return t("No answer");
    case "rescheduled":
      return t("Rescheduled");
    case "not_interested":
      return t("Not interested");
    case "other":
      return t("Other");
    default:
      return outcome;
  }
}

export function triggerKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "lead_created":
      return t("Lead created");
    case "stage_entered":
      return t("Stage entered");
    case "lead_assigned":
      return t("Lead assigned");
    default:
      return kind;
  }
}

export function stopKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "converted":
      return t("Lead converted");
    case "lost":
      return t("Lead lost");
    case "merged":
      return t("Lead merged");
    case "reply_received":
      return t("Reply received");
    case "consent_withdrawn":
      return t("Consent withdrawn");
    case "sender_blocked":
      return t("Sender blocked");
    case "manual":
      return t("Stopped by staff");
    default:
      return kind;
  }
}

export function actionKindLabel(t: T, action: string): string {
  switch (action) {
    case "created":
      return t("Created");
    case "reassigned":
      return t("Reassigned");
    case "escalated":
      return t("Escalated");
    case "completed":
      return t("Completed");
    case "cancelled":
      return t("Cancelled");
    default:
      return action;
  }
}

/** The closed `reason` of an action row and the closed `cancel_reason` of a task. */
export function reasonLabel(t: T, reason: string | null): string {
  if (reason === null) return "";

  switch (reason) {
    case "rule_trigger":
      return t("Started by a rule");
    case "lead_owner_changed":
      return t("The lead's owner changed");
    case "assignee_inactive":
      return t("The assignee is no longer active");
    case "overdue":
      return t("Overdue");
    case "manual_cancel":
      return t("Cancelled by staff");
    default:
      break;
  }

  if (reason.startsWith("stop_")) {
    return t("Stopped: {reason}", {
      reason: stopKindLabel(t, reason.slice("stop_".length))
    });
  }

  // `reached`, `no_answer`, ... are the outcome vocabulary.
  return taskOutcomeLabel(t, reason);
}

export function noticeKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "assigned":
      return t("Assignment notice");
    case "due":
      return t("Due notice");
    case "escalated":
      return t("Escalation notice");
    default:
      return kind;
  }
}

export function noticeStatusLabel(t: T, status: string): string {
  switch (status) {
    case "pending":
      return t("Waiting to be sent");
    case "enqueued":
      return t("Handed to e-mail");
    case "cancelled":
      return t("Cancelled");
    case "suppressed":
      return t("Not sent");
    default:
      return status;
  }
}

export function noticeSettleLabel(t: T, reason: string | null): string {
  switch (reason) {
    case null:
      return "";
    case "task_closed":
      return t("The task was closed");
    case "lead_stopped":
      return t("Follow-up for the lead was stopped");
    case "recipient_inactive":
      return t("The recipient is no longer active");
    case "recipient_changed":
      return t("The task moved to someone else");
    case "calendar_unschedulable":
      return t("The rule's calendar has no working time");
    case "not_queued":
      return t("No e-mail template is set up");
    default:
      return reason;
  }
}

export function assigneeModeLabel(t: T, mode: string): string {
  switch (mode) {
    case "lead_owner":
      return t("The lead's owner");
    case "fixed_user":
      return t("A fixed person");
    default:
      return mode;
  }
}

export function stageCategoryLabel(t: T, category: string): string {
  switch (category) {
    case "new":
      return t("New");
    case "working":
      return t("Working");
    case "qualified":
      return t("Qualified");
    case "converted":
      return t("Converted");
    case "lost":
      return t("Lost");
    case "disqualified":
      return t("Disqualified");
    default:
      return category;
  }
}

/** ISO weekday 1 = Monday .. 7 = Sunday. */
export function weekdayLabel(t: T, isoWeekday: number): string {
  switch (isoWeekday) {
    case 1:
      return t("Monday");
    case 2:
      return t("Tuesday");
    case 3:
      return t("Wednesday");
    case 4:
      return t("Thursday");
    case 5:
      return t("Friday");
    case 6:
      return t("Saturday");
    case 7:
      return t("Sunday");
    default:
      return String(isoWeekday);
  }
}
