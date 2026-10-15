/**
 * Request validation for the `booking` reservation routes (Issue #941, ADR-0131;
 * docs/awcms/booking.md sections 3 and 9). Pure -- no database, no clock.
 *
 * Bodies are STRICT, as in `booking-validation.ts`: a key the validator does not
 * know is refused, so a client cannot assert a server-derived fact (a status, an
 * end, a buffer, an expiry, a lineage). Two kinds of refusal are different:
 *
 *   * **A payment field.** The module stores no payment state (booking.md section
 *     3): a body naming `paid`, `deposit`, `amount`, `balance`, `price` and the like
 *     is `400 PAYMENT_FIELD_NOT_ACCEPTED` and the message NAMES the field, so an
 *     adapter that tried to tuck its payment into the reservation learns at once
 *     that the module is the wrong place.
 *   * **An unknown key.** `400 VALIDATION_ERROR` naming the key.
 *
 * Every instant is RFC 3339 with an explicit offset or `Z`; a stay is two local
 * dates (section 2). The claim fields are checked a second time, structurally, by
 * `validatePlaceHold` inside the allocator, which is what a non-HTTP caller (the
 * port) goes through; this file only adds the HTTP-body concerns around it.
 */
import { findSecretShapedValues } from "../../_shared/redaction";
import { validatePlaceHold, type PlaceHoldInput } from "./booking-allocation";
import type { Validated, ValidationError } from "./booking-schedule";
import { parseInstant } from "./booking-validation";

export type ReservationValidated<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      errors: ValidationError[];
      /** `PAYMENT_FIELD_NOT_ACCEPTED` outranks a plain validation error. */
      code: "VALIDATION_ERROR" | "PAYMENT_FIELD_NOT_ACCEPTED";
    };

/**
 * Substrings that mark a field as payment state. Matched case-insensitively on the
 * key with separators removed, so `payment_status`, `paymentStatus` and
 * `PAYMENT-STATUS` are one thing. None of them is a substring of a field this
 * module accepts.
 */
const PAYMENT_FIELD_MARKERS = [
  "paid",
  "payment",
  "deposit",
  "amount",
  "balance",
  "price",
  "total",
  "currency",
  "refund",
  "invoice",
  "discount",
  "cost",
  "fee"
] as const;

export function isPaymentFieldName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  return PAYMENT_FIELD_MARKERS.some((marker) => normalized.includes(marker));
}

function asRecord(
  raw: unknown,
  allowed: readonly string[],
  errors: ValidationError[]
): { record: Record<string, unknown>; payment: string | null } {
  if (raw === null || raw === undefined) {
    return { record: {}, payment: null };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ field: "body", message: "Body must be a JSON object." });
    return { record: {}, payment: null };
  }

  const record = raw as Record<string, unknown>;
  let payment: string | null = null;

  for (const key of Object.keys(record)) {
    if (allowed.includes(key)) {
      continue;
    }

    if (isPaymentFieldName(key)) {
      payment ??= key;
      errors.push({
        field: key,
        message: `${key} is payment state; this module stores none. Record it in the commerce layer and ask for a confirm when it is paid.`
      });
    } else {
      errors.push({ field: key, message: `${key} is not accepted.` });
    }
  }

  return { record, payment };
}

function finish<T>(
  errors: ValidationError[],
  payment: string | null,
  value: T
): ReservationValidated<T> {
  if (errors.length === 0) {
    return { valid: true, value };
  }

  return {
    valid: false,
    errors,
    code: payment ? "PAYMENT_FIELD_NOT_ACCEPTED" : "VALIDATION_ERROR"
  };
}

const STAY_KEYS = ["checkInDate", "checkOutDate"] as const;
const EXTERNAL_REF_KEYS = ["type", "id"] as const;

function parseStay(
  raw: unknown,
  errors: ValidationError[]
): { checkInDate: string; checkOutDate: string } | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push({ field: "stay", message: "stay must be an object." });
    return undefined;
  }

  const record = raw as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(STAY_KEYS as readonly string[]).includes(key)) {
      errors.push({ field: `stay.${key}`, message: `${key} is not accepted.` });
    }
  }

  if (
    typeof record.checkInDate !== "string" ||
    typeof record.checkOutDate !== "string"
  ) {
    errors.push({
      field: "stay",
      message: "stay needs checkInDate and checkOutDate (YYYY-MM-DD)."
    });
    return undefined;
  }

  return {
    checkInDate: record.checkInDate,
    checkOutDate: record.checkOutDate
  };
}

