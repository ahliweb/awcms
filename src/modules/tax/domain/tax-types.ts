/**
 * Shared shapes for the `tax` module (ADR-0127).
 *
 * Every amount here is a DECIMAL STRING ("10.50"), never a JS number — see
 * `decimal.ts`. Rates are PERCENT decimal strings ("11", "7.5", "0.375").
 */
import type { RoundingMode } from "./decimal";

export const PRICING_MODES = ["exclusive", "inclusive"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

/**
 * `line`: each line's tax is rounded on its own and the document total is their
 * sum. `document`: the exact tax of every line is summed per component, rounded
 * ONCE, and that figure is apportioned back across the lines — so the lines
 * still add up to the document, and the document is the correctly rounded
 * figure rather than the sum of N rounding errors.
 */
export const ROUNDING_LEVELS = ["line", "document"] as const;
export type RoundingLevel = (typeof ROUNDING_LEVELS)[number];

/**
 * `taxable`: one or more components apply. `exempt`: outside the tax — no
 * component, nothing to report as tax. `zero_rated`: inside the tax at a rate of
 * nothing — no component either, but a different line on a return, which is why
 * the treatment is recorded per line rather than inferred from a zero amount.
 */
export const TREATMENTS = ["taxable", "exempt", "zero_rated"] as const;
export type Treatment = (typeof TREATMENTS)[number];

/**
 * `net`: the rate applies to the line's net amount. `cumulative`: it applies to
 * the net amount PLUS every earlier component's tax in declaration order — the
 * stacked / compound case (a levy charged on a price that already includes
 * another levy).
 */
export const COMPONENT_BASES = ["net", "cumulative"] as const;
export type ComponentBasis = (typeof COMPONENT_BASES)[number];

export type TaxComponentRule = {
  /** Stable identifier within the rule, e.g. `vat`, `state_levy`. */
  code: string;
  name: string;
  /** Percent, e.g. "11" or "7.5". */
  rate: string;
  basis: ComponentBasis;
};

export type TaxRule = {
  /** `null` is the fallback rule for lines whose category has no rule of its own. */
  categoryCode: string | null;
  treatment: Treatment;
  /** Required non-empty for `taxable`, required empty otherwise. */
  components: TaxComponentRule[];
};

export type TaxCategoryDefinition = {
  code: string;
  name: string;
  description?: string;
};

/** The immutable body of a rule version: what a published version cannot change. */
export type TaxRuleDefinition = {
  categories: TaxCategoryDefinition[];
  rules: TaxRule[];
};

/** Everything the calculator needs to know about a rule version. */
export type ResolvedTaxRuleVersion = {
  ruleVersionId: string | null;
  profileCode: string;
  versionNo: number;
  jurisdictionCode: string;
  currencyCode: string;
  pricingMode: PricingMode;
  roundingMode: RoundingMode;
  /** Decimal places amounts are rounded to, 0..6. */
  roundingScale: number;
  roundingLevel: RoundingLevel;
  definition: TaxRuleDefinition;
};

export type TaxLineInput = {
  /** Caller's own reference for the line; echoed back and the key for reversals. */
  lineRef: string;
  categoryCode: string | null;
  quantity: string;
  unitPrice: string;
  /** Total discount on the line, in currency; `"0"` when absent. */
  discount?: string;
};

export type TaxComponentResult = {
  code: string;
  name: string;
  rate: string;
  basis: ComponentBasis;
  /** The amount this component's rate was applied to. */
  taxableBase: string;
  taxAmount: string;
};

export type TaxLineResult = {
  lineNo: number;
  lineRef: string;
  categoryCode: string | null;
  treatment: Treatment;
  quantity: string;
  unitPrice: string;
  discount: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
  components: TaxComponentResult[];
};

export type TaxComponentTotal = {
  code: string;
  name: string;
  taxAmount: string;
};

export type TaxTreatmentTotal = {
  treatment: Treatment;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
};

export type TaxCalculation = {
  pricingMode: PricingMode;
  roundingMode: RoundingMode;
  roundingScale: number;
  roundingLevel: RoundingLevel;
  currencyCode: string;
  lines: TaxLineResult[];
  netTotal: string;
  taxTotal: string;
  grossTotal: string;
  componentTotals: TaxComponentTotal[];
  treatmentTotals: TaxTreatmentTotal[];
};

export class TaxCalculationError extends Error {
  readonly code:
    | "TAX_RULE_NOT_FOUND"
    | "TAX_INPUT_INVALID"
    | "TAX_DEFINITION_INVALID"
    | "TAX_REVERSAL_INVALID";

  constructor(code: TaxCalculationError["code"], message: string) {
    super(message);
    this.name = "TaxCalculationError";
    this.code = code;
  }
}
