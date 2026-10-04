/**
 * Request validation for the `tax` module (ADR-0127). Pure — no database.
 *
 * ## Strict on purpose
 *
 * Every object here is closed: an unknown key is an ERROR, not ignored. For this
 * module that is a security property, not tidiness. "A client can never submit
 * an authoritative tax amount" is only true if a client that TRIES gets told no —
 * a validator that quietly drops `taxAmount: "0.00"` from a payload would let the
 * caller believe it was honoured, and would let a future refactor start reading
 * it. So a key that looks like a computed money field is refused with its own
 * signal (`clientSuppliedTaxAmount`) that the route maps to a distinct error code.
 *
 * ## Amounts are strings, and numbers are refused
 *
 * A JSON `number` has already been through an IEEE double by the time it reaches
 * code, so `19.99` may not be `19.99`. Quantities, prices, discounts and rates
 * must arrive as strings, and a number in their place is rejected rather than
 * converted.
 */
import { ROUNDING_MODES, TaxDecimalError, parseDecimal } from "./decimal";
import {
  MAX_TAX_LINES,
  PRICE_FRACTION_DIGITS,
  QUANTITY_FRACTION_DIGITS,
  parseRatePercent
} from "./tax-calculator";
import {
  COMPONENT_BASES,
  PRICING_MODES,
  ROUNDING_LEVELS,
  TREATMENTS,
  type PricingMode,
  type TaxLineInput,
  type TaxRuleDefinition
} from "./tax-types";
import { isValidIsoDate } from "./tax-version-resolution";

export type ValidationError = { field: string; message: string };

export type Validated<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      errors: ValidationError[];
      /** True when the payload tried to supply a computed money field. */
      clientSuppliedTaxAmount: boolean;
    };

export const TAX_LIMITS = {
  codeLength: 63,
  nameLength: 120,
  descriptionLength: 500,
  notesLength: 1000,
  documentIdLength: 128,
  lineRefLength: 64,
  reasonLength: 500,
  categories: 200,
  rules: 201,
  componentsPerRule: 8
} as const;

export const CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
const JURISDICTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,62}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const REGION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$/;
/**
 * An opaque identifier charset: letters, digits and `. _ : / -`, starting
 * alphanumeric. No spaces, no control characters, no markup, no non-ASCII — a
 * document id or line reference is a handle the consumer chose, and it lands in
 * audit rows, event payloads and logs, so it must never be able to carry content.
 * The length bound is applied per field by `text()`.
 */
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

/**
 * A key that names a computed money field. Matched on the KEY, not the value: the
 * point is to catch the attempt.
 *
 * Three separately anchored patterns, each tested on its own, so the intent of
 * each is explicit (one alternation mixing anchored and unanchored branches had
 * an ambiguous precedence). A key is a "computed money" attempt when it:
 *
 * 1. STARTS with a money word      — `taxAmount`, `vat`, `total`, `netTotal`;
 * 2. has one after a separator     — `line_total`, `line-tax`;
 * 3. ENDS with a money word, optionally followed by `amount`/`total`/`rate` —
 *    `lineTax`, `grossTotal`, `vatAmount`.
 *
 * This is deliberately conservative, and the only cost of a false positive is the
 * error CODE: a key that is not in the allow-list is refused either way, as
 * `TAX_AMOUNT_NOT_ACCEPTED` when it looks like money and as a plain unrecognised
 * field when it does not. So `rateLimitHint` and `generate` (which end/start with
 * `rate`) are reported as tax-amount attempts; `quantity`, `unitPrice`, `notes`
 * and `colour` are not. Nothing is ever ACCEPTED on the strength of this match.
 */
const MONEY_WORD = "(?:tax|vat|gst|levy|net|gross|total|rate)";
const MONEY_KEY_LEADING = new RegExp(`^${MONEY_WORD}`, "i");
const MONEY_KEY_AFTER_SEPARATOR = new RegExp(`[_-]${MONEY_WORD}`, "i");
const MONEY_KEY_TRAILING = new RegExp(
  `${MONEY_WORD}(?:amount|total|rate)?$`,
  "i"
);

