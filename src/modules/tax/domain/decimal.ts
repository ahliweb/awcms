/**
 * Exact decimal arithmetic for the tax calculator (ADR-0127).
 *
 * ## No floating point, anywhere
 *
 * Every amount, quantity and rate in this module is a `bigint` numerator over a
 * `bigint` denominator. A JavaScript `number` never carries money: `0.1 + 0.2`
 * is the example everyone knows, but the failure that matters here is rounding
 * a tax of `1.005` — which a float stores as `1.00499999999999989…` and rounds
 * DOWN under half-up, on exactly the boundary a regulator tests.
 *
 * ## Why a rational and not a scaled integer
 *
 * Exclusive pricing needs only multiplication, which a scaled integer handles.
 * Inclusive pricing needs the net back out of a gross — `gross / (1 + rate)` —
 * and that quotient is not a decimal (`111 / 1.11` is, but `100 / 1.11` is
 * `90.09009…`). A rational represents it exactly, defers rounding to the one
 * place the rounding rule says to round, and means no intermediate step can
 * round twice.
 *
 * Pure, dependency-free, deterministic: same input, same output, on any
 * machine, in any year.
 */

/** `num / den`, with `den > 0`. Not required to be reduced. */
export type Rational = { readonly num: bigint; readonly den: bigint };

/**
 * `half_up` / `half_down` are symmetric about zero (they round the MAGNITUDE),
 * so `-2.5` rounds to `-3` under `half_up`. `up` / `down` are away-from-zero /
 * toward-zero; `ceiling` / `floor` are toward ±infinity and are the only modes
 * that treat a negative differently from its positive twin.
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

export class TaxDecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxDecimalError";
  }
}

export const ZERO: Rational = { num: 0n, den: 1n };
export const ONE: Rational = { num: 1n, den: 1n };

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;

  while (y !== 0n) {
    [x, y] = [y, x % y];
  }

  return x;
}

export function ratNormalize(value: Rational): Rational {
  if (value.den === 0n) throw new TaxDecimalError("Division by zero.");

  const sign = value.den < 0n ? -1n : 1n;
  const divisor = gcd(value.num, value.den) || 1n;

  return {
    num: (sign * value.num) / divisor,
    den: (sign * value.den) / divisor
  };
}

export function ratFromInt(value: bigint): Rational {
  return { num: value, den: 1n };
}

export function ratAdd(a: Rational, b: Rational): Rational {
  return ratNormalize({
    num: a.num * b.den + b.num * a.den,
    den: a.den * b.den
  });
}

export function ratSub(a: Rational, b: Rational): Rational {
  return ratNormalize({
    num: a.num * b.den - b.num * a.den,
    den: a.den * b.den
  });
}

export function ratMul(a: Rational, b: Rational): Rational {
  return ratNormalize({ num: a.num * b.num, den: a.den * b.den });
}

export function ratDiv(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new TaxDecimalError("Division by zero.");

  return ratNormalize({ num: a.num * b.den, den: a.den * b.num });
}

export function ratCompare(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.num * b.den;
  const right = b.num * a.den;

  return left < right ? -1 : left > right ? 1 : 0;
}

export function ratIsZero(value: Rational): boolean {
  return value.num === 0n;
}

export function ratSum(values: readonly Rational[]): Rational {
  return values.reduce(ratAdd, ZERO);
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

export type ParseDecimalOptions = {
  /** Digits allowed after the point. Input with more is REFUSED, never truncated. */
  maxFractionDigits: number;
  allowNegative?: boolean;
  /** Digits allowed before the point; bounds the magnitude a caller can send. */
  maxIntegerDigits?: number;
};

/**
 * Parses a plain decimal string (`"10"`, `"10.50"`, `"-0.5"`).
 *
 * Deliberately strict: no exponent, no leading `+`, no thousands separators, no
 * surrounding whitespace, no JS number. An amount that arrived as a JSON
 * `number` has already been through a float, so callers refuse non-strings
 * before reaching here (see `tax-validation.ts`).
 */
export function parseDecimal(
  raw: string,
  options: ParseDecimalOptions
): Rational {
  const match = DECIMAL_PATTERN.exec(raw);

  if (!match) {
    throw new TaxDecimalError(`"${raw}" is not a plain decimal string.`);
  }

  const [, minus, integerPart = "", fractionPart = ""] = match;

  if (minus && !options.allowNegative) {
    throw new TaxDecimalError(`"${raw}" must not be negative.`);
  }

  if (fractionPart.length > options.maxFractionDigits) {
    throw new TaxDecimalError(
      `"${raw}" has more than ${options.maxFractionDigits} fractional digits.`
    );
  }

  if (integerPart.length > (options.maxIntegerDigits ?? 18)) {
    throw new TaxDecimalError(`"${raw}" is too large.`);
  }

  const magnitude = BigInt(`${integerPart}${fractionPart}`);

  return {
    num: minus ? -magnitude : magnitude,
    den: pow10(fractionPart.length)
  };
}

