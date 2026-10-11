/**
 * Request validation for `hr_commission` (Issue #950, ADR-0132). Pure — no
 * database, no config.
 *
 * **Strict bodies.** Every validator rejects a key it does not know, so a client
 * can never assert `status`, `versionNo` or a stamp (all derived), nor attach an
 * employment or a person: a rule is configuration, not a record about anyone.
 *
 * **Strings, never numbers, for money.** A rate or an amount that arrives as a
 * JSON number has already been through a float; it is refused (400) rather than
 * silently reinterpreted.
 */
import {
  CommissionDecimalError,
  isRoundingMode,
  parseDecimal,
  ROUNDING_MODES,
  type RoundingMode
} from "./hr-commission-decimal";
import {
  isCommissionCalculation,
  type CommissionCalculation
} from "./hr-commission-types";

export type ValidationError = { field: string; message: string };

export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,62}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Mirror the CHECK constraints in `sql/182`. */
export const HR_COMMISSION_LIMITS = {
  name: 120,
  minYear: 1900,
  maxYear: 2200,
  maxRoundingScale: 6
} as const;

type Body = Record<string, unknown>;

function asBody(
  value: unknown,
  allowed: readonly string[],
  errors: ValidationError[]
): Body | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({ field: "body", message: "Body must be a JSON object." });
    return null;
  }

  const body = value as Body;

  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      errors.push({
        field: key,
        message: `${key} is not an accepted field. A commission rule is configuration: its status, version and stamps are derived, and it never references a person or an employment.`
      });
    }
  }

  return body;
}

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));

  return (
    year >= HR_COMMISSION_LIMITS.minYear &&
    year <= HR_COMMISSION_LIMITS.maxYear &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function dateField(
  body: Body,
  field: string,
  errors: ValidationError[],
  required: boolean
): string | null {
  const value = body[field];

  if (value === undefined || value === null) {
    if (required) {
      errors.push({ field, message: `${field} is required.` });
    }

    return null;
  }

  if (typeof value !== "string" || !isCalendarDate(value)) {
    errors.push({
      field,
      message: `${field} must be a calendar date, YYYY-MM-DD.`
    });
    return null;
  }

  return value;
}

function codeField(
  body: Body,
  field: string,
  errors: ValidationError[]
): string | null {
  const value = body[field];

  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    errors.push({
      field,
      message: `${field} is required: lower-case letters, digits, '_', '.' or '-', starting with a letter, at most 63 characters.`
    });
    return null;
  }

  return value;
}

/** A decimal STRING, or `null` when absent. Anything else is an error. */
function decimalField(
  body: Body,
  field: string,
  errors: ValidationError[],
  maxFractionDigits: number
): string | null {
  const value = body[field];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    errors.push({
      field,
      message: `${field} must be a decimal string such as "2.5"; a JSON number is refused because it has already been through a float.`
    });
    return null;
  }

  try {
    parseDecimal(value, { maxFractionDigits });
  } catch (error) {
    if (error instanceof CommissionDecimalError) {
      errors.push({
        field,
        message: `${field} must be a non-negative decimal string with at most ${maxFractionDigits} fractional digits and 12 integer digits.`
      });
      return null;
    }

    throw error;
  }

  return value;
}

function compare(a: string, b: string): number {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const left = x.num * y.den;
  const right = y.num * x.den;

  return left < right ? -1 : left > right ? 1 : 0;
}

