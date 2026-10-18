/**
 * Request validation for the accrual ledger (Issue #951, ADR-0132). Pure.
 *
 * **Strict bodies.** Every validator rejects a key it does not know, so a client
 * can never assert `status`, `amount`, `ruleVersion`, a stamp or a rule: the
 * amount is COMPUTED from the published rule, never accepted. Money crosses as a
 * decimal STRING (a JSON number has already been through a float and is a 400).
 *
 * The same validators serve the HTTP surface and the in-process port adapter, so
 * an in-process caller cannot post what an HTTP caller could not.
 */
import { createHash } from "node:crypto";

import type {
  CommissionAccrualRequest,
  CommissionAccrualSource,
  CommissionVoidRequest
} from "../../_shared/ports/commission-accrual-port";
import {
  CommissionDecimalError,
  decimalToUnits,
  parseDecimal,
  unitsToDecimalString
} from "./hr-commission-decimal";
import {
  MAX_EVENT_AGE_DAYS,
  isEventTooOld,
  occurredOnMatchesInstant
} from "./hr-commission-accrual-state";
import { MAX_COMMISSION_UNITS } from "./hr-commission-types";
import {
  isCalendarDate,
  type Validated,
  type ValidationError
} from "./hr-commission-validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,62}$/;
const SOURCE_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;
const SOURCE_LINE_PATTERN = /^[A-Za-z0-9_.:-]{0,64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,39}$/;
const PAYMENT_REFERENCE_PATTERN = /^[A-Za-z0-9_.:/-]{1,64}$/;
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** An event this far ahead of the server clock is a clock fault or a lie, not a sale. */
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

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
        message: `${key} is not an accepted field. An accrual's amount, rule version, status and stamps are derived by the ledger and can never be asserted.`
      });
    }
  }

  return body;
}

/** `true` only for a real string matching `pattern`: `RegExp.test` coerces an array or object to text and would pass `["x"]`. */
function matches(value: unknown, pattern: RegExp): boolean {
  return typeof value === "string" && pattern.test(value);
}

/** Validates a void request already shaped like the port's (Issue #1109). */
export function validateVoidRequest(
  request: CommissionVoidRequest
): Validated<CommissionVoidRequest> {
  const errors: ValidationError[] = [];
  const source = request?.source as CommissionAccrualSource | undefined;

  if (!matches(request?.employmentId, UUID_PATTERN)) {
    errors.push({
      field: "employmentId",
      message: "employmentId must be a UUID."
    });
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    errors.push({ field: "source", message: "source is required." });
  } else {
    if (!matches(source.type, CODE_PATTERN)) {
      errors.push({ field: "source.type", message: "source.type is invalid." });
    }

    if (!matches(source.ref, SOURCE_REF_PATTERN)) {
      errors.push({
        field: "source.ref",
        message: "source.ref must be 1-200 characters of A-Z a-z 0-9 _ . : -."
      });
    }

    if (
      source.line !== undefined &&
      !matches(source.line, SOURCE_LINE_PATTERN)
    ) {
      errors.push({
        field: "source.line",
        message:
          "source.line must be at most 64 characters of A-Z a-z 0-9 _ . : -."
      });
    }
  }

  if (!matches(request?.reason, REASON_CODE_PATTERN)) {
    errors.push({
      field: "reason",
      message:
        "reason is a short code (lower-case letters, digits, '_', '.', '-'; at most 40 characters), never free text."
    });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: request };
}

