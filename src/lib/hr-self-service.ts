/**
 * Pure helpers shared by the HR self-service, supervisor and HR screens
 * (Issue #952): the reporting window, the translated closed-enum labels and the
 * number formatting. No I/O, so `tests/hr-self-service.test.ts` runs without a
 * database or a render.
 *
 * ## Windows
 *
 * The workforce-metrics contract caps a window at 31 days
 * (`MAX_WINDOW_DAYS`); the screens offer three fixed periods instead of two
 * free dates, so a person cannot ask for an over-long window and the page never
 * has to word a validation error. `to` is the exclusive end (now), `from` the
 * inclusive start.
 *
 * ## Enums
 *
 * A closed enum is never rendered raw (`awcms-i18n`): every status and kind goes
 * through a `Record<Enum, string>` that is exhaustive over the module's own
 * union, so a new member fails typecheck here until it has a label.
 */
import type { Translator } from "./i18n";
import type { PillTone } from "./booking-admin-labels";
import type {
  AttendanceKind,
  CorrectionKind,
  CorrectionStatus
} from "../modules/hr-workforce/domain/hr-attendance-types";
import type {
  ShiftKind,
  ShiftStatus,
  TimeOffKind
} from "../modules/hr-workforce/domain/hr-shift-types";
import type {
  EmploymentStatus,
  EmploymentType
} from "../modules/hr-workforce/domain/hr-workforce-types";
import type { AccrualStatus } from "../modules/hr-commission/domain/hr-commission-accrual-state";

export const HR_PERIODS = ["7d", "14d", "30d"] as const;
export type HrPeriod = (typeof HR_PERIODS)[number];

const PERIOD_DAYS: Record<HrPeriod, number> = { "7d": 7, "14d": 14, "30d": 30 };
const DAY_MS = 86_400_000;

/** A recognised period, else the default (7 days). Never throws on hostile input. */
export function parsePeriod(raw: string | null | undefined): HrPeriod {
  return (HR_PERIODS as readonly string[]).includes(raw ?? "")
    ? (raw as HrPeriod)
    : "7d";
}

/** The look-back window ending at `now` (exclusive). */
export function pastWindow(
  period: HrPeriod,
  now: Date
): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS),
    to: now
  };
}

/** The look-ahead window starting at `now`, for upcoming shifts. */
export function upcomingWindow(
  days: number,
  now: Date
): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + days * DAY_MS) };
}

export function periodLabels(t: Translator["t"]): Record<HrPeriod, string> {
  return {
    "7d": t("Last 7 days"),
    "14d": t("Last 14 days"),
    "30d": t("Last 30 days")
  };
}

export function attendanceKindLabels(
  t: Translator["t"]
): Record<AttendanceKind, string> {
  return {
    clock_in: t("Clock in"),
    clock_out: t("Clock out"),
    break_start: t("Break start"),
    break_end: t("Break end")
  };
}

export function correctionKindLabels(
  t: Translator["t"]
): Record<CorrectionKind, string> {
  return {
    add: t("Add a missing event"),
    replace: t("Replace an event")
  };
}

export function correctionStatusLabels(
  t: Translator["t"]
): Record<CorrectionStatus, string> {
  return {
    pending: t("Pending"),
    approved: t("Approved"),
    rejected: t("Rejected"),
    withdrawn: t("Withdrawn")
  };
}

export const CORRECTION_STATUS_TONE: Record<CorrectionStatus, PillTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral"
};

export function shiftKindLabels(t: Translator["t"]): Record<ShiftKind, string> {
  return { work: t("Work"), time_off: t("Time off") };
}

export function timeOffKindLabels(
  t: Translator["t"]
): Record<TimeOffKind, string> {
  return { leave: t("Leave"), holiday: t("Holiday"), other: t("Other") };
}

export function shiftStatusLabels(
  t: Translator["t"]
): Record<ShiftStatus, string> {
  return {
    draft: t("Draft"),
    published: t("Published"),
    cancelled: t("Cancelled")
  };
}

export function employmentTypeLabels(
  t: Translator["t"]
): Record<EmploymentType, string> {
  return {
    permanent: t("Permanent"),
    fixed_term: t("Fixed term"),
    part_time: t("Part time"),
    casual: t("Casual")
  };
}

export function employmentStatusLabels(
  t: Translator["t"]
): Record<EmploymentStatus, string> {
  return {
    active: t("Active"),
    on_leave: t("On leave"),
    suspended: t("Suspended"),
    terminated: t("Terminated")
  };
}

export function accrualStatusLabels(
  t: Translator["t"]
): Record<AccrualStatus, string> {
  return {
    pending: t("Pending"),
    approved: t("Approved"),
    payable: t("Payable"),
    paid: t("Paid"),
    voided: t("Voided")
  };
}

export const ACCRUAL_STATUS_TONE: Record<AccrualStatus, PillTone> = {
  pending: "warning",
  approved: "info",
  payable: "primary",
  paid: "success",
  voided: "neutral"
};

/** The label of a value that may fall outside the union (a column is plain text): the raw value, never a crash. */
export function labelOf<K extends string>(
  labels: Record<K, string>,
  value: string
): string {
  return (labels as Record<string, string>)[value] ?? value;
}

/** `95` -> `1 h 35 min`; whole minutes only. */
export function formatMinutes(t: Translator["t"], minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;

  if (hours === 0) {
    return t("{minutes} min", { minutes: rest });
  }

  return t("{hours} h {minutes} min", { hours, minutes: rest });
}

/** `0.9166` -> `92%`; `null` (nothing to divide by) -> an em dash, never `0%` or `NaN`. */
export function formatRatioPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) {
    return "—";
  }

  return `${Math.round(ratio * 100)}%`;
}
