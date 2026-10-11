/**
 * Commission rule evaluation (Issue #950, ADR-0132, `docs/awcms/hr-payroll.md`
 * section 6.1). PURE: no database, no clock, no configuration, no I/O — the same
 * rule and input give the same answer on any machine in any year, which is what
 * lets a later accrual cite "rule X version N" and be re-derived.
 *
 * ## Two steps, deliberately separate
 *
 *   1. `selectEffectiveRule` — which PUBLISHED version applies to an event: the
 *      one whose half-open window `[effectiveFrom, effectiveTo)` contains the
 *      event's own date (`occurredOn`, a `YYYY-MM-DD` the caller derives from the
 *      event; never `now()`).
 *   2. `evaluateCommission` — the amount that version yields for an input.
 *
 * ## Bounded by construction
 *
 * There is no expression, formula string, script or callback anywhere: a rule is
 * a closed record (`percent` or `fixed`) with an optional floor and ceiling, so
 * evaluating it is a handful of `bigint` operations whose cost does not depend
 * on the rule. Inputs are digit-bounded (`hr-commission-decimal.ts`), `units`
 * is capped (`MAX_COMMISSION_UNITS`) and the RESULT is capped below 10^12
 * (`MAX_COMMISSION_INTEGER_DIGITS`), because a product of two in-range inputs
 * is not itself in range. There are no tiers to be unbounded.
 *
 * ## Money is exact
 *
 * Amounts and rates arrive and leave as decimal STRINGS and are computed in
 * `bigint`. The result is rounded ONCE, at the rule's scale and mode, and then
 * clamped to the optional floor/ceiling (the database guarantees those carry no
 * more decimals than the scale, so the clamped value is still exact).
 */
import {
  CommissionDecimalError,
  decimalToUnits,
  parseDecimal,
  ratMul,
  roundToUnits,
  unitsToDecimalString,
  type RoundingMode
} from "./hr-commission-decimal";
import {
  MAX_COMMISSION_INTEGER_DIGITS,
  MAX_COMMISSION_UNITS,
  type CommissionCalculation
} from "./hr-commission-types";

/** The terms of a rule version that evaluation reads; nothing else may influence an amount. */
export type CommissionRuleTerms = {
  calculation: CommissionCalculation;
  /** PERCENT: a percentage (`"2.5"` = 2.5 %). */
  rate: string | null;
  /** FIXED: an amount per unit. */
  fixedAmount: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  currencyCode: string;
  roundingMode: RoundingMode;
  roundingScale: number;
};

export type CommissionInput = {
  /** Required for a percent rule: the non-negative amount the percentage applies to. */
  baseAmount?: string;
  /** Required for a fixed rule: a non-negative whole number of units. */
  units?: number;
};

export type CommissionResult = {
  /** Fixed-scale decimal string at the rule's `roundingScale`. */
  amount: string;
  currencyCode: string;
  calculation: CommissionCalculation;
  /** Which bound, if any, replaced the rounded amount. */
  clampedTo: "min" | "max" | null;
};

export class CommissionEvaluationError extends Error {
  constructor(
    readonly code: "INPUT_INVALID" | "RULE_INVALID",
    message: string
  ) {
    super(message);
    this.name = "CommissionEvaluationError";
  }
}

function parseOrThrow(
  raw: unknown,
  code: "INPUT_INVALID" | "RULE_INVALID",
  label: string
) {
  try {
    return parseDecimal(raw as string);
  } catch (error) {
    if (error instanceof CommissionDecimalError) {
      throw new CommissionEvaluationError(code, `${label}: ${error.message}`);
    }

    throw error;
  }
}

