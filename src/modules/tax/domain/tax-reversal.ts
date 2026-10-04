/**
 * Return / refund reversal, computed from the ORIGINAL snapshot (ADR-0127).
 *
 * ## Why this never consults a rule
 *
 * A refund issued today for a sale made last March must reverse the tax that was
 * CHARGED in March, whatever the rate is now and even if the rule version has
 * since been replaced. So this function takes the snapshot's own recorded
 * amounts and quantities and nothing else — it has no access to the rule tables
 * and no parameter that could carry a current rate. The guarantee is
 * structural: there is nothing here to get wrong.
 *
 * ## Partial reversals never over-refund
 *
 * A reversal of `q` of `Q` units takes `q/Q` of the line's net and of each
 * component's tax, rounded with the snapshot's own mode and scale. Two safety
 * properties hold regardless of how the rounding falls:
 *
 * - each amount is capped at what has not been reversed yet, so no sequence of
 *   partial reversals can refund more than was charged;
 * - the reversal that takes the LAST of a line's quantity takes the exact
 *   REMAINDER rather than a rounded ratio, so fully reversing a line in any
 *   number of steps refunds precisely what was charged — not a unit more or
 *   less.
 *
 * Amounts in the result are NEGATIVE (a reversal is a negative document); the
 * quantity is the positive quantity returned.
 */
import {
  TaxDecimalError,
  parseDecimal,
  ratCompare,
  ratDiv,
  ratFromInt,
  ratMul,
  ratSub,
  rationalToExactUnits,
  rationalToTrimmedDecimal,
  roundToUnits,
  unitsToDecimalString,
  type Rational,
  type RoundingMode
} from "./decimal";
import { QUANTITY_FRACTION_DIGITS } from "./tax-calculator";
import {
  TaxCalculationError,
  TREATMENTS,
  type TaxComponentResult,
  type TaxComponentTotal,
  type TaxLineResult,
  type TaxTreatmentTotal,
  type Treatment
} from "./tax-types";

export type ReversalLineResult = TaxLineResult & {
  /** `lineRef` of the line on the original sale this reverses. */
  originalLineRef: string;
};

export type ReversalRequestLine = {
  lineRef: string;
  /** Positive quantity being returned. */
  quantity: string;
};

/** What previous reversals of the same original have already taken, per line. */
export type ReversedSoFar = {
  quantity: Rational;
  netUnits: bigint;
  componentUnits: Map<string, bigint>;
};

export type ReversalInput = {
  roundingMode: RoundingMode;
  roundingScale: number;
  originalLines: readonly TaxLineResult[];
  /** Keyed by the ORIGINAL line's `lineRef`; absent means nothing reversed yet. */
  reversedSoFar: ReadonlyMap<string, ReversedSoFar>;
  /** Omitted: reverse everything that has not been reversed yet. */
  requested?: readonly ReversalRequestLine[];
};

export type ReversalResult = {
  lines: ReversalLineResult[];
  netTotal: string;
  taxTotal: string;
  grossTotal: string;
  componentTotals: TaxComponentTotal[];
  treatmentTotals: TaxTreatmentTotal[];
};

function reject(message: string): never {
  throw new TaxCalculationError("TAX_REVERSAL_INVALID", message);
}

function readUnits(value: string, scale: number): bigint {
  try {
    return rationalToExactUnits(
      parseDecimal(value, {
        maxFractionDigits: scale,
        allowNegative: true,
        maxIntegerDigits: 24
      }),
      scale
    );
  } catch (error) {
    if (error instanceof TaxDecimalError) {
      throw new TaxCalculationError(
        "TAX_REVERSAL_INVALID",
        `A stored amount does not fit the snapshot's own scale: ${error.message}`
      );
    }
    throw error;
  }
}

