/**
 * Request validation for the `booking` availability slice (Issue #938). Pure --
 * no database, no clock.
 *
 * Bodies are STRICT: a key the validator does not know is refused, so a client
 * cannot assert a server-derived fact or smuggle a recurrence string into a
 * schedule. Every instant is RFC 3339 with an explicit offset or `Z`; one
 * without is a 400, never "server local" (booking.md section 2.1). A zone is an
 * IANA name, never an offset or an abbreviation (section 2.2).
 */
import { AVAILABILITY_LIMITS } from "./booking-availability";
import {
  SCHEDULE_LIMITS,
  validateExceptionRange,
  validateOverrideWindows,
  validateScheduleRules,
  type ExceptionInput,
  type ScheduleInput,
  type ValidationError,
  type Validated
} from "./booking-schedule";
import { isLocalDate, isValidTimezone, parseLocalDate } from "./booking-time";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_WITH_OFFSET =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/i;

export const AVAILABILITY_DEFAULT_LIMIT = 100;

export type AvailabilityRequest =
  | {
      mode: "slot";
      resourceId: string;
      offeringId: string;
      quantity: number;
      fromMs: number;
      toMs: number;
      limit: number;
    }
  | {
      mode: "stay";
      resourceId: string;
      offeringId: string;
      quantity: number;
      checkInDate: string;
      checkOutDate: string;
    };

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

export function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

/** An RFC 3339 instant WITH an offset, as epoch milliseconds, or `null`. */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = RFC3339_WITH_OFFSET.exec(value);

  if (!match || !isLocalDate(match[1])) {
    return null;
  }

  const ms = Date.parse(value);

  return Number.isNaN(ms) ? null : ms;
}

function integerParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
  errors: ValidationError[]
): number {
  const raw = params.get(name);

  if (raw === null || raw === "") {
    return fallback;
  }

  if (!/^\d{1,6}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    errors.push({
      field: name,
      message: `${name} must be an integer from ${min} to ${max}.`
    });
    return fallback;
  }

  return Number(raw);
}

/**
 * The query of `GET /api/v1/booking/availability`. The resource's mode decides
 * which parameters apply, so BOTH families are parsed and the application layer
 * rejects the family that does not match the resource (`BOOKING_MODE_MISMATCH`):
 * `from`/`to` for a slot resource, `checkInDate`/`checkOutDate` for a stay.
 */