/** The `startsAt` / `stay` pair shared by create and reschedule. Exactly one. */
function parseWhen(
  record: Record<string, unknown>,
  errors: ValidationError[]
): {
  startsAtMs?: number;
  stay?: { checkInDate: string; checkOutDate: string };
} {
  const hasStartsAt = record.startsAt !== undefined;
  const hasStay = record.stay !== undefined;

  if (hasStartsAt === hasStay) {
    errors.push({
      field: "startsAt",
      message: "Send exactly one of startsAt (a slot) or stay (a night range)."
    });
    return {};
  }

  if (hasStay) {
    const stay = parseStay(record.stay, errors);

    return stay ? { stay } : {};
  }

  const startsAtMs = parseInstant(record.startsAt);

  if (startsAtMs === null) {
    errors.push({
      field: "startsAt",
      message:
        "startsAt must be an RFC 3339 instant with an explicit offset or Z."
    });
    return {};
  }

  return { startsAtMs };
}

function parseIntegerField(
  record: Record<string, unknown>,
  field: string,
  fallback: number,
  errors: ValidationError[]
): number {
  const value = record[field];

  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push({ field, message: `${field} must be an integer.` });
    return fallback;
  }

  return value;
}

export type CreateReservationRequest = {
  claim: PlaceHoldInput;
  /** The caller asks to lift opening hours, lead time and horizon; needs `reservations.override`. */
  overridePolicy: boolean;
};

const CREATE_KEYS = [
  "offeringId",
  "resourceId",
  "poolId",
  "startsAt",
  "stay",
  "partySize",
  "quantity",
  "holdSeconds",
  "externalCustomerRef",
  "externalRef",
  "source",
  "customerNote",
  "overridePolicy"
] as const;

/** The body of `POST /api/v1/booking/reservations`. */
export function validateCreateReservation(
  raw: unknown
): ReservationValidated<CreateReservationRequest> {
  const errors: ValidationError[] = [];
  const { record, payment } = asRecord(raw, CREATE_KEYS, errors);

  if (raw === null || raw === undefined) {
    errors.push({ field: "body", message: "A JSON body is required." });
  }

  const when = parseWhen(record, errors);
  const externalRefRaw = record.externalRef;
  let externalRef: { type: string; id: string } | null | undefined;

  if (externalRefRaw === null) {
    externalRef = null;
  } else if (externalRefRaw !== undefined) {
    if (
      typeof externalRefRaw !== "object" ||
      Array.isArray(externalRefRaw) ||
      typeof (externalRefRaw as Record<string, unknown>).type !== "string" ||
      typeof (externalRefRaw as Record<string, unknown>).id !== "string"
    ) {
      errors.push({
        field: "externalRef",
        message: "externalRef must be { type, id } or null."
      });
    } else {
      const pair = externalRefRaw as Record<string, string>;

      for (const key of Object.keys(pair)) {
        if (!(EXTERNAL_REF_KEYS as readonly string[]).includes(key)) {
          errors.push({
            field: `externalRef.${key}`,
            message: `${key} is not accepted.`
          });
        }
      }

      // An event carries the pair (booking.md section 7.4) and the outbox
      // REFUSES a payload with a credential-shaped value: a JWT, a PEM key, a
      // Bearer header. Refused here as a 400 so it cannot become a 500 after
      // the claim has been won.
      if (findSecretShapedValues({ id: pair.id }).length > 0) {
        errors.push({
          field: "externalRef.id",
          message:
            "externalRef.id looks like a credential; send the adapter's own opaque reference instead."
        });
      }

      externalRef = { type: pair.type!, id: pair.id! };
    }
  }

  for (const [field, expected] of [
    ["offeringId", "string"],
    ["resourceId", "string"],
    ["poolId", "string"],
    ["source", "string"]
  ] as const) {
    if (record[field] !== undefined && typeof record[field] !== expected) {
      errors.push({ field, message: `${field} must be a string.` });
    }
  }

  for (const field of ["externalCustomerRef", "customerNote"] as const) {
    const value = record[field];

    if (value !== undefined && value !== null && typeof value !== "string") {
      errors.push({ field, message: `${field} must be a string or null.` });
    }
  }

  if (
    record.overridePolicy !== undefined &&
    typeof record.overridePolicy !== "boolean"
  ) {
    errors.push({
      field: "overridePolicy",
      message: "overridePolicy must be true or false."
    });
  }

  if (
    record.holdSeconds !== undefined &&
    record.holdSeconds !== null &&
    typeof record.holdSeconds !== "number"
  ) {
    errors.push({
      field: "holdSeconds",
      message: "holdSeconds must be a number of seconds."
    });
  }

  const claim: PlaceHoldInput = {
    offeringId: String(record.offeringId ?? ""),
    ...(typeof record.resourceId === "string"
      ? { resourceId: record.resourceId }
      : {}),
    ...(typeof record.poolId === "string" ? { poolId: record.poolId } : {}),
    ...when,
    partySize: parseIntegerField(record, "partySize", 1, errors),
    quantity: parseIntegerField(record, "quantity", 1, errors),
    ...(typeof record.holdSeconds === "number"
      ? { holdSeconds: record.holdSeconds }
      : {}),
    ...(typeof record.externalCustomerRef === "string" ||
    record.externalCustomerRef === null
      ? { externalCustomerRef: record.externalCustomerRef as string | null }
      : {}),
    ...(externalRef === undefined ? {} : { externalRef }),
    ...(typeof record.source === "string" ? { source: record.source } : {}),
    ...(typeof record.customerNote === "string" || record.customerNote === null
      ? { customerNote: record.customerNote as string | null }
      : {})
  };

  if (errors.length === 0) {
    for (const issue of validatePlaceHold(claim)) {
      errors.push({ field: issue.field, message: issue.message });
    }
  }

  return finish(errors, payment, {
    claim,
    overridePolicy: record.overridePolicy === true
  });
}