export function computeReversal(input: ReversalInput): ReversalResult {
  const { roundingMode: mode, roundingScale: scale } = input;
  const originalByRef = new Map(
    input.originalLines.map((line) => [line.lineRef, line])
  );

  if (input.requested) {
    if (input.requested.length === 0) reject("At least one line is required.");

    const seen = new Set<string>();

    for (const entry of input.requested) {
      if (!originalByRef.has(entry.lineRef)) {
        reject(`Line "${entry.lineRef}" is not on the original document.`);
      }
      if (seen.has(entry.lineRef)) {
        reject(`Line "${entry.lineRef}" is listed more than once.`);
      }
      seen.add(entry.lineRef);
    }
  }

  const targets: { original: TaxLineResult; quantity: Rational | null }[] =
    input.requested
      ? input.requested.map((entry) => {
          let quantity: Rational;

          try {
            quantity = parseDecimal(entry.quantity, {
              maxFractionDigits: QUANTITY_FRACTION_DIGITS
            });
          } catch (error) {
            if (error instanceof TaxDecimalError) {
              reject(`Line "${entry.lineRef}": ${error.message}`);
            }
            throw error;
          }

          return { original: originalByRef.get(entry.lineRef)!, quantity };
        })
      : input.originalLines.map((original) => ({ original, quantity: null }));

  const lines: ReversalLineResult[] = [];
  const componentTotalUnits = new Map<
    string,
    { name: string; units: bigint }
  >();
  const treatmentUnits = new Map<Treatment, { net: bigint; tax: bigint }>();
  let netTotal = 0n;
  let taxTotal = 0n;

  for (const { original, quantity: requestedQuantity } of targets) {
    const originalQuantity = parseDecimal(original.quantity, {
      maxFractionDigits: QUANTITY_FRACTION_DIGITS
    });
    const prior = input.reversedSoFar.get(original.lineRef);
    const remainingQuantity = ratSub(
      originalQuantity,
      prior?.quantity ?? ratFromInt(0n)
    );

    // Full-document reversal skips a line that is already fully returned
    // instead of failing the whole request on it.
    if (requestedQuantity === null && remainingQuantity.num <= 0n) continue;

    const quantity = requestedQuantity ?? remainingQuantity;

    if (quantity.num <= 0n) {
      reject(`Line "${original.lineRef}": quantity must be greater than zero.`);
    }
    if (ratCompare(quantity, remainingQuantity) > 0) {
      reject(
        `Line "${original.lineRef}": cannot return more than was sold and not yet returned.`
      );
    }

    const isRemainder = ratCompare(quantity, remainingQuantity) === 0;
    const ratio = ratDiv(quantity, originalQuantity);
    const take = (originalUnits: bigint, priorUnits: bigint): bigint => {
      const remaining = originalUnits - priorUnits;

      if (isRemainder) return remaining;

      const proportional = roundToUnits(
        ratMul(ratFromInt(originalUnits), ratio),
        0,
        mode
      );

      return proportional > remaining ? remaining : proportional;
    };

    const netUnits = take(
      readUnits(original.netAmount, scale),
      prior?.netUnits ?? 0n
    );
    let runningTax = 0n;
    const components: TaxComponentResult[] = original.components.map(
      (component) => {
        const units = take(
          readUnits(component.taxAmount, scale),
          prior?.componentUnits.get(component.code) ?? 0n
        );
        const base =
          component.basis === "cumulative" ? netUnits + runningTax : netUnits;

        runningTax += units;

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
          taxableBase: unitsToDecimalString(-base, scale),
          taxAmount: unitsToDecimalString(-units, scale)
        };
      }
    );

    const treatment = treatmentUnits.get(original.treatment) ?? {
      net: 0n,
      tax: 0n
    };

    treatmentUnits.set(original.treatment, {
      net: treatment.net + netUnits,
      tax: treatment.tax + runningTax
    });
    netTotal += netUnits;
    taxTotal += runningTax;

    lines.push({
      lineNo: lines.length + 1,
      lineRef: original.lineRef,
      originalLineRef: original.lineRef,
      categoryCode: original.categoryCode,
      treatment: original.treatment,
      quantity: rationalToTrimmedDecimal(quantity, QUANTITY_FRACTION_DIGITS),
      unitPrice: original.unitPrice,
      discount: original.discount,
      netAmount: unitsToDecimalString(-netUnits, scale),
      taxAmount: unitsToDecimalString(-runningTax, scale),
      grossAmount: unitsToDecimalString(-(netUnits + runningTax), scale),
      components
    });
  }

  if (lines.length === 0) {
    reject("Nothing is left to reverse on the original document.");
  }

  return {
    lines,
    netTotal: unitsToDecimalString(-netTotal, scale),
    taxTotal: unitsToDecimalString(-taxTotal, scale),
    grossTotal: unitsToDecimalString(-(netTotal + taxTotal), scale),
    componentTotals: [...componentTotalUnits].map(([code, entry]) => ({
      code,
      name: entry.name,
      taxAmount: unitsToDecimalString(-entry.units, scale)
    })),
    treatmentTotals: TREATMENTS.filter((value) =>
      treatmentUnits.has(value)
    ).map((value) => {
      const entry = treatmentUnits.get(value)!;

      return {
        treatment: value,
        netAmount: unitsToDecimalString(-entry.net, scale),
        taxAmount: unitsToDecimalString(-entry.tax, scale),
        grossAmount: unitsToDecimalString(-(entry.net + entry.tax), scale)
      };
    })
  };
}