export function parseAvailabilityQuery(
  params: URLSearchParams
): Validated<AvailabilityRequest> {
  const errors: ValidationError[] = [];
  const known = [
    "resourceId",
    "offeringId",
    "quantity",
    "from",
    "to",
    "limit",
    "checkInDate",
    "checkOutDate"
  ];

  for (const key of params.keys()) {
    if (!known.includes(key)) {
      errors.push({
        field: key,
        message: `${key} is not an accepted parameter.`
      });
    }
  }

  const resourceId = asUuid(params.get("resourceId"));
  const offeringId = asUuid(params.get("offeringId"));

  if (!resourceId) {
    errors.push({ field: "resourceId", message: "resourceId must be a UUID." });
  }

  if (!offeringId) {
    errors.push({ field: "offeringId", message: "offeringId must be a UUID." });
  }

  const quantity = integerParam(params, "quantity", 1, 1, 500, errors);
  const hasSlot = params.has("from") || params.has("to");
  const hasStay = params.has("checkInDate") || params.has("checkOutDate");

  if (hasSlot && hasStay) {
    errors.push({
      field: "from",
      message:
        "Send either from/to (a slot) or checkInDate/checkOutDate (a stay), not both."
    });
  } else if (!hasSlot && !hasStay) {
    errors.push({
      field: "from",
      message:
        "Send from/to for a slot resource or checkInDate/checkOutDate for a stay resource."
    });
  }

  if (errors.length > 0 || !resourceId || !offeringId) {
    return { valid: false, errors };
  }

  if (hasStay) {
    const checkInDate = params.get("checkInDate");
    const checkOutDate = params.get("checkOutDate");

    // Malformed, instant-shaped or out-of-order dates are STAY_DATES_INVALID
    // (booking.md section 2.5), but a PARSE failure is a 400 here; the ordering
    // and zone checks are the evaluator's.
    if (!checkInDate || !parseLocalDate(checkInDate)) {
      errors.push({
        field: "checkInDate",
        message:
          "checkInDate must be a calendar date YYYY-MM-DD; an instant is never accepted for a stay."
      });
    }

    if (!checkOutDate || !parseLocalDate(checkOutDate)) {
      errors.push({
        field: "checkOutDate",
        message:
          "checkOutDate must be a calendar date YYYY-MM-DD; an instant is never accepted for a stay."
      });
    }

    return finish<AvailabilityRequest>(errors, {
      mode: "stay",
      resourceId,
      offeringId,
      quantity,
      checkInDate: checkInDate ?? "",
      checkOutDate: checkOutDate ?? ""
    });
  }

  const fromMs = parseInstant(params.get("from"));
  const toMs = parseInstant(params.get("to"));

  if (fromMs === null) {
    errors.push({
      field: "from",
      message: "from must be an RFC 3339 instant with an explicit offset or Z."
    });
  }

  if (toMs === null) {
    errors.push({
      field: "to",
      message: "to must be an RFC 3339 instant with an explicit offset or Z."
    });
  }

  if (fromMs !== null && toMs !== null) {
    if (toMs <= fromMs) {
      errors.push({
        field: "to",
        message: "The window is half-open [from, to); to must be after from."
      });
    } else if (
      toMs - fromMs >
      AVAILABILITY_LIMITS.maxSlotWindowDays * 86_400_000
    ) {
      errors.push({
        field: "to",
        message: `A search window spans at most ${AVAILABILITY_LIMITS.maxSlotWindowDays} days.`
      });
    }
  }

  const limit = integerParam(
    params,
    "limit",
    AVAILABILITY_DEFAULT_LIMIT,
    1,
    AVAILABILITY_LIMITS.maxSlots,
    errors
  );

  return finish<AvailabilityRequest>(errors, {
    mode: "slot",
    resourceId,
    offeringId,
    quantity,
    fromMs: fromMs ?? 0,
    toMs: toMs ?? 0,
    limit
  });
}

function objectBody(
  raw: unknown,
  allowed: readonly string[],
  errors: ValidationError[]
): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push({ field: "body", message: "Body must be a JSON object." });
    return null;
  }

  const body = raw as Record<string, unknown>;

  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      errors.push({ field: key, message: `${key} is not an accepted field.` });
    }
  }

  return body;
}

export function validateCreateSchedule(raw: unknown): Validated<ScheduleInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(
    raw,
    ["resourceId", "timezone", "effectiveFrom", "effectiveTo", "rules"],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  let resourceId: string | null = null;

  if (body.resourceId !== undefined && body.resourceId !== null) {
    resourceId = asUuid(body.resourceId);

    if (!resourceId) {
      errors.push({
        field: "resourceId",
        message: "resourceId must be a UUID, or null for the tenant default."
      });
    }
  }

  if (!isValidTimezone(body.timezone)) {
    errors.push({
      field: "timezone",
      message:
        "timezone must be an IANA zone name such as Asia/Pontianak; an offset or an abbreviation is refused."
    });
  }

  if (!isLocalDate(body.effectiveFrom)) {
    errors.push({
      field: "effectiveFrom",
      message: "effectiveFrom must be a calendar date YYYY-MM-DD."
    });
  }

  let effectiveTo: string | null = null;

  if (body.effectiveTo !== undefined && body.effectiveTo !== null) {
    if (!isLocalDate(body.effectiveTo)) {
      errors.push({
        field: "effectiveTo",
        message:
          "effectiveTo must be a calendar date YYYY-MM-DD, or null for open-ended."
      });
    } else {
      effectiveTo = body.effectiveTo;
    }
  }

  if (
    isLocalDate(body.effectiveFrom) &&
    effectiveTo !== null &&
    effectiveTo <= body.effectiveFrom
  ) {
    errors.push({
      field: "effectiveTo",
      message:
        "The window is half-open [effectiveFrom, effectiveTo); effectiveTo must be after effectiveFrom."
    });
  }

  const rules = validateScheduleRules(body.rules);

  if (!rules.valid) {
    errors.push(...rules.errors);
  }

  if (errors.length > 0 || !rules.valid) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      resourceId,
      timezone: body.timezone as string,
      effectiveFrom: body.effectiveFrom as string,
      effectiveTo,
      rules: rules.value
    }
  };
}

