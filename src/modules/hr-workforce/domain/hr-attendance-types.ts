/** Attendance vocabulary for `hr_workforce` (Issue #947, `docs/awcms/hr-payroll.md` section 4.2). Pure. */

export const ATTENDANCE_KINDS = [
  "clock_in",
  "clock_out",
  "break_start",
  "break_end"
] as const;
export type AttendanceKind = (typeof ATTENDANCE_KINDS)[number];

/** What a client may claim. `correction` is written only by an approved correction, never accepted from a body. */
export const ATTENDANCE_CLIENT_SOURCES = [
  "self",
  "supervisor",
  "kiosk",
  "import"
] as const;
export type AttendanceClientSource = (typeof ATTENDANCE_CLIENT_SOURCES)[number];
export type AttendanceSource = AttendanceClientSource | "correction";

export const CORRECTION_KINDS = ["add", "replace"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn"
] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

/** The workflow_approval resource type of a correction's instance (the database guard checks it). */
export const CORRECTION_RESOURCE_TYPE = "hr_attendance_correction";

export const ATTENDANCE_LIMITS = {
  clientEventKey: 128,
  reason: 500,
  /**
   * The database's rules, mirrored for documentation and tests (`sql/198`):
   * a kiosk/import replay is accepted up to this old, and flagged `late` past
   * the shorter bound.
   */
  replayMaxAgeDays: 7,
  lateAfterMinutes: 15
} as const;

export function isAttendanceKind(value: unknown): value is AttendanceKind {
  return (ATTENDANCE_KINDS as readonly unknown[]).includes(value);
}

export function isAttendanceClientSource(
  value: unknown
): value is AttendanceClientSource {
  return (ATTENDANCE_CLIENT_SOURCES as readonly unknown[]).includes(value);
}

export function isCorrectionKind(value: unknown): value is CorrectionKind {
  return (CORRECTION_KINDS as readonly unknown[]).includes(value);
}

export function isCorrectionStatus(value: unknown): value is CorrectionStatus {
  return (CORRECTION_STATUSES as readonly unknown[]).includes(value);
}
