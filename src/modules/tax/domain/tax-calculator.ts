/**
 * The tax calculator (ADR-0127) — ONE pure function that every quote, POS and
 * storefront caller reaches through the API.
 *
 * ## Contract
 *
 * `calculateTax(version, lines)` is a function of its arguments and nothing
 * else: no clock, no database, no locale, no randomness, no floating point. The
 * same rule version and the same lines return the byte-identical result on any
 * machine, which is what lets a stored snapshot be recomputed and compared
 * years later, and what lets an offline client embed this file and agree with
 * the server.
 *
 * ## The algorithm, in the order it runs
 *
 * 1. Each line's amount is `quantity x unitPrice - discount`, computed
 *    EXACTLY and rounded once to the version's scale. That figure is the line's
 *    NET under exclusive pricing and its GROSS under inclusive pricing.
 * 2. The line's rule is the one for its category, else the fallback rule
 *    (`categoryCode: null`), else the calculation is refused — a line the rules
 *    do not cover is never silently treated as untaxed.
 * 3. Each rule is reduced to FACTORS: component `c` contributes `k_c`, a
 *    fraction of net. A `net` component is `rate`; a `cumulative` one is
 *    `rate x (1 + sum of earlier k)`. Total factor `K = 1 + sum k`.
 * 4. Exclusive: `tax_c = net x k_c`. Inclusive: `net = gross / K`, then
 *    `tax_c = net x k_c`. All exact rationals — nothing is rounded yet.
 * 5. Rounding happens ONCE, at the level the version names:
 *    - `line`: each line's tax is rounded alone (inclusive: the net is rounded,
 *      the tax is `gross - net`, and is split across components so the parts
 *      still sum to it);
 *    - `document`: each component's exact tax is summed over the document,
 *      rounded once, and apportioned back to lines by largest remainder.
 *    Either way a line's `net + tax = gross` and the document equals the sum of
 *    its lines, to the last unit.
 *
 * See `docs/awcms/tax-calculation.md` for worked examples of every branch.
 */
import {
  ONE,
  ZERO,
  TaxDecimalError,
  apportion,
  parseDecimal,
  ratAdd,
  ratDiv,
  ratFromInt,
  ratMul,
  ratSum,
  roundToUnits,
  unitsToDecimalString,
  type Rational,
  type RoundingMode
} from "./decimal";
import {
  TaxCalculationError,
  TREATMENTS,
  type PricingMode,
  type ResolvedTaxRuleVersion,
  type TaxCalculation,
  type TaxComponentResult,
  type TaxComponentRule,
  type TaxComponentTotal,
  type TaxLineInput,
  type TaxLineResult,
  type TaxRule,
  type TaxRuleDefinition,
  type TaxTreatmentTotal,
  type Treatment
} from "./tax-types";

export const MAX_TAX_LINES = 500;
export const QUANTITY_FRACTION_DIGITS = 6;
export const PRICE_FRACTION_DIGITS = 6;
export const RATE_FRACTION_DIGITS = 6;
/** Percent. Generous enough for any real levy, tight enough to catch "1100". */
export const MAX_RATE_PERCENT = 1000;

const PERCENT_DENOMINATOR: Rational = { num: 100n, den: 1n };

export function parseRatePercent(raw: string): Rational {
  const percent = parseDecimal(raw, {
    maxFractionDigits: RATE_FRACTION_DIGITS,
    maxIntegerDigits: 4
  });

  if (percent.num > BigInt(MAX_RATE_PERCENT) * percent.den) {
    throw new TaxDecimalError(
      `Rate "${raw}" exceeds ${MAX_RATE_PERCENT} percent.`
    );
  }

  return ratDiv(percent, PERCENT_DENOMINATOR);
}

/** The fraction of net each component adds, in declaration order. */
export function componentFactors(
  components: readonly TaxComponentRule[]
): Rational[] {
  const factors: Rational[] = [];
  let accumulated = ZERO;

  for (const component of components) {
    const rate = parseRatePercent(component.rate);
    const factor =
      component.basis === "cumulative"
        ? ratMul(rate, ratAdd(ONE, accumulated))
        : rate;

    factors.push(factor);
    accumulated = ratAdd(accumulated, factor);
  }

  return factors;
}