export type SchedulePatchInput = { effectiveTo?: string; status?: "inactive" };

/** `PATCH`: shorten the window or deactivate, nothing else (a schedule is superseded, not edited). */
export function validateSchedulePatch(
  raw: unknown
): Validated<SchedulePatchInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(raw, ["effectiveTo", "status"], errors);

  if (!body) {
    return { valid: false, errors };
  }

  const patch: SchedulePatchInput = {};

  if (body.effectiveTo !== undefined) {
    if (!isLocalDate(body.effectiveTo)) {
      errors.push({
        field: "effectiveTo",
        message: "effectiveTo must be a calendar date YYYY-MM-DD."
      });
    } else {
      patch.effectiveTo = body.effectiveTo;
    }
  }

  if (body.status !== undefined) {
    if (body.status !== "inactive") {
      errors.push({
        field: "status",
        message:
          "status may only be set to inactive; create a new window to reactivate."
      });
    } else {
      patch.status = "inactive";
    }
  }

  if (errors.length === 0 && Object.keys(patch).length === 0) {
    errors.push({ field: "body", message: "Send effectiveTo or status." });
  }

  return finish(errors, patch);
}

export function validateCreateException(
  raw: unknown
): Validated<ExceptionInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(
    raw,
    [
      "scheduleId",
      "resourceId",
      "localFrom",
      "localTo",
      "kind",
      "windows",
      "reasonCode"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const scheduleId = body.scheduleId == null ? null : asUuid(body.scheduleId);
  const resourceId = body.resourceId == null ? null : asUuid(body.resourceId);

  if (body.scheduleId != null && !scheduleId) {
    errors.push({ field: "scheduleId", message: "scheduleId must be a UUID." });
  }

  if (body.resourceId != null && !resourceId) {
    errors.push({ field: "resourceId", message: "resourceId must be a UUID." });
  }

  if ((scheduleId === null) === (resourceId === null) && errors.length === 0) {
    errors.push({
      field: "scheduleId",
      message: "Name exactly one of scheduleId or resourceId."
    });
  }

  validateExceptionRange(body.localFrom, body.localTo, errors);

  if (body.kind !== "closed" && body.kind !== "override_hours") {
    errors.push({
      field: "kind",
      message: "kind must be closed or override_hours."
    });
  }

  let windows: ExceptionInput["windows"] = null;

  if (body.kind === "override_hours") {
    const validation = validateOverrideWindows(body.windows);

    if (validation.valid) {
      windows = validation.value;
    } else {
      errors.push(...validation.errors);
    }
  } else if (body.kind === "closed" && body.windows != null) {
    errors.push({
      field: "windows",
      message: "A closed exception takes no windows."
    });
  }

  let reasonCode: string | null = null;

  if (body.reasonCode != null) {
    if (
      typeof body.reasonCode !== "string" ||
      !SCHEDULE_LIMITS.reasonCode.test(body.reasonCode)
    ) {
      errors.push({
        field: "reasonCode",
        message:
          "reasonCode is a short code (lowercase letters, digits, underscore), never free text."
      });
    } else {
      reasonCode = body.reasonCode;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      scheduleId,
      resourceId,
      localFrom: body.localFrom as string,
      localTo: body.localTo as string,
      kind: body.kind as "closed" | "override_hours",
      windows,
      reasonCode
    }
  };
}

/** The offering validator's step rule: whole seconds, at least the 300 s floor of sql/186. */
export function validateSlotStepSeconds(
  value: unknown
): ValidationError | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AVAILABILITY_LIMITS.minSlotStepSeconds
    ? null
    : {
        field: "slotStepSeconds",
        message: `slotStepSeconds must be a whole number of seconds, at least ${AVAILABILITY_LIMITS.minSlotStepSeconds}.`
      };
}
