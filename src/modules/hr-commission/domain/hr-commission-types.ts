/**
 * Vocabulary of the commission rules (Issue #950, ADR-0132). Mirrors the CHECK
 * constraints in `sql/182`; the database is the authority, these exist so a bad
 * value is a 400 and not a 500.
 */
export const COMMISSION_CALCULATIONS = ["percent", "fixed"] as const;
export type CommissionCalculation = (typeof COMMISSION_CALCULATIONS)[number];

export const COMMISSION_RULE_STATUSES = [
  "draft",
  "published",
  "retired"
] as const;
export type CommissionRuleStatus = (typeof COMMISSION_RULE_STATUSES)[number];

export function isCommissionCalculation(
  value: unknown
): value is CommissionCalculation {
  return (
    typeof value === "string" &&
    (COMMISSION_CALCULATIONS as readonly string[]).includes(value)
  );
}

export function isCommissionRuleStatus(
  value: unknown
): value is CommissionRuleStatus {
  return (
    typeof value === "string" &&
    (COMMISSION_RULE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Upper bound on `units` for a fixed-per-unit rule. It bounds the COST of an
 * evaluation, but NOT the size of its result: `fixedAmount` may have twelve
 * integer digits, so `fixedAmount * units` can reach 10^18. The result's size is
 * bounded separately and explicitly (`MAX_COMMISSION_INTEGER_DIGITS`, checked in
 * `evaluateCommission`).
 */
export const MAX_COMMISSION_UNITS = 1_000_000;

/**
 * A commission is at most 10^12 minus one unit at the rule's scale — the integer
 * capacity of the `numeric(18, 6)` the amounts will be stored in. An evaluation
 * whose rounded result reaches 10^12 is refused, never truncated.
 */
export const MAX_COMMISSION_INTEGER_DIGITS = 12;