export function findRule(
  definition: TaxRuleDefinition,
  categoryCode: string | null
): TaxRule {
  const exact =
    categoryCode === null
      ? undefined
      : definition.rules.find((rule) => rule.categoryCode === categoryCode);
  const rule =
    exact ?? definition.rules.find((rule) => rule.categoryCode === null);

  if (!rule) {
    throw new TaxCalculationError(
      "TAX_RULE_NOT_FOUND",
      categoryCode === null
        ? "This rule version has no fallback rule for an uncategorised line."
        : `This rule version has no rule for category "${categoryCode}" and no fallback rule.`
    );
  }

  return rule;
}

type PreparedLine = {
  input: TaxLineInput;
  discount: string;
  rule: TaxRule;
  factors: Rational[];
  totalFactor: Rational;
  /** Units: the line's net (exclusive) or gross (inclusive). */
  amountUnits: bigint;
};

function invalid(message: string): never {
  throw new TaxCalculationError("TAX_INPUT_INVALID", message);
}

function prepareLine(
  version: ResolvedTaxRuleVersion,
  input: TaxLineInput
): PreparedLine {
  let amount: Rational;
  const discount = input.discount ?? "0";

  try {
    const quantity = parseDecimal(input.quantity, {
      maxFractionDigits: QUANTITY_FRACTION_DIGITS
    });
    const unitPrice = parseDecimal(input.unitPrice, {
      maxFractionDigits: PRICE_FRACTION_DIGITS
    });
    const discountValue = parseDecimal(discount, {
      maxFractionDigits: PRICE_FRACTION_DIGITS
    });

    if (quantity.num <= 0n)
      invalid(`Line "${input.lineRef}": quantity must be greater than zero.`);

    amount = ratAdd(ratMul(quantity, unitPrice), {
      num: -discountValue.num,
      den: discountValue.den
    });
  } catch (error) {
    if (error instanceof TaxDecimalError) {
      invalid(`Line "${input.lineRef}": ${error.message}`);
    }
    throw error;
  }

  if (amount.num < 0n) {
    invalid(`Line "${input.lineRef}": the discount exceeds the line amount.`);
  }

  const rule = findRule(version.definition, input.categoryCode);
  const factors =
    rule.treatment === "taxable" ? componentFactors(rule.components) : [];

  return {
    input,
    discount,
    rule,
    factors,
    totalFactor: ratAdd(ONE, ratSum(factors)),
    amountUnits: roundToUnits(
      amount,
      version.roundingScale,
      version.roundingMode
    )
  };
}

function toText(units: bigint, scale: number): string {
  return unitsToDecimalString(units, scale);
}

/**
 * Units of net, and of each component's tax, for every line.
 * Indexed `[line][component]`; a line with no components has an empty row.
 */
type Allocation = { net: bigint[]; tax: bigint[][] };

function exactTaxes(
  line: PreparedLine,
  pricingMode: PricingMode
): { netExact: Rational; taxExact: Rational[] } {
  const netExact =
    pricingMode === "inclusive"
      ? ratDiv(ratFromInt(line.amountUnits), line.totalFactor)
      : ratFromInt(line.amountUnits);

  return {
    netExact,
    taxExact: line.factors.map((factor) => ratMul(netExact, factor))
  };
}

function allocateByLine(
  lines: readonly PreparedLine[],
  pricingMode: PricingMode,
  mode: RoundingMode
): Allocation {
  const net: bigint[] = [];
  const tax: bigint[][] = [];

  for (const line of lines) {
    const { netExact, taxExact } = exactTaxes(line, pricingMode);

    if (pricingMode === "exclusive") {
      net.push(line.amountUnits);
      tax.push(taxExact.map((exact) => roundToUnits(exact, 0, mode)));
      continue;
    }

    const roundedNet = roundToUnits(netExact, 0, mode);

    net.push(roundedNet);
    tax.push(apportion(line.amountUnits - roundedNet, line.factors));
  }

  return { net, tax };
}

