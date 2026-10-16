/**
 * Request validation for attendance events and corrections (Issue #947,
 * ADR-0132). Pure — no database, no config.
 *
 * **Strict bodies.** Every validator rejects a key it does not know. There is no
 * `recordedAt` (the database's clock), no `late` (the guard decides), and no
 * location, coordinate, photo, device or network field of any kind (owner
 * decision O6, ADR-0138): a client that sends one is refused, not ignored. The
 * ONE exception is `positionSample` (Issue #970): an optional
 * `{ latitude, longitude, accuracyMeters }` that only a `self` clock_in /
 * clock_out may carry, evaluated by the server in the request and discarded.
 */
import {
  ATTENDANCE_LIMITS,
  isAttendanceClientSource,
  isAttendanceKind,
  isCorrectionKind,
  type AttendanceClientSource,
  type AttendanceKind,
  type CorrectionKind
} from "./hr-attendance-types";
import { parsePositionSample } from "./hr-geolocation-validation";
import {
  isGeoEligibleEvent,
  type PositionSample
} from "./hr-geolocation-types";
import type { Validated, ValidationError } from "./hr-workforce-validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
// Control characters other than tab and newline.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F]/;

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
        message: `${key} is not an accepted field. Attendance carries no location, photo, device or network field, and the server alone decides the recorded time and the late flag.`
      });
    }
  }

  return body;
}

function uuid(
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

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    errors.push({ field, message: `${field} must be a UUID.` });
    return null;
  }

  return value.toLowerCase();
}

/** A real UTC instant ending in `Z`, whole seconds or milliseconds. */
export function parseAttendanceInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !INSTANT_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  // Reject `2026-02-30T...` style rollovers.
  return date.toISOString().slice(0, 10) === value.slice(0, 10) ? date : null;
}

function instant(
  body: Body,
  field: string,
  errors: ValidationError[]
): Date | null {
  const value = body[field];

  if (value === undefined || value === null) {
    errors.push({ field, message: `${field} is required.` });
    return null;
  }

  const parsed = parseAttendanceInstant(value);

  if (!parsed) {
    errors.push({
      field,
      message: `${field} must be a UTC instant such as 2026-10-12T08:00:00Z.`
    });
  }

  return parsed;
}

function kind(
  body: Body,
  field: string,
  errors: ValidationError[]
): AttendanceKind | null {
  const value = body[field];

  if (!isAttendanceKind(value)) {
    errors.push({
      field,
      message: `${field} must be clock_in, clock_out, break_start or break_end.`
    });
    return null;
  }

  return value;
}

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

export type CreateAttendanceEventInput = {
  employmentId: string;
  kind: AttendanceKind;
  occurredAt: Date;
  source: AttendanceClientSource;
  clientEventKey: string;
  officeId: string | null;
  /**
   * The position sample (Issue #970, ADR-0138), or `null` for none / declined.
   * It lives only in the memory of the request: the route evaluates it and drops
   * it, and it is excluded from the idempotency hash.
   */
  positionSample: PositionSample | null;
};

export function validateCreateAttendanceEvent(
  raw: unknown
): Validated<CreateAttendanceEventInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "employmentId",
      "kind",
      "occurredAt",
      "source",
      "clientEventKey",
      "officeId",
      "positionSample"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const employmentId = uuid(body, "employmentId", errors, true);
  const eventKind = kind(body, "kind", errors);
  const occurredAt = instant(body, "occurredAt", errors);
  const officeId = uuid(body, "officeId", errors, false);
  const source = body.source;
  const key = body.clientEventKey;

  if (!isAttendanceClientSource(source)) {
    errors.push({
      field: "source",
      message: "source must be self, supervisor, kiosk or import."
    });
  }

  if (typeof key !== "string" || !CLIENT_KEY_PATTERN.test(key)) {
    errors.push({
      field: "clientEventKey",
      message: `clientEventKey must be 1-${ATTENDANCE_LIMITS.clientEventKey} characters of letters, digits and _ . : -, starting with a letter or digit.`
    });
  }

  const positionSample = parsePositionSample(body.positionSample, errors);

  // Only the employee's own clock-in / clock-out may carry a position (ADR-0138
  // section 9: a kiosk is a place, not a person; a break is not attendance).
  if (
    body.positionSample !== undefined &&
    body.positionSample !== null &&
    eventKind &&
    isAttendanceClientSource(source) &&
    !isGeoEligibleEvent(eventKind, source)
  ) {
    errors.push({
      field: "positionSample",
      message: "Only a self clock_in or clock_out may carry a positionSample."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      employmentId: employmentId!,
      kind: eventKind!,
      occurredAt: occurredAt!,
      source: source as AttendanceClientSource,
      clientEventKey: key as string,
      officeId,
      positionSample
    }
  };
}

export type CreateCorrectionInput = {
  employmentId: string;
  kind: CorrectionKind;
  targetEventId: string | null;
  proposedKind: AttendanceKind;
  proposedOccurredAt: Date;
  reason: string;
};

export function validateCreateCorrection(
  raw: unknown
): Validated<CreateCorrectionInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "employmentId",
      "kind",
      "targetEventId",
      "proposedKind",
      "proposedOccurredAt",
      "reason"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const employmentId = uuid(body, "employmentId", errors, true);
  const targetEventId = uuid(body, "targetEventId", errors, false);
  const proposedKind = kind(body, "proposedKind", errors);
  const proposedOccurredAt = instant(body, "proposedOccurredAt", errors);
  const correctionKind = body.kind;
  const reasonRaw = body.reason;
  let reason = "";

  if (!isCorrectionKind(correctionKind)) {
    errors.push({ field: "kind", message: "kind must be add or replace." });
  } else if (correctionKind === "replace" && !targetEventId) {
    errors.push({
      field: "targetEventId",
      message: "targetEventId is required to replace an event."
    });
  } else if (correctionKind === "add" && targetEventId) {
    errors.push({
      field: "targetEventId",
      message: "targetEventId is only for kind replace."
    });
  }

  if (typeof reasonRaw !== "string") {
    errors.push({ field: "reason", message: "reason is required." });
  } else {
    reason = reasonRaw.trim();

    if (reason.length === 0 || reason.length > ATTENDANCE_LIMITS.reason) {
      errors.push({
        field: "reason",
        message: `reason must be 1-${ATTENDANCE_LIMITS.reason} characters.`
      });
    } else if (CONTROL_CHARACTERS.test(reason)) {
      errors.push({
        field: "reason",
        message: "reason must not contain control characters."
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return finish(errors, {
    employmentId: employmentId!,
    kind: correctionKind as CorrectionKind,
    targetEventId,
    proposedKind: proposedKind!,
    proposedOccurredAt: proposedOccurredAt!,
    reason
  });
}