/** Validates a request object already shaped like the port's (the in-process adapter's entry). */
export function validateAccrualRequest(
  request: CommissionAccrualRequest,
  now: Date
): Validated<CommissionAccrualRequest> {
  const errors: ValidationError[] = [];

  if (!matches(request.employmentId, UUID_PATTERN)) {
    errors.push({
      field: "employmentId",
      message: "employmentId must be a UUID."
    });
  }

  if (!matches(request.ruleKey, CODE_PATTERN)) {
    errors.push({
      field: "ruleKey",
      message: "ruleKey is not a valid rule key."
    });
  }

  const source = request.source as CommissionAccrualSource | undefined;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    errors.push({ field: "source", message: "source is required." });
  } else {
    if (!matches(source.type, CODE_PATTERN)) {
      errors.push({
        field: "source.type",
        message:
          "source.type is required: lower-case letters, digits, '_', '.' or '-', starting with a letter."
      });
    }

    if (!matches(source.ref, SOURCE_REF_PATTERN)) {
      errors.push({
        field: "source.ref",
        message: "source.ref must be 1-200 characters of A-Z a-z 0-9 _ . : -."
      });
    }

    if (
      source.line !== undefined &&
      !matches(source.line, SOURCE_LINE_PATTERN)
    ) {
      errors.push({
        field: "source.line",
        message:
          "source.line must be at most 64 characters of A-Z a-z 0-9 _ . : -."
      });
    }
  }

  if (!matches(request.currencyCode, CURRENCY_PATTERN)) {
    errors.push({
      field: "currencyCode",
      message: "currencyCode must be a three-letter upper-case code."
    });
  }

  const hasBase = request.baseAmount !== undefined;
  const hasUnits = request.units !== undefined;

  if (hasBase === hasUnits) {
    errors.push({
      field: "baseAmount",
      message:
        "Exactly one of baseAmount (a percent rule) or units (a fixed rule) is required."
    });
  }

  if (hasBase) {
    if (typeof request.baseAmount !== "string") {
      errors.push({
        field: "baseAmount",
        message:
          'baseAmount must be a decimal string such as "125000.50"; a JSON number is refused because it has already been through a float.'
      });
    } else {
      try {
        parseDecimal(request.baseAmount, { maxFractionDigits: 6 });
      } catch (error) {
        if (!(error instanceof CommissionDecimalError)) {
          throw error;
        }

        errors.push({
          field: "baseAmount",
          message:
            "baseAmount must be a non-negative decimal string with at most 6 fractional and 12 integer digits."
        });
      }
    }
  }

  if (
    hasUnits &&
    (typeof request.units !== "number" ||
      !Number.isInteger(request.units) ||
      request.units < 0 ||
      request.units > MAX_COMMISSION_UNITS)
  ) {
    errors.push({
      field: "units",
      message: `units must be a whole number from 0 to ${MAX_COMMISSION_UNITS}.`
    });
  }

  if (
    !(request.occurredAt instanceof Date) ||
    Number.isNaN(request.occurredAt.getTime())
  ) {
    errors.push({
      field: "occurredAt",
      message: "occurredAt must be an instant."
    });
  } else if (
    request.occurredAt.getTime() >
    now.getTime() + MAX_FUTURE_SKEW_MS
  ) {
    errors.push({
      field: "occurredAt",
      message: "occurredAt is more than a day in the future."
    });
  } else if (isEventTooOld(request.occurredAt, now)) {
    errors.push({
      field: "occurredAt",
      message: `occurredAt is more than ${MAX_EVENT_AGE_DAYS} days old: a sale this old is not a late delivery.`
    });
  }

  if (
    typeof request.occurredOn !== "string" ||
    !isCalendarDate(request.occurredOn)
  ) {
    errors.push({
      field: "occurredOn",
      message: "occurredOn must be a calendar date, YYYY-MM-DD."
    });
  } else if (
    request.occurredAt instanceof Date &&
    !Number.isNaN(request.occurredAt.getTime()) &&
    !occurredOnMatchesInstant(request.occurredOn, request.occurredAt)
  ) {
    errors.push({
      field: "occurredOn",
      message:
        "occurredOn must be within one day of the UTC date of occurredAt (any UTC offset)."
    });
  }

  if (
    request.correlationId !== undefined &&
    (typeof request.correlationId !== "string" ||
      request.correlationId.length < 1 ||
      request.correlationId.length > 128)
  ) {
    errors.push({
      field: "correlationId",
      message: "correlationId must be 1-128 characters."
    });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: request };
}

const ACCRUE_FIELDS = [
  "employmentId",
  "ruleKey",
  "source",
  "baseAmount",
  "units",
  "currencyCode",
  "occurredAt",
  "occurredOn"
] as const;

