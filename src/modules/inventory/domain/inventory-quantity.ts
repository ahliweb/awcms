/**
 * Exact decimal quantities for the stock ledger (Issue #887, ADR-0126).
 *
 * Quantities are `numeric(20,6)` in the database and DECIMAL STRINGS on the
 * wire and in memory — never `number`. A JS float cannot represent `0.1`
 * exactly, and a ledger whose sums drift in the seventh decimal fails the very
 * reconciliation it exists to pass.
 *
 * The arithmetic here is deliberately tiny: parse, negate, sign. All summing
 * happens in SQL (`numeric`), so there is no JS addition to get wrong. Values
 * are held internally as a `BigInt` count of millionths.
 */

/** Digits to the right of the point — `numeric(20,6)`. */
export const QUANTITY_SCALE = 6;

const SCALE_FACTOR = 10n ** BigInt(QUANTITY_SCALE);

// Optional sign, integer part (<= 14 digits: 20 total minus 6 fractional),
// optional fraction of 1-6 digits. No exponent notation: `1e-7` is exactly the
// form a float round-trip produces, so refusing it keeps float residue out.
const QUANTITY_PATTERN = /^(-)?(\d{1,14})(?:\.(\d{1,6}))?$/;

/** Parses to millionths, or `null` when the text is not a valid quantity. */
export function parseQuantityUnits(value: string): bigint | null {
  const match = QUANTITY_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const [, sign, integerPart, fractionPart = ""] = match;
  const units =
    BigInt(integerPart!) * SCALE_FACTOR +
    BigInt(fractionPart.padEnd(QUANTITY_SCALE, "0"));

  return sign ? -units : units;
}

/** Canonical text for a count of millionths: no trailing zeros, no `-0`. */
export function formatQuantityUnits(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const integerPart = absolute / SCALE_FACTOR;
  const fractionPart = (absolute % SCALE_FACTOR)
    .toString()
    .padStart(QUANTITY_SCALE, "0")
    .replace(/0+$/, "");
  const text =
    fractionPart.length > 0
      ? `${integerPart}.${fractionPart}`
      : `${integerPart}`;

  return negative && absolute !== 0n ? `-${text}` : text;
}

/**
 * Accepts what a JSON client sends — a decimal string, or a number that
 * round-trips to a plain decimal — and returns the canonical text, or `null`.
 *
 * Numbers are accepted because `{"quantity": 3}` is what most clients write, but
 * only when `String(n)` is already a plain decimal: `1e-7` and `1e21` stringify
 * in exponent form and are refused rather than reinterpreted.
 */
export function normalizeQuantityInput(value: unknown): string | null {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : null;

  if (text === null) {
    return null;
  }

  const units = parseQuantityUnits(text);

  return units === null ? null : formatQuantityUnits(units);
}

export function quantitySign(value: string): -1 | 0 | 1 {
  const units = parseQuantityUnits(value);

  if (units === null || units === 0n) {
    return 0;
  }

  return units < 0n ? -1 : 1;
}

/** Negation of a canonical quantity string. Throws on junk — a bug, not input. */
export function negateQuantity(value: string): string {
  const units = parseQuantityUnits(value);

  if (units === null) {
    throw new Error(`Not a quantity: ${value}`);
  }

  return formatQuantityUnits(-units);
}
