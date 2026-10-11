/** Shift vocabulary for `hr_workforce` (Issue #946, `docs/awcms/hr-payroll.md` section 4.4). Pure. */

export const SHIFT_KINDS = ["work", "time_off"] as const;
export type ShiftKind = (typeof SHIFT_KINDS)[number];

/**
 * A COARSE category, never a reason: sick leave is health data, so the schema
 * has no free-text column on an assignment at all.
 */
export const TIME_OFF_KINDS = ["leave", "holiday", "other"] as const;
export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];

export const SHIFT_STATUSES = ["draft", "published", "cancelled"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const SHIFT_LIMITS = {
  /** A work interval shorter than this is a typo, not a shift (and the schema refuses it). */
  workMinMinutes: 15,
  workMaxMinutes: 24 * 60,
  timeOffMaxMinutes: 31 * 24 * 60,
  templateCode: 32,
  templateName: 120,
  /** Availability port bounds (docs/awcms/cross-domain-contracts.md section 4). */
  availabilityMaxStaff: 200,
  availabilityMaxWindowDays: 35,
  /** Per employment, per availability call; past it that person is `unknown`. */
  availabilityMaxRowsPerEmployment: 1000
} as const;

export function isShiftKind(value: unknown): value is ShiftKind {
  return (SHIFT_KINDS as readonly unknown[]).includes(value);
}

export function isTimeOffKind(value: unknown): value is TimeOffKind {
  return (TIME_OFF_KINDS as readonly unknown[]).includes(value);
}

export function isShiftStatus(value: unknown): value is ShiftStatus {
  return (SHIFT_STATUSES as readonly unknown[]).includes(value);
}
