/**
 * Exact decimal arithmetic for commission evaluation (Issue #950, ADR-0132).
 *
 * ## No floating point, anywhere
 *
 * Every amount and rate is a `bigint` numerator over a power-of-ten `bigint`
 * denominator, parsed from a decimal STRING. A JSON number has already been
 * through a float before it reaches us, so validation refuses one; a commission
 * of `1.005` must round on the boundary it actually sits on, not on
 * `1.00499999999999989…`.
 *
 * Pure, dependency-free, deterministic. This is deliberately a small, separate
 * copy of the idea in `tax/domain/decimal.ts` rather than an import of it: this
 * module declares no dependency on `tax`, and lifting both into `_shared` is a
 * recorded follow-up (README).
 */

export const ROUNDING_MODES = [
  "half_up",
  "half_down",
  "half_even",
  "up",
  "down",
  "ceiling",
  "floor"
] as const;

export type RoundingMode = (typeof ROUNDING_MODES)[number];

export function isRoundingMode(value: unknown): value is RoundingMode {
  return (
    typeof value === "string" &&
    (ROUNDING_MODES as readonly string[]).includes(value)
  );
}

export class CommissionDecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommissionDecimalError";
  }
}

/** `num / den`, `den > 0`. */
export type Rational = { readonly num: bigint; readonly den: bigint };

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/** The widest fraction a stored column can hold (`numeric(*, 6)`). */
export const MAX_FRACTION_DIGITS = 6;
/** Integer digits allowed, so the largest amount is below 10^18. */
export const MAX_INTEGER_DIGITS = 12;

/**
 * Parses a plain decimal string (`"12"`, `"0.5"`, `"-3.25"`): no exponent, no
 * sign other than a leading minus, no whitespace, no JS number.
 */
export function parseDecimal(
  raw: string,
  options: {
    maxFractionDigits?: number;
    maxIntegerDigits?: number;
    allowNegative?: boolean;
  } = {}
): Rational {
  const match = typeof raw === "string" ? DECIMAL_PATTERN.exec(raw) : null;

  if (!match) {
    throw new CommissionDecimalError("Not a plain decimal string.");
  }

  const [, minus, integerPart = "", fractionPart = ""] = match;

  if (minus && !options.allowNegative) {
    throw new CommissionDecimalError("Must not be negative.");
  }

  if (
    fractionPart.length > (options.maxFractionDigits ?? MAX_FRACTION_DIGITS)
  ) {
    throw new CommissionDecimalError("Too many fractional digits.");
  }

  if (integerPart.length > (options.maxIntegerDigits ?? MAX_INTEGER_DIGITS)) {
    throw new CommissionDecimalError("Too large.");
  }

  const magnitude = BigInt(`${integerPart}${fractionPart}`);

  return {
    num: minus ? -magnitude : magnitude,
    den: 10n ** BigInt(fractionPart.length)
  };
}

export function ratMul(a: Rational, b: Rational): Rational {
  return { num: a.num * b.num, den: a.den * b.den };
}

/**
 * Rounds `value * 10^scale` to an integer and returns those UNITS (`scale = 2`,
 * `12.345` -> `1235n` under `half_up`). `half_*` modes are symmetric about zero
 * (they round the magnitude); `up`/`down` are away-from/toward zero;
 * `ceiling`/`floor` are toward +/- infinity.
 */
export function roundToUnits(
  value: Rational,
  scale: number,
  mode: RoundingMode
): bigint {
  const numerator = value.num * 10n ** BigInt(scale);
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / value.den;
  const remainder = magnitude % value.den;

  let increment = false;

  if (remainder !== 0n) {
    const twice = remainder * 2n;

    switch (mode) {
      case "up":
        increment = true;
        break;
      case "down":
        increment = false;
        break;
      case "half_up":
        increment = twice >= value.den;
        break;
      case "half_down":
        increment = twice > value.den;
        break;
      case "half_even":
        increment =
          twice > value.den || (twice === value.den && quotient % 2n === 1n);
        break;
      case "ceiling":
        increment = !negative;
        break;
      case "floor":
        increment = negative;
        break;
    }
  }

  const rounded = quotient + (increment ? 1n : 0n);

  return negative ? -rounded : rounded;
}

/** Integer `units` at `scale` places, as a fixed-scale decimal string. */
export function unitsToDecimalString(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units)
    .toString()
    .padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);

  return `${negative ? "-" : ""}${scale > 0 ? `${whole}.${fraction}` : whole}`;
}

/** A decimal string's value as integer units at `scale` (exact; the string must fit). */
export function decimalToUnits(raw: string, scale: number): bigint {
  const parsed = parseDecimal(raw, { maxFractionDigits: scale });

  return (parsed.num * 10n ** BigInt(scale)) / parsed.den;
}