export type RuleDraftInput = {
  name: string;
  sourceType: string;
  calculation: CommissionCalculation;
  rate: string | null;
  fixedAmount: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  currencyCode: string;
  roundingMode: RoundingMode;
  roundingScale: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type CreateRuleInput = RuleDraftInput & { ruleKey: string };

const DRAFT_FIELDS = [
  "name",
  "sourceType",
  "calculation",
  "rate",
  "fixedAmount",
  "minAmount",
  "maxAmount",
  "currencyCode",
  "roundingMode",
  "roundingScale",
  "effectiveFrom",
  "effectiveTo"
] as const;

function readDraft(
  body: Body,
  errors: ValidationError[]
): RuleDraftInput | null {
  const before = errors.length;

  const name = typeof body.name === "string" ? body.name.trim() : undefined;

  if (
    name === undefined ||
    name.length < 1 ||
    name.length > HR_COMMISSION_LIMITS.name
  ) {
    errors.push({
      field: "name",
      message: `name must be 1-${HR_COMMISSION_LIMITS.name} characters.`
    });
  }

  const sourceType = codeField(body, "sourceType", errors);

  if (!isCommissionCalculation(body.calculation)) {
    errors.push({
      field: "calculation",
      message: "calculation must be percent or fixed."
    });
  }

  if (
    typeof body.currencyCode !== "string" ||
    !CURRENCY_PATTERN.test(body.currencyCode)
  ) {
    errors.push({
      field: "currencyCode",
      message: "currencyCode must be three upper-case letters (ISO 4217 style)."
    });
  }

  if (!isRoundingMode(body.roundingMode)) {
    errors.push({
      field: "roundingMode",
      message: `roundingMode must be one of ${ROUNDING_MODES.join(", ")}.`
    });
  }

  const scale = body.roundingScale;

  if (
    typeof scale !== "number" ||
    !Number.isInteger(scale) ||
    scale < 0 ||
    scale > HR_COMMISSION_LIMITS.maxRoundingScale
  ) {
    errors.push({
      field: "roundingScale",
      message: `roundingScale must be a whole number from 0 to ${HR_COMMISSION_LIMITS.maxRoundingScale}.`
    });
  }

  const rate = decimalField(body, "rate", errors, 6);
  const fixedAmount = decimalField(body, "fixedAmount", errors, 6);
  const scaleOk = typeof scale === "number" && Number.isInteger(scale);
  const boundDigits = scaleOk
    ? Math.min(
        Math.max(scale as number, 0),
        HR_COMMISSION_LIMITS.maxRoundingScale
      )
    : 0;
  const minAmount = decimalField(body, "minAmount", errors, boundDigits);
  const maxAmount = decimalField(body, "maxAmount", errors, boundDigits);

  if (body.calculation === "percent") {
    if (rate === null) {
      errors.push({
        field: "rate",
        message: "rate is required for a percent rule (2.5 means 2.5 %)."
      });
    } else if (compare(rate, "100") > 0) {
      errors.push({ field: "rate", message: "rate must not exceed 100." });
    }

    if (fixedAmount !== null) {
      errors.push({
        field: "fixedAmount",
        message: "A percent rule has no fixedAmount."
      });
    }
  } else if (body.calculation === "fixed") {
    if (fixedAmount === null) {
      errors.push({
        field: "fixedAmount",
        message: "fixedAmount is required for a fixed rule."
      });
    }

    if (rate !== null) {
      errors.push({ field: "rate", message: "A fixed rule has no rate." });
    }
  }

  if (
    minAmount !== null &&
    maxAmount !== null &&
    compare(minAmount, maxAmount) > 0
  ) {
    errors.push({
      field: "minAmount",
      message: "minAmount must not exceed maxAmount."
    });
  }

  const effectiveFrom = dateField(body, "effectiveFrom", errors, true);
  const effectiveTo = dateField(body, "effectiveTo", errors, false);

  if (effectiveFrom && effectiveTo && effectiveTo <= effectiveFrom) {
    errors.push({
      field: "effectiveTo",
      message:
        "effectiveTo is EXCLUSIVE and must be after effectiveFrom; omit it for an open-ended version."
    });
  }

  if (errors.length > before) {
    return null;
  }

  return {
    name: name!,
    sourceType: sourceType!,
    calculation: body.calculation as CommissionCalculation,
    rate,
    fixedAmount,
    minAmount,
    maxAmount,
    currencyCode: body.currencyCode as string,
    roundingMode: body.roundingMode as RoundingMode,
    roundingScale: scale as number,
    effectiveFrom: effectiveFrom!,
    effectiveTo
  };
}

export function validateCreateRule(raw: unknown): Validated<CreateRuleInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["ruleKey", ...DRAFT_FIELDS], errors);

  if (!body) {
    return { valid: false, errors };
  }

  const ruleKey = codeField(body, "ruleKey", errors);
  const draft = readDraft(body, errors);

  return errors.length > 0 || !draft || !ruleKey
    ? { valid: false, errors }
    : { valid: true, value: { ruleKey, ...draft } };
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function digestField(body: Body, errors: ValidationError[]): string | null {
  const value = body.expectedContentDigest;

  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    errors.push({
      field: "expectedContentDigest",
      message:
        "expectedContentDigest is required: the contentDigest of the version you were shown (64 lower-case hex characters). The server refuses with 409 if the terms have changed since."
    });
    return null;
  }

  return value;
}

export type UpdateRuleInput = RuleDraftInput & {
  expectedContentDigest: string;
};

/**
 * Replaces every editable field of a DRAFT; `ruleKey` and the version never
 * change. Names the digest it was based on, so an edit made on a stale view is
 * a 409 and not a silent overwrite.
 */
export function validateUpdateRule(raw: unknown): Validated<UpdateRuleInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, [...DRAFT_FIELDS, "expectedContentDigest"], errors);

  if (!body) {
    return { valid: false, errors };
  }

  const expectedContentDigest = digestField(body, errors);
  const draft = readDraft(body, errors);

  return errors.length > 0 || !draft || !expectedContentDigest
    ? { valid: false, errors }
    : { valid: true, value: { ...draft, expectedContentDigest } };
}

/**
 * Publish names the digest of the terms the publisher reviewed, and — only when
 * the window starts before today (back-dated) — the reason. The reason is the
 * actor's own sentence about a commercial term: at most 500 characters, kept on
 * the rule row and never in an audit row.
 */
export function validatePublishBody(raw: unknown): Validated<{
  expectedContentDigest: string;
  backdatedReason: string | null;
}> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    ["expectedContentDigest", "backdatedReason"],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const expectedContentDigest = digestField(body, errors);
  let backdatedReason: string | null = null;
  const reason = body.backdatedReason;

  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      errors.push({
        field: "backdatedReason",
        message: "backdatedReason must be a non-empty string."
      });
    } else if (reason.trim().length > 500) {
      errors.push({
        field: "backdatedReason",
        message: "backdatedReason must be at most 500 characters."
      });
    } else {
      backdatedReason = reason.trim();
    }
  }

  return errors.length > 0 || !expectedContentDigest
    ? { valid: false, errors }
    : { valid: true, value: { expectedContentDigest, backdatedReason } };
}

export function validateEmptyBody(
  raw: unknown
): Validated<Record<string, never>> {
  const errors: ValidationError[] = [];

  asBody(raw ?? {}, [], errors);

  return finish(errors, {});
}