export function looksLikeComputedMoneyKey(key: string): boolean {
  return (
    MONEY_KEY_LEADING.test(key) ||
    MONEY_KEY_AFTER_SEPARATOR.test(key) ||
    MONEY_KEY_TRAILING.test(key)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type Collector = { errors: ValidationError[]; clientTax: boolean };

export function newCollector(): Collector {
  return { errors: [], clientTax: false };
}

function finish<T>(collector: Collector, value: () => T): Validated<T> {
  return collector.errors.length > 0
    ? {
        valid: false,
        errors: collector.errors,
        clientSuppliedTaxAmount: collector.clientTax
      }
    : { valid: true, value: value() };
}

/** Refuses unknown keys; flags computed-money-looking ones separately. */
function closedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  collector: Collector
): void {
  for (const key of Object.keys(record)) {
    if (allowed.includes(key)) continue;

    const field = path === "" ? key : `${path}.${key}`;

    if (looksLikeComputedMoneyKey(key)) {
      collector.clientTax = true;
      collector.errors.push({
        field,
        message: `${field} is not accepted: tax amounts are computed by the server and cannot be supplied.`
      });
    } else {
      collector.errors.push({
        field,
        message: `${field} is not a recognised field.`
      });
    }
  }
}

function text(
  value: unknown,
  field: string,
  collector: Collector,
  options: {
    max: number;
    pattern?: RegExp;
    optional?: boolean;
    exact?: boolean;
  }
): string | null {
  if (value === undefined || value === null) {
    if (!options.optional) {
      collector.errors.push({ field, message: `${field} is required.` });
    }

    return null;
  }

  if (typeof value !== "string") {
    collector.errors.push({ field, message: `${field} must be a string.` });
    return null;
  }

  // An opaque reference is never trimmed: the stored id must be the id sent.
  const trimmed = options.exact ? value : value.trim();

  if (trimmed === "") {
    if (!options.optional) {
      collector.errors.push({ field, message: `${field} must not be empty.` });
    }

    return null;
  }

  if (trimmed.length > options.max) {
    collector.errors.push({
      field,
      message: `${field} must be at most ${options.max} characters.`
    });
    return null;
  }

  if (options.pattern && !options.pattern.test(trimmed)) {
    collector.errors.push({
      field,
      message: `${field} has an invalid format.`
    });
    return null;
  }

  return trimmed;
}

function decimalString(
  value: unknown,
  field: string,
  collector: Collector,
  maxFractionDigits: number
): string | null {
  if (typeof value !== "string") {
    collector.errors.push({
      field,
      message: `${field} must be a decimal string (for example "10.50"), never a number.`
    });
    return null;
  }

  try {
    parseDecimal(value, { maxFractionDigits });
    return value;
  } catch (error) {
    if (error instanceof TaxDecimalError) {
      collector.errors.push({ field, message: `${field}: ${error.message}` });
      return null;
    }
    throw error;
  }
}

function oneOf<T extends string>(
  value: unknown,
  field: string,
  collector: Collector,
  allowed: readonly T[]
): T | null {
  if (
    typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
  ) {
    return value as T;
  }

  collector.errors.push({
    field,
    message: `${field} must be one of: ${allowed.join(", ")}.`
  });
  return null;
}

export function validateTaxDefinition(
  raw: unknown,
  collector: Collector,
  path = "definition"
): TaxRuleDefinition | null {
  if (!isRecord(raw)) {
    collector.errors.push({
      field: path,
      message: `${path} must be an object.`
    });
    return null;
  }

  closedKeys(raw, ["categories", "rules"], path, collector);

  const categories: TaxRuleDefinition["categories"] = [];
  const categoryCodes = new Set<string>();

  if (
    !Array.isArray(raw.categories) ||
    raw.categories.length > TAX_LIMITS.categories
  ) {
    collector.errors.push({
      field: `${path}.categories`,
      message: `categories must be an array of at most ${TAX_LIMITS.categories} entries.`
    });
  } else {
    raw.categories.forEach((entry, index) => {
      const at = `${path}.categories[${index}]`;

      if (!isRecord(entry)) {
        collector.errors.push({
          field: at,
          message: `${at} must be an object.`
        });
        return;
      }

      closedKeys(entry, ["code", "name", "description"], at, collector);

      const code = text(entry.code, `${at}.code`, collector, {
        max: TAX_LIMITS.codeLength,
        pattern: CODE_PATTERN
      });
      const name = text(entry.name, `${at}.name`, collector, {
        max: TAX_LIMITS.nameLength
      });
      const description = text(
        entry.description,
        `${at}.description`,
        collector,
        {
          max: TAX_LIMITS.descriptionLength,
          optional: true
        }
      );

      if (code === null || name === null) return;

      if (categoryCodes.has(code)) {
        collector.errors.push({
          field: `${at}.code`,
          message: `Category code "${code}" is declared more than once.`
        });
        return;
      }

      categoryCodes.add(code);
      categories.push({
        code,
        name,
        ...(description === null ? {} : { description })
      });
    });
  }

  const rules: TaxRuleDefinition["rules"] = [];
  const ruleCategories = new Set<string | null>();

  if (
    !Array.isArray(raw.rules) ||
    raw.rules.length === 0 ||
    raw.rules.length > TAX_LIMITS.rules
  ) {
    collector.errors.push({
      field: `${path}.rules`,
      message: `rules must be a non-empty array of at most ${TAX_LIMITS.rules} entries.`
    });
  } else {
    raw.rules.forEach((entry, index) => {
      const at = `${path}.rules[${index}]`;

      if (!isRecord(entry)) {
        collector.errors.push({
          field: at,
          message: `${at} must be an object.`
        });
        return;
      }

      closedKeys(
        entry,
        ["categoryCode", "treatment", "components"],
        at,
        collector
      );

      let categoryCode: string | null = null;

      if (entry.categoryCode !== null && entry.categoryCode !== undefined) {
        categoryCode = text(
          entry.categoryCode,
          `${at}.categoryCode`,
          collector,
          {
            max: TAX_LIMITS.codeLength,
            pattern: CODE_PATTERN
          }
        );

        if (categoryCode !== null && !categoryCodes.has(categoryCode)) {
          collector.errors.push({
            field: `${at}.categoryCode`,
            message: `Category "${categoryCode}" is not declared in categories.`
          });
          categoryCode = null;
        }
      }

      const treatment = oneOf(
        entry.treatment,
        `${at}.treatment`,
        collector,
        TREATMENTS
      );

      if (ruleCategories.has(categoryCode)) {
        collector.errors.push({
          field: `${at}.categoryCode`,
          message:
            categoryCode === null
              ? "Only one fallback rule (categoryCode null) is allowed."
              : `Category "${categoryCode}" has more than one rule.`
        });
      }

      ruleCategories.add(categoryCode);

      const components: TaxRuleDefinition["rules"][number]["components"] = [];
      const rawComponents = entry.components ?? [];

      if (
        !Array.isArray(rawComponents) ||
        rawComponents.length > TAX_LIMITS.componentsPerRule
      ) {
        collector.errors.push({
          field: `${at}.components`,
          message: `components must be an array of at most ${TAX_LIMITS.componentsPerRule} entries.`
        });
      } else {
        const componentCodes = new Set<string>();

        rawComponents.forEach((component, componentIndex) => {
          const cAt = `${at}.components[${componentIndex}]`;

          if (!isRecord(component)) {
            collector.errors.push({
              field: cAt,
              message: `${cAt} must be an object.`
            });
            return;
          }

          // `rate` is a legitimate key HERE — it is rule configuration, not a
          // caller-supplied amount — so the closed-key check allows it.
          closedKeys(
            component,
            ["code", "name", "rate", "basis"],
            cAt,
            collector
          );

          const code = text(component.code, `${cAt}.code`, collector, {
            max: TAX_LIMITS.codeLength,
            pattern: CODE_PATTERN
          });
          const name = text(component.name, `${cAt}.name`, collector, {
            max: TAX_LIMITS.nameLength
          });
          const basis = oneOf(
            component.basis ?? "net",
            `${cAt}.basis`,
            collector,
            COMPONENT_BASES
          );
          let rate: string | null = null;

          if (typeof component.rate !== "string") {
            collector.errors.push({
              field: `${cAt}.rate`,
              message: `${cAt}.rate must be a percent decimal string (for example "11"), never a number.`
            });
          } else {
            try {
              parseRatePercent(component.rate);
              rate = component.rate;
            } catch (error) {
              if (error instanceof TaxDecimalError) {
                collector.errors.push({
                  field: `${cAt}.rate`,
                  message: error.message
                });
              } else {
                throw error;
              }
            }
          }

          if (code !== null && componentCodes.has(code)) {
            collector.errors.push({
              field: `${cAt}.code`,
              message: `Component code "${code}" is used more than once in this rule.`
            });
            return;
          }

          if (code !== null) componentCodes.add(code);

          if (
            code !== null &&
            name !== null &&
            basis !== null &&
            rate !== null
          ) {
            components.push({ code, name, rate, basis });
          }
        });
      }

      if (treatment === "taxable" && components.length === 0) {
        collector.errors.push({
          field: `${at}.components`,
          message: "A taxable rule needs at least one component."
        });
      }

      if (
        treatment !== null &&
        treatment !== "taxable" &&
        components.length > 0
      ) {
        collector.errors.push({
          field: `${at}.components`,
          message: `A ${treatment} rule must not declare components.`
        });
      }

      if (treatment !== null) {
        rules.push({ categoryCode, treatment, components });
      }
    });
  }

  return { categories, rules };
}

export type RuleVersionInput = {
  profileCode: string;
  name: string;
  jurisdictionCode: string;
  countryCode: string | null;
  regionCode: string | null;
  currencyCode: string;
  pricingMode: PricingMode;
  roundingMode: (typeof ROUNDING_MODES)[number];
  roundingScale: number;
  roundingLevel: (typeof ROUNDING_LEVELS)[number];
  effectiveFrom: string;
  notes: string | null;
  definition: TaxRuleDefinition;
};

export function validateRuleVersionInput(
  raw: unknown
): Validated<RuleVersionInput> {
  const collector = newCollector();

  if (!isRecord(raw)) {
    collector.errors.push({
      field: "body",
      message: "Request body must be a JSON object."
    });
    return finish(collector, () => undefined as never);
  }

  closedKeys(
    raw,
    [
      "profileCode",
      "name",
      "jurisdictionCode",
      "countryCode",
      "regionCode",
      "currencyCode",
      "pricingMode",
      "roundingMode",
      "roundingScale",
      "roundingLevel",
      "effectiveFrom",
      "notes",
      "definition"
    ],
    "",
    collector
  );

  const profileCode = text(raw.profileCode, "profileCode", collector, {
    max: TAX_LIMITS.codeLength,
    pattern: CODE_PATTERN
  });
  const name = text(raw.name, "name", collector, {
    max: TAX_LIMITS.nameLength
  });
  const jurisdictionCode = text(
    raw.jurisdictionCode,
    "jurisdictionCode",
    collector,
    {
      max: TAX_LIMITS.codeLength,
      pattern: JURISDICTION_PATTERN
    }
  );
  const countryCode = text(raw.countryCode, "countryCode", collector, {
    max: 2,
    pattern: COUNTRY_PATTERN,
    optional: true
  });
  const regionCode = text(raw.regionCode, "regionCode", collector, {
    max: 32,
    pattern: REGION_PATTERN,
    optional: true
  });
  const currencyCode = text(raw.currencyCode, "currencyCode", collector, {
    max: 3,
    pattern: CURRENCY_PATTERN
  });
  const pricingMode = oneOf(
    raw.pricingMode,
    "pricingMode",
    collector,
    PRICING_MODES
  );
  const roundingMode = oneOf(
    raw.roundingMode,
    "roundingMode",
    collector,
    ROUNDING_MODES
  );
  const roundingLevel = oneOf(
    raw.roundingLevel,
    "roundingLevel",
    collector,
    ROUNDING_LEVELS
  );
  const notes = text(raw.notes, "notes", collector, {
    max: TAX_LIMITS.notesLength,
    optional: true
  });
  const effectiveFrom = text(raw.effectiveFrom, "effectiveFrom", collector, {
    max: 10
  });

  if (effectiveFrom !== null && !isValidIsoDate(effectiveFrom)) {
    collector.errors.push({
      field: "effectiveFrom",
      message: "effectiveFrom must be a calendar date (YYYY-MM-DD)."
    });
  }

  let roundingScale = 0;

  if (
    typeof raw.roundingScale !== "number" ||
    !Number.isInteger(raw.roundingScale) ||
    raw.roundingScale < 0 ||
    raw.roundingScale > 6
  ) {
    collector.errors.push({
      field: "roundingScale",
      message: "roundingScale must be an integer from 0 to 6."
    });
  } else {
    roundingScale = raw.roundingScale;
  }

  const definition = validateTaxDefinition(raw.definition, collector);

  return finish(collector, () => ({
    profileCode: profileCode!,
    name: name!,
    jurisdictionCode: jurisdictionCode!,
    countryCode,
    regionCode,
    currencyCode: currencyCode!,
    pricingMode: pricingMode!,
    roundingMode: roundingMode!,
    roundingScale,
    roundingLevel: roundingLevel!,
    effectiveFrom: effectiveFrom!,
    notes,
    definition: definition!
  }));
}

/**
 * No `pricingMode`: inclusive vs exclusive is the RULE VERSION's property, set by
 * whoever may author and publish it. A per-request override would let any caller
 * holding `tax.calculations.analyze` / `tax.snapshots.create` re-price the same
 * basket under the other mode and have the server record it as authoritative.
 * A key named `pricingMode` is therefore an unrecognised field (ADR-0127 §3).
 */
export type QuoteInput = {
  profileCode: string;
  taxDate: string;
  lines: TaxLineInput[];
};

export type SnapshotInput = QuoteInput & {
  documentType: string;
  documentId: string;
};

function validateLines(raw: unknown, collector: Collector): TaxLineInput[] {
  const lines: TaxLineInput[] = [];

  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TAX_LINES) {
    collector.errors.push({
      field: "lines",
      message: `lines must be an array of 1 to ${MAX_TAX_LINES} entries.`
    });
    return lines;
  }

  const refs = new Set<string>();

  raw.forEach((entry, index) => {
    const at = `lines[${index}]`;

    if (!isRecord(entry)) {
      collector.errors.push({ field: at, message: `${at} must be an object.` });
      return;
    }

    closedKeys(
      entry,
      ["lineRef", "categoryCode", "quantity", "unitPrice", "discount"],
      at,
      collector
    );

    const lineRef = text(entry.lineRef, `${at}.lineRef`, collector, {
      max: TAX_LIMITS.lineRefLength,
      pattern: REFERENCE_PATTERN,
      exact: true
    });
    let categoryCode: string | null = null;

    if (entry.categoryCode !== null && entry.categoryCode !== undefined) {
      categoryCode = text(entry.categoryCode, `${at}.categoryCode`, collector, {
        max: TAX_LIMITS.codeLength,
        pattern: CODE_PATTERN
      });
    }

    const quantity = decimalString(
      entry.quantity,
      `${at}.quantity`,
      collector,
      QUANTITY_FRACTION_DIGITS
    );
    const unitPrice = decimalString(
      entry.unitPrice,
      `${at}.unitPrice`,
      collector,
      PRICE_FRACTION_DIGITS
    );
    const discount =
      entry.discount === undefined
        ? "0"
        : decimalString(
            entry.discount,
            `${at}.discount`,
            collector,
            PRICE_FRACTION_DIGITS
          );

    if (lineRef !== null) {
      if (refs.has(lineRef)) {
        collector.errors.push({
          field: `${at}.lineRef`,
          message: `lineRef "${lineRef}" is used more than once.`
        });
      }
      refs.add(lineRef);
    }

    if (
      lineRef !== null &&
      quantity !== null &&
      unitPrice !== null &&
      discount !== null
    ) {
      lines.push({ lineRef, categoryCode, quantity, unitPrice, discount });
    }
  });

  return lines;
}