/**
 * Rounds `value * 10^scale` to an integer — i.e. to `scale` decimal places —
 * and returns those integer UNITS (so `scale = 2` and `12.345` give `1235n`
 * under `half_up`).
 */
export function roundToUnits(
  value: Rational,
  scale: number,
  mode: RoundingMode
): bigint {
  const scaled = ratNormalize({
    num: value.num * pow10(scale),
    den: value.den
  });
  const negative = scaled.num < 0n;
  const magnitude = negative ? -scaled.num : scaled.num;
  const quotient = magnitude / scaled.den;
  const remainder = magnitude % scaled.den;

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
        increment = twice >= scaled.den;
        break;
      case "half_down":
        increment = twice > scaled.den;
        break;
      case "half_even":
        increment =
          twice > scaled.den || (twice === scaled.den && quotient % 2n === 1n);
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

/** Integer `units` at `scale` decimal places, as a fixed-scale decimal string. */
export function unitsToDecimalString(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString();

  if (scale === 0) return `${negative ? "-" : ""}${digits}`;

  const padded = digits.padStart(scale + 1, "0");
  const integerPart = padded.slice(0, padded.length - scale);
  const fractionPart = padded.slice(padded.length - scale);

  return `${negative ? "-" : ""}${integerPart}.${fractionPart}`;
}

/** The exact rational for `units` at `scale` decimal places. */
export function unitsToRational(units: bigint, scale: number): Rational {
  return ratNormalize({ num: units, den: pow10(scale) });
}

/**
 * Converts an exact rational to `scale` units, REFUSING any value that does not
 * land exactly on one. Used where a stored amount is read back: an amount that
 * does not fit its own scale means the row was written by something other than
 * this calculator, and silently rounding it would hide that.
 */
export function rationalToExactUnits(value: Rational, scale: number): bigint {
  const scaled = ratNormalize({
    num: value.num * pow10(scale),
    den: value.den
  });

  if (scaled.den !== 1n) {
    throw new TaxDecimalError(
      `Value is not representable at ${scale} decimal places.`
    );
  }

  return scaled.num;
}

/**
 * An exact rational as a plain decimal string with trailing zeros removed
 * ("2.5", not "2.500000"). Refuses a value that needs more than `maxFractionDigits`.
 */
export function rationalToTrimmedDecimal(
  value: Rational,
  maxFractionDigits: number
): string {
  const text = unitsToDecimalString(
    rationalToExactUnits(value, maxFractionDigits),
    maxFractionDigits
  );

  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * Splits `total` integer units across `weights` so the parts sum to EXACTLY
 * `total`, in proportion to the weights (largest-remainder method).
 *
 * This is what keeps a document's lines adding up to the document: rounding each
 * line independently can leave a unit of drift that nobody can attribute, and a
 * tax authority reconciles totals, not lines.
 *
 * Ties on the fractional remainder go to the LOWER index, so the result is a
 * function of the inputs alone — never of sort stability or iteration order.
 * Weights and `total` must be non-negative.
 */
export function apportion(
  total: bigint,
  weights: readonly Rational[]
): bigint[] {
  if (total < 0n)
    throw new TaxDecimalError("Cannot apportion a negative total.");

  if (weights.length === 0) {
    if (total === 0n) return [];
    throw new TaxDecimalError("Nothing to apportion the total across.");
  }

  for (const weight of weights) {
    if (weight.num < 0n) {
      throw new TaxDecimalError("Apportionment weights must not be negative.");
    }
  }

  const weightSum = ratSum(weights);

  if (ratIsZero(weightSum)) {
    if (total === 0n) return weights.map(() => 0n);
    throw new TaxDecimalError(
      "Cannot apportion a non-zero total across zero weight."
    );
  }

  const shares = weights.map((weight) =>
    ratMul(ratFromInt(total), ratDiv(weight, weightSum))
  );
  const floors = shares.map((share) => share.num / share.den);
  const fractions = shares.map((share, index) => ({
    index,
    fraction: ratSub(share, ratFromInt(floors[index]!))
  }));

  let remaining = total - floors.reduce((sum, value) => sum + value, 0n);

  fractions.sort((a, b) => {
    const order = ratCompare(b.fraction, a.fraction);

    return order !== 0 ? order : a.index - b.index;
  });

  const result = [...floors];

  for (const entry of fractions) {
    if (remaining <= 0n) break;
    result[entry.index] = result[entry.index]! + 1n;
    remaining -= 1n;
  }

  return result;
}