/** `POST /accruals` body -> the port request (the instant parsed; the rest as sent). */
export function validateAccrueBody(
  raw: unknown,
  now: Date
): Validated<CommissionAccrualRequest> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ACCRUE_FIELDS, errors);

  if (!body) {
    return { valid: false, errors };
  }

  if (
    typeof body.occurredAt !== "string" ||
    !INSTANT_PATTERN.test(body.occurredAt)
  ) {
    errors.push({
      field: "occurredAt",
      message:
        "occurredAt must be an ISO 8601 instant with an offset, e.g. 2026-10-12T08:30:00Z."
    });
  }

  const source = body.source;

  if (typeof source === "object" && source !== null && !Array.isArray(source)) {
    for (const key of Object.keys(source)) {
      if (!["type", "ref", "line"].includes(key)) {
        errors.push({
          field: `source.${key}`,
          message: `${key} is not an accepted field.`
        });
      }
    }
  }

  const request = {
    employmentId: body.employmentId,
    ruleKey: body.ruleKey,
    source,
    baseAmount: body.baseAmount ?? undefined,
    units: body.units ?? undefined,
    currencyCode: body.currencyCode,
    occurredAt:
      typeof body.occurredAt === "string"
        ? new Date(body.occurredAt)
        : (undefined as unknown as Date),
    occurredOn: body.occurredOn
  } as CommissionAccrualRequest;

  const validation = validateAccrualRequest(request, now);

  if (!validation.valid) {
    errors.push(...validation.errors);
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: request };
}

/**
 * The canonical request of an accrual, hashed: what "the same request" means for
 * a redelivery. It carries every input that decides an amount or a date and
 * nothing that does not (`correlationId`, the actor). The base amount is
 * normalised so `"10"` and `"10.000000"` are the same request.
 */
export function accrualRequestDigest(
  request: CommissionAccrualRequest
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.employmentId.toLowerCase(),
        request.ruleKey,
        request.source.type,
        request.source.ref,
        request.source.line ?? "",
        request.baseAmount === undefined
          ? null
          : unitsToDecimalString(decimalToUnits(request.baseAmount, 6), 6),
        request.units ?? null,
        request.currencyCode,
        request.occurredAt.toISOString(),
        request.occurredOn
      ])
    )
    .digest("hex");
}

// --- Transition bodies -------------------------------------------------------

export function validateTransitionBody(
  raw: unknown,
  allowed: readonly string[]
): { body: Body } | { errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const body = asBody(raw ?? {}, allowed, errors);

  return errors.length > 0 || !body ? { errors } : { body };
}

export function validateVoidBody(
  raw: unknown
): Validated<{ reasonCode: string | null }> {
  const parsed = validateTransitionBody(raw, ["reasonCode"]);

  if ("errors" in parsed) {
    return { valid: false, errors: parsed.errors };
  }

  const value = parsed.body.reasonCode;

  if (value === undefined || value === null) {
    return { valid: true, value: { reasonCode: null } };
  }

  if (typeof value !== "string" || !REASON_CODE_PATTERN.test(value)) {
    return {
      valid: false,
      errors: [
        {
          field: "reasonCode",
          message:
            "reasonCode is a short code (lower-case letters, digits, '_', '.', '-'; at most 40 characters), never free text."
        }
      ]
    };
  }

  return { valid: true, value: { reasonCode: value } };
}

export function validatePayBody(
  raw: unknown
): Validated<{ paymentReference: string | null }> {
  const parsed = validateTransitionBody(raw, ["paymentReference"]);

  if ("errors" in parsed) {
    return { valid: false, errors: parsed.errors };
  }

  const value = parsed.body.paymentReference;

  if (value === undefined || value === null) {
    return { valid: true, value: { paymentReference: null } };
  }

  if (typeof value !== "string" || !PAYMENT_REFERENCE_PATTERN.test(value)) {
    return {
      valid: false,
      errors: [
        {
          field: "paymentReference",
          message:
            "paymentReference is an opaque reference of at most 64 characters (A-Z a-z 0-9 _ . : / -), never an account number."
        }
      ]
    };
  }

  return { valid: true, value: { paymentReference: value } };
}