function validateQuoteFields(
  raw: Record<string, unknown>,
  collector: Collector
): QuoteInput {
  const profileCode = text(raw.profileCode, "profileCode", collector, {
    max: TAX_LIMITS.codeLength,
    pattern: CODE_PATTERN
  });
  const taxDate = text(raw.taxDate, "taxDate", collector, { max: 10 });

  if (taxDate !== null && !isValidIsoDate(taxDate)) {
    collector.errors.push({
      field: "taxDate",
      message: "taxDate must be a calendar date (YYYY-MM-DD)."
    });
  }

  return {
    profileCode: profileCode ?? "",
    taxDate: taxDate ?? "",
    lines: validateLines(raw.lines, collector)
  };
}

export function validateQuoteInput(raw: unknown): Validated<QuoteInput> {
  const collector = newCollector();

  if (!isRecord(raw)) {
    collector.errors.push({
      field: "body",
      message: "Request body must be a JSON object."
    });
    return finish(collector, () => undefined as never);
  }

  closedKeys(raw, ["profileCode", "taxDate", "lines"], "", collector);

  const value = validateQuoteFields(raw, collector);

  return finish(collector, () => value);
}

export function validateSnapshotInput(raw: unknown): Validated<SnapshotInput> {
  const collector = newCollector();

  if (!isRecord(raw)) {
    collector.errors.push({
      field: "body",
      message: "Request body must be a JSON object."
    });
    return finish(collector, () => undefined as never);
  }

  closedKeys(
    raw,
    ["profileCode", "taxDate", "lines", "documentType", "documentId"],
    "",
    collector
  );

  const quote = validateQuoteFields(raw, collector);
  const documentType = text(raw.documentType, "documentType", collector, {
    max: TAX_LIMITS.codeLength,
    pattern: CODE_PATTERN
  });
  const documentId = text(raw.documentId, "documentId", collector, {
    max: TAX_LIMITS.documentIdLength,
    pattern: REFERENCE_PATTERN,
    exact: true
  });

  return finish(collector, () => ({
    ...quote,
    documentType: documentType!,
    documentId: documentId!
  }));
}