export type RescheduleRequest = {
  startsAtMs?: number;
  stay?: { checkInDate: string; checkOutDate: string };
  /** Move to another resource or pool; absent = the one the reservation holds. */
  resourceId?: string;
  poolId?: string;
  overridePolicy: boolean;
};

const RESCHEDULE_KEYS = [
  "startsAt",
  "stay",
  "resourceId",
  "poolId",
  "overridePolicy"
] as const;

/** The body of `POST /api/v1/booking/reservations/{id}/reschedule`. */
export function validateReschedule(
  raw: unknown
): ReservationValidated<RescheduleRequest> {
  const errors: ValidationError[] = [];
  const { record, payment } = asRecord(raw, RESCHEDULE_KEYS, errors);

  if (raw === null || raw === undefined) {
    errors.push({ field: "body", message: "A JSON body is required." });
  }

  const when = parseWhen(record, errors);

  for (const field of ["resourceId", "poolId"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") {
      errors.push({ field, message: `${field} must be a string.` });
    }
  }

  if (record.resourceId !== undefined && record.poolId !== undefined) {
    errors.push({
      field: "resourceId",
      message: "Send at most one of resourceId or poolId."
    });
  }

  if (
    record.overridePolicy !== undefined &&
    typeof record.overridePolicy !== "boolean"
  ) {
    errors.push({
      field: "overridePolicy",
      message: "overridePolicy must be true or false."
    });
  }

  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const field of ["resourceId", "poolId"] as const) {
    const value = record[field];

    if (typeof value === "string" && !UUID.test(value)) {
      errors.push({ field, message: `${field} must be a UUID.` });
    }
  }

  return finish(errors, payment, {
    ...when,
    ...(typeof record.resourceId === "string"
      ? { resourceId: record.resourceId.toLowerCase() }
      : {}),
    ...(typeof record.poolId === "string"
      ? { poolId: record.poolId.toLowerCase() }
      : {}),
    overridePolicy: record.overridePolicy === true
  });
}

export type CancelRequest = { reasonCode: string | null };

export const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** The body of `POST /api/v1/booking/reservations/{id}/cancel`. A short code, never free text. */
export function validateCancel(
  raw: unknown
): ReservationValidated<CancelRequest> {
  const errors: ValidationError[] = [];
  const { record, payment } = asRecord(raw, ["reasonCode"], errors);
  const reasonCode = record.reasonCode;

  if (
    reasonCode !== undefined &&
    reasonCode !== null &&
    (typeof reasonCode !== "string" || !REASON_CODE_PATTERN.test(reasonCode))
  ) {
    errors.push({
      field: "reasonCode",
      message:
        "reasonCode must be a short lowercase code (letters, digits, underscore), never free text."
    });
  }

  return finish(errors, payment, {
    reasonCode: typeof reasonCode === "string" ? reasonCode : null
  });
}

/** A transition with no input (confirm, check-in, complete, no-show): an absent body or `{}`. */
export function validateEmptyReservationBody(
  raw: unknown
): ReservationValidated<Record<string, never>> {
  const errors: ValidationError[] = [];
  const { payment } = asRecord(raw, [], errors);

  return finish(errors, payment, {});
}

/** Adapts a reservation validation to the `Validated` shape `readValidatedBody` takes elsewhere. */
export function asValidated<T>(result: ReservationValidated<T>): Validated<T> {
  return result.valid ? result : { valid: false, errors: result.errors };
}