function allocateByDocument(
  lines: readonly PreparedLine[],
  pricingMode: PricingMode,
  mode: RoundingMode
): Allocation {
  const exact = lines.map((line) => exactTaxes(line, pricingMode));

  // Component codes in order of first appearance — a function of the input
  // order alone, so the apportionment below cannot depend on a Map's history.
  const codes: string[] = [];

  for (const line of lines) {
    for (const component of line.rule.components.slice(
      0,
      line.factors.length
    )) {
      if (!codes.includes(component.code)) codes.push(component.code);
    }
  }

  const exactFor = (lineIndex: number, code: string): Rational => {
    const line = lines[lineIndex]!;
    const componentIndex = line.rule.components
      .slice(0, line.factors.length)
      .findIndex((component) => component.code === code);

    return componentIndex === -1
      ? ZERO
      : exact[lineIndex]!.taxExact[componentIndex]!;
  };

  const codeExactTotals = codes.map((code) =>
    ratSum(lines.map((_, index) => exactFor(index, code)))
  );

  let codeTotals: bigint[];
  let net: bigint[];

  if (pricingMode === "exclusive") {
    codeTotals = codeExactTotals.map((total) => roundToUnits(total, 0, mode));
    net = lines.map((line) => line.amountUnits);
  } else {
    const grossTotal = lines.reduce((sum, line) => sum + line.amountUnits, 0n);
    const netTotal = roundToUnits(
      ratSum(exact.map((entry) => entry.netExact)),
      0,
      mode
    );

    codeTotals = apportion(grossTotal - netTotal, codeExactTotals);
    net = []; // derived below, once the per-line tax is known
  }

  const perCodeLineTax = codes.map((code, codeIndex) =>
    apportion(
      codeTotals[codeIndex]!,
      lines.map((_, lineIndex) => exactFor(lineIndex, code))
    )
  );

  const tax = lines.map((line, lineIndex) =>
    line.rule.components.slice(0, line.factors.length).map((component) => {
      const codeIndex = codes.indexOf(component.code);

      return perCodeLineTax[codeIndex]![lineIndex]!;
    })
  );

  if (pricingMode === "inclusive") {
    net = lines.map(
      (line, lineIndex) =>
        line.amountUnits -
        tax[lineIndex]!.reduce((sum, value) => sum + value, 0n)
    );
  }

  return { net, tax };
}

/**
 * Integer digits `numeric(24,6)` can hold (`sql/172`): 24 total, 6 after the
 * point. A snapshot figure at or beyond 10^18 would be refused by the database
 * AFTER the whole request had been computed and had passed validation — a 500 for
 * what is plainly a caller's too-large input. It is checked here instead, on every
 * figure that reaches a column or a response, so `/quote` and `/snapshots` give
 * the same 422 for the same input.
 */
export const MAX_AMOUNT_INTEGER_DIGITS = 18;

function assertFits(units: bigint, scale: number, what: string): void {
  const limit = 10n ** BigInt(MAX_AMOUNT_INTEGER_DIGITS + scale);

  if (units >= limit || units <= -limit) {
    invalid(
      `${what} is too large: amounts are limited to ${MAX_AMOUNT_INTEGER_DIGITS} integer digits.`
    );
  }
}

