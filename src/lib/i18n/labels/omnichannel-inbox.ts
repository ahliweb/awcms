/**
 * Translated labels for the closed vocabularies of the omnichannel inbox
 * screens (Issue #1164, ADR-0160, UP-14): conversation status, customer state,
 * source kind, SLA state, activity kind and the weekday names.
 *
 * Rendered on three screens, so one shared helper (`docs/awcms/14_ui_ux_design_
 * system.md` "No raw enums"). Each value is a database token (`opted_out`), not
 * English prose, so `t()` cannot translate it in place; the raw token stays in
 * a `data-*` attribute for tests and CSS. An unrecognised value falls back to
 * the raw string, never a crash or a blank cell.
 */
import type { Translator } from "../catalog";

type T = Translator["t"];

export type InboxTone = "success" | "warning" | "danger" | "info" | "neutral";

const STATUS_TONE: Record<string, InboxTone> = {
  open: "info",
  pending: "warning",
  resolved: "success",
  closed: "neutral"
};

export function conversationStatusLabel(t: T, status: string): string {
  switch (status) {
    case "open":
      return t("Open");
    case "pending":
      return t("Pending");
    case "resolved":
      return t("Resolved");
    case "closed":
      return t("Closed");
    default:
      return status;
  }
}

export function conversationStatusTone(status: string): InboxTone {
  return STATUS_TONE[status] ?? "neutral";
}

export function customerStateLabel(t: T, state: string): string {
  switch (state) {
    case "active":
      return t("Can be answered");
    case "opted_out":
      return t("Opted out");
    case "withdrawn":
      return t("Withdrew");
    default:
      return state;
  }
}

export function customerStateTone(state: string): InboxTone {
  return state === "active" ? "success" : "danger";
}

export function sourceKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "telegram":
      return t("Telegram bot");
    case "website":
      return t("Website form");
    default:
      return kind;
  }
}

export function slaStateLabel(t: T, state: string): string {
  switch (state) {
    case "none":
      return t("No response due");
    case "on_track":
      return t("On track");
    case "breached":
      return t("Overdue");
    default:
      return state;
  }
}

export function slaStateTone(state: string): InboxTone {
  return state === "breached"
    ? "danger"
    : state === "on_track"
      ? "success"
      : "neutral";
}

export function dueKindLabel(t: T, kind: string | null): string {
  switch (kind) {
    case "first":
      return t("First response");
    case "next":
      return t("Next response");
    default:
      return "—";
  }
}

/** One phrase per history entry: ids and closed codes only, never a name. */
export function activityKindLabel(t: T, kind: string): string {
  switch (kind) {
    case "assigned":
      return t("Assigned");
    case "unassigned":
      return t("Unassigned");
    case "assignee_revoked":
      return t("Assignee removed (no longer eligible)");
    case "status_changed":
      return t("Status changed");
    case "response_recorded":
      return t("Response recorded");
    case "tag_added":
      return t("Tag added");
    case "tag_removed":
      return t("Tag removed");
    case "sla_breached":
      return t("Response deadline missed");
    default:
      return kind;
  }
}

/** The closed `detail_code` of an activity row, or an empty string. */
export function activityDetailLabel(
  t: T,
  kind: string,
  detail: string | null
): string {
  if (detail === null) return "";

  if (kind === "status_changed") return conversationStatusLabel(t, detail);

  if (kind === "sla_breached") return dueKindLabel(t, detail);

  if (kind === "assigned") {
    return detail === "reassigned" ? t("Replaced the previous assignee") : "";
  }

  if (kind === "assignee_revoked") {
    switch (detail) {
      case "scope_not_covered":
        return t("The person does not cover this business scope");
      case "user_inactive":
        return t("The person was deactivated");
      case "permission_missing":
        return t("The person lost the permission");
      case "scope_confined":
        return t("The person no longer covers this business scope");
      default:
        return "";
    }
  }

  return "";
}

/** ISO weekday 1 (Monday) .. 7 (Sunday). */
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