export function evaluateCommission(
  rule: CommissionRuleTerms,
  input: CommissionInput
): CommissionResult {
  if (
    !Number.isInteger(rule.roundingScale) ||
    rule.roundingScale < 0 ||
    rule.roundingScale > 6
  ) {
    throw new CommissionEvaluationError(
      "RULE_INVALID",
      "roundingScale must be an integer from 0 to 6."
    );
  }

  let exact;

  if (rule.calculation === "percent") {
    if (rule.rate === null || rule.fixedAmount !== null) {
      throw new CommissionEvaluationError(
        "RULE_INVALID",
        "A percent rule has a rate and no fixed amount."
      );
    }

    if (input.baseAmount === undefined) {
      throw new CommissionEvaluationError(
        "INPUT_INVALID",
        "baseAmount is required for a percent rule."
      );
    }

    const rate = parseOrThrow(rule.rate, "RULE_INVALID", "rate");
    const base = parseOrThrow(input.baseAmount, "INPUT_INVALID", "baseAmount");

    if (rate.num > 100n * rate.den) {
      throw new CommissionEvaluationError(
        "RULE_INVALID",
        "rate must not exceed 100."
      );
    }

    const product = ratMul(base, rate);

    exact = { num: product.num, den: product.den * 100n };
  } else {
    if (rule.fixedAmount === null || rule.rate !== null) {
      throw new CommissionEvaluationError(
        "RULE_INVALID",
        "A fixed rule has a fixed amount and no rate."
      );
    }

    const units = input.units;

    if (
      typeof units !== "number" ||
      !Number.isInteger(units) ||
      units < 0 ||
      units > MAX_COMMISSION_UNITS
    ) {
      throw new CommissionEvaluationError(
        "INPUT_INVALID",
        `units must be a whole number from 0 to ${MAX_COMMISSION_UNITS}.`
      );
    }

    const fixed = parseOrThrow(rule.fixedAmount, "RULE_INVALID", "fixedAmount");

    exact = { num: fixed.num * BigInt(units), den: fixed.den };
  }

  const scale = rule.roundingScale;
  let units = roundToUnits(exact, scale, rule.roundingMode);

  // The product of two in-range inputs is not itself in range (a fixed amount
  // of 999,999,999,999 x 1,000,000 units is 10^18): refuse a result the stored
  // numeric(18, 6) could not hold, rather than hand a caller an amount no
  // ledger row can carry.
  const limit = 10n ** BigInt(MAX_COMMISSION_INTEGER_DIGITS + scale);

  if (units >= limit || units <= -limit) {
    throw new CommissionEvaluationError(
      "INPUT_INVALID",
      `The commission must be below 10^${MAX_COMMISSION_INTEGER_DIGITS}.`
    );
  }
  let clampedTo: "min" | "max" | null = null;

  try {
    if (rule.minAmount !== null) {
      const floor = decimalToUnits(rule.minAmount, scale);

      if (units < floor) {
        units = floor;
        clampedTo = "min";
      }
    }

    if (rule.maxAmount !== null) {
      const ceiling = decimalToUnits(rule.maxAmount, scale);

      if (units > ceiling) {
        units = ceiling;
        clampedTo = "max";
      }
    }
  } catch (error) {
    if (error instanceof CommissionDecimalError) {
      throw new CommissionEvaluationError(
        "RULE_INVALID",
        `A floor or ceiling is not representable at scale ${scale}.`
      );
    }

    throw error;
  }

  return {
    amount: unitsToDecimalString(units, scale),
    currencyCode: rule.currencyCode,
    calculation: rule.calculation,
    clampedTo
  };
}

export type RuleWindow = {
  id: string;
  ruleKey: string;
  status: string;
  /** `YYYY-MM-DD`, inclusive. */
  effectiveFrom: string;
  /** `YYYY-MM-DD`, EXCLUSIVE; `null` = open-ended. */
  effectiveTo: string | null;
};

export type RuleSelection<T extends RuleWindow> =
  | { outcome: "ok"; rule: T }
  | { outcome: "none" }
  | { outcome: "ambiguous"; ids: string[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The published version of `ruleKey` in force on `occurredOn`. `ambiguous` can
 * only happen if the database's no-overlap trigger was bypassed; it is reported,
 * never guessed at, because a wrong rule pays the wrong person.
 */
export function selectEffectiveRule<T extends RuleWindow>(
  rules: readonly T[],
  ruleKey: string,
  occurredOn: string
): RuleSelection<T> {
  if (!DATE_PATTERN.test(occurredOn)) {
    throw new CommissionEvaluationError(
      "INPUT_INVALID",
      "occurredOn must be a YYYY-MM-DD date."
    );
  }

  const matches = rules.filter(
    (rule) =>
      rule.ruleKey === ruleKey &&
      rule.status === "published" &&
      rule.effectiveFrom <= occurredOn &&
      (rule.effectiveTo === null || occurredOn < rule.effectiveTo)
  );

  if (matches.length === 0) {
    return { outcome: "none" };
  }

  if (matches.length > 1) {
    return { outcome: "ambiguous", ids: matches.map((rule) => rule.id) };
  }

  return { outcome: "ok", rule: matches[0]! };
}