export type ReversalInput = {
  documentId: string;
  /** The reversal's own tax date (the period it is reported in); the original's when absent. */
  taxDate: string | null;
  lines: { lineRef: string; quantity: string }[] | null;
  reason: string | null;
};

export function validateReversalInput(raw: unknown): Validated<ReversalInput> {
  const collector = newCollector();

  if (!isRecord(raw)) {
    collector.errors.push({
      field: "body",
      message: "Request body must be a JSON object."
    });
    return finish(collector, () => undefined as never);
  }

  closedKeys(raw, ["documentId", "taxDate", "lines", "reason"], "", collector);

  const taxDate = text(raw.taxDate, "taxDate", collector, {
    max: 10,
    optional: true
  });

  if (taxDate !== null && !isValidIsoDate(taxDate)) {
    collector.errors.push({
      field: "taxDate",
      message: "taxDate must be a calendar date (YYYY-MM-DD)."
    });
  }

  const documentId = text(raw.documentId, "documentId", collector, {
    max: TAX_LIMITS.documentIdLength,
    pattern: REFERENCE_PATTERN,
    exact: true
  });
  const reason = text(raw.reason, "reason", collector, {
    max: TAX_LIMITS.reasonLength,
    optional: true
  });
  let lines: ReversalInput["lines"] = null;

  if (raw.lines !== undefined && raw.lines !== null) {
    if (
      !Array.isArray(raw.lines) ||
      raw.lines.length === 0 ||
      raw.lines.length > MAX_TAX_LINES
    ) {
      collector.errors.push({
        field: "lines",
        message: `lines must be an array of 1 to ${MAX_TAX_LINES} entries, or omitted to reverse everything.`
      });
    } else {
      lines = [];
      raw.lines.forEach((entry, index) => {
        const at = `lines[${index}]`;

        if (!isRecord(entry)) {
          collector.errors.push({
            field: at,
            message: `${at} must be an object.`
          });
          return;
        }

        closedKeys(entry, ["lineRef", "quantity"], at, collector);

        const lineRef = text(entry.lineRef, `${at}.lineRef`, collector, {
          max: TAX_LIMITS.lineRefLength,
          pattern: REFERENCE_PATTERN,
          exact: true
        });
        const quantity = decimalString(
          entry.quantity,
          `${at}.quantity`,
          collector,
          QUANTITY_FRACTION_DIGITS
        );

        if (lineRef !== null && quantity !== null) {
          lines!.push({ lineRef, quantity });
        }
      });
    }
  }

  return finish(collector, () => ({
    documentId: documentId!,
    taxDate,
    lines,
    reason
  }));
}
