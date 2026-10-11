/**
 * Vocabulary of the employment context (Issue #945, ADR-0132). Mirrors the
 * CHECK constraints in `sql/176`; the database is the authority, these exist so
 * a bad value is a 400 and not a 500.
 */
export const EMPLOYMENT_TYPES = [
  "permanent",
  "fixed_term",
  "part_time",
  "casual"
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** `terminated` is reachable only through its own, terminal, term. */
export const EMPLOYMENT_STATUSES = [
  "active",
  "on_leave",
  "suspended",
  "terminated"
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const DEFAULT_CLOCK_SKEW_SECONDS = 300;
export const DEFAULT_CORRECTION_WORKFLOW_KEY = "hr.attendance_correction";

export function isEmploymentType(value: unknown): value is EmploymentType {
  return (
    typeof value === "string" &&
    (EMPLOYMENT_TYPES as readonly string[]).includes(value)
  );
}

export function isEmploymentStatus(value: unknown): value is EmploymentStatus {
  return (
    typeof value === "string" &&
    (EMPLOYMENT_STATUSES as readonly string[]).includes(value)
  );
}