export function calculateTax(
  version: ResolvedTaxRuleVersion,
  lineInputs: readonly TaxLineInput[]
): TaxCalculation {
  if (lineInputs.length === 0) invalid("At least one line is required.");
  if (lineInputs.length > MAX_TAX_LINES) {
    invalid(`At most ${MAX_TAX_LINES} lines are allowed per calculation.`);
  }

  const seen = new Set<string>();

  for (const input of lineInputs) {
    if (seen.has(input.lineRef))
      invalid(`Duplicate lineRef "${input.lineRef}".`);
    seen.add(input.lineRef);
  }

  // The pricing mode is the RULE VERSION's, never the caller's (ADR-0127 §3).
  const pricingMode: PricingMode = version.pricingMode;
  const scale = version.roundingScale;
  const prepared = lineInputs.map((input) => {
    const line = prepareLine(version, input);

    assertFits(line.amountUnits, scale, `Line "${input.lineRef}"`);

    return line;
  });
  const allocation =
    version.roundingLevel === "line"
      ? allocateByLine(prepared, pricingMode, version.roundingMode)
      : allocateByDocument(prepared, pricingMode, version.roundingMode);

  const lines: TaxLineResult[] = [];
  const componentTotalUnits = new Map<
    string,
    { name: string; units: bigint }
  >();
  const treatmentUnits = new Map<Treatment, { net: bigint; tax: bigint }>();
  let netTotal = 0n;
  let taxTotal = 0n;

  prepared.forEach((line, index) => {
    const netUnits = allocation.net[index]!;
    const taxUnits = allocation.tax[index]!;
    const lineTax = taxUnits.reduce((sum, value) => sum + value, 0n);

    if (netUnits < 0n) {
      // Reachable only when an amount of a few smallest units meets several
      // components at once. Refused rather than emitted: a negative net on a
      // sale would flow into every report downstream.
      invalid(
        `Line "${line.input.lineRef}": the amount is too small to carry its tax at ${scale} decimal places.`
      );
    }

    assertFits(netUnits + lineTax, scale, `Line "${line.input.lineRef}"`);

    let runningTax = 0n;
    const components: TaxComponentResult[] = line.rule.components
      .slice(0, line.factors.length)
      .map((component, componentIndex) => {
        const units = taxUnits[componentIndex]!;
        const base =
          component.basis === "cumulative" ? netUnits + runningTax : netUnits;

        runningTax += units;
        assertFits(base, scale, `Line "${line.input.lineRef}"`);

        const total = componentTotalUnits.get(component.code);

        componentTotalUnits.set(component.code, {
          name: total?.name ?? component.name,
          units: (total?.units ?? 0n) + units
        });

        return {
          code: component.code,
          name: component.name,
          rate: component.rate,
          basis: component.basis,
          taxableBase: toText(base, scale),
          taxAmount: toText(units, scale)
        };
      });

    const treatment = treatmentUnits.get(line.rule.treatment) ?? {
      net: 0n,
      tax: 0n
    };

    treatmentUnits.set(line.rule.treatment, {
      net: treatment.net + netUnits,
      tax: treatment.tax + lineTax
    });
    netTotal += netUnits;
    taxTotal += lineTax;

    lines.push({
      lineNo: index + 1,
      lineRef: line.input.lineRef,
      categoryCode: line.input.categoryCode,
      treatment: line.rule.treatment,
      quantity: line.input.quantity,
      unitPrice: line.input.unitPrice,
      discount: line.discount,
      netAmount: toText(netUnits, scale),
      taxAmount: toText(lineTax, scale),
      grossAmount: toText(netUnits + lineTax, scale),
      components
    });
  });

  assertFits(netTotal + taxTotal, scale, "The document total");

  for (const entry of componentTotalUnits.values()) {
    assertFits(entry.units, scale, "A component total");
  }

  const componentTotals: TaxComponentTotal[] = [...componentTotalUnits].map(
    ([code, entry]) => ({
      code,
      name: entry.name,
      taxAmount: toText(entry.units, scale)
    })
  );
  const treatmentTotals: TaxTreatmentTotal[] = TREATMENTS.filter((treatment) =>
    treatmentUnits.has(treatment)
  ).map((treatment) => {
    const entry = treatmentUnits.get(treatment)!;

    return {
      treatment,
      netAmount: toText(entry.net, scale),
      taxAmount: toText(entry.tax, scale),
      grossAmount: toText(entry.net + entry.tax, scale)
    };
  });

  return {
    pricingMode,
    roundingMode: version.roundingMode,
    roundingScale: scale,
    roundingLevel: version.roundingLevel,
    currencyCode: version.currencyCode,
    lines,
    netTotal: toText(netTotal, scale),
    taxTotal: toText(taxTotal, scale),
    grossTotal: toText(netTotal + taxTotal, scale),
    componentTotals,
    treatmentTotals
  };
}
