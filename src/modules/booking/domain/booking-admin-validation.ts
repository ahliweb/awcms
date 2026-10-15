/**
 * Request validation for the `booking` ADMIN configuration routes (Issue #1030,
 * prerequisite of #942): resources and their units, resource pools, service
 * offerings and the tenant policy. Pure -- no database, no clock.
 *
 * Bodies are STRICT (an unknown key is a 400, so a client cannot assert a
 * server-derived fact). Every rule here restates a CHECK of `sql/180` / `sql/186`
 * so a violation is a named 400 and the database constraint stays the backstop,
 * not the first line of defence. Nothing in these bodies is a price, a payment
 * state, a product id or a customer name (booking.md section 10.2).
 */
import { AVAILABILITY_LIMITS } from "./booking-availability";
import { HOLD_LIMITS } from "./booking-allocation";
import type { ValidationError, Validated } from "./booking-schedule";
import { isValidTimezone } from "./booking-time";
import { asUuid } from "./booking-validation";

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const KIND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const ADMIN_LIMITS = {
  maxCapacity: 500,
  maxUnitLabel: 100,
  maxName: 200,
  sortOrder: 1_000_000,
  /** Ten years: far past any real lead time, short of an overflow. */
  maxLeadSeconds: 315_360_000,
  maxCap: 1_000_000,
  /** Thirty days: a no-show grace is minutes to hours; a month is the outer sanity bound. */
  maxNoShowGraceSeconds: 2_592_000,
  maxHorizonDays: 3650,
  maxNights: 366,
  maxParty: 500
} as const;

type Body = Record<string, unknown>;

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

function objectBody(
  raw: unknown,
  allowed: readonly string[],
  errors: ValidationError[]
): Body | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push({ field: "body", message: "Body must be a JSON object." });
    return null;
  }

  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      errors.push({ field: key, message: `${key} is not an accepted field.` });
    }
  }

  return raw as Body;
}

function intIn(
  body: Body,
  field: string,
  min: number,
  max: number,
  errors: ValidationError[],
  options: { nullable?: boolean } = {}
): number | null | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (value === null && options.nullable) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    errors.push({
      field,
      message: `${field} must be a whole number from ${min} to ${max}${options.nullable ? ", or null for the default" : ""}.`
    });
    return undefined;
  }

  return value;
}

function text(
  body: Body,
  field: string,
  pattern: RegExp | null,
  max: number,
  errors: ValidationError[]
): string | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    (pattern !== null && !pattern.test(value))
  ) {
    errors.push({
      field,
      message: pattern
        ? `${field} is not in the accepted format.`
        : `${field} must be 1 to ${max} characters.`
    });
    return undefined;
  }

  return value;
}

function required(
  errors: ValidationError[],
  field: string,
  value: unknown
): void {
  if (value === undefined) {
    errors.push({ field, message: `${field} is required.` });
  }
}

/** `HH:MM` or `HH:MM:SS` as `HH:MM:SS`, or `undefined` (and an error) when it is not one. */
function localTime(
  body: Body,
  field: string,
  errors: ValidationError[]
): string | null | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !LOCAL_TIME_PATTERN.test(value)) {
    errors.push({
      field,
      message: `${field} must be a local time HH:MM or HH:MM:SS, or null.`
    });
    return undefined;
  }

  return value.length === 5 ? `${value}:00` : value;
}

function uuidOrNull(
  body: Body,
  field: string,
  errors: ValidationError[]
): string | null | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const id = asUuid(value);

  if (!id) {
    errors.push({ field, message: `${field} must be a UUID, or null.` });
    return undefined;
  }

  return id;
}

function oneOf<T extends string>(
  body: Body,
  field: string,
  values: readonly T[],
  errors: ValidationError[]
): T | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !values.includes(value as T)) {
    errors.push({
      field,
      message: `${field} must be one of ${values.join(", ")}.`
    });
    return undefined;
  }

  return value as T;
}

function timezone(
  body: Body,
  field: string,
  errors: ValidationError[],
  nullable = false
): string | null | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (value === null && nullable) {
    return null;
  }

  if (!isValidTimezone(value)) {
    errors.push({
      field,
      message: `${field} must be an IANA zone name such as Asia/Jakarta (an offset or an abbreviation is refused).`
    });
    return undefined;
  }

  return value;
}

// -- Resources ---------------------------------------------------------------

export type BookingMode = "slot" | "stay";

export type ResourceShape = {
  bookingMode: BookingMode;
  stayCheckInTime: string | null;
  stayCheckOutTime: string | null;
};

/** The `awcms_booking_resources_stay_times_check`, stated for a merged row. */
export function validateResourceShape(shape: ResourceShape): ValidationError[] {
  if (shape.bookingMode === "stay") {
    return shape.stayCheckInTime === null || shape.stayCheckOutTime === null
      ? [
          {
            field: "stayCheckInTime",
            message:
              "A stay resource needs stayCheckInTime and stayCheckOutTime."
          }
        ]
      : [];
  }

  return shape.stayCheckInTime !== null || shape.stayCheckOutTime !== null
    ? [
        {
          field: "stayCheckInTime",
          message:
            "A slot resource has no check-in or check-out time; send null for both."
        }
      ]
    : [];
}

export type CreateResourceInput = ResourceShape & {
  code: string;
  name: string;
  kind: string;
  capacity: number;
  poolId: string | null;
  timezone: string;
  sortOrder: number;
  status: "active" | "inactive";
  /** Optional labels of the first units, in ordinal order; shorter than capacity is fine. */
  unitLabels: (string | null)[];
};

export function validateCreateResource(
  raw: unknown
): Validated<CreateResourceInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(
    raw,
    [
      "code",
      "name",
      "kind",
      "capacity",
      "poolId",
      "timezone",
      "bookingMode",
      "stayCheckInTime",
      "stayCheckOutTime",
      "sortOrder",
      "status",
      "unitLabels"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const code = text(body, "code", CODE_PATTERN, 64, errors);
  const name = text(body, "name", null, ADMIN_LIMITS.maxName, errors);
  const kind = text(body, "kind", KIND_PATTERN, 32, errors);
  const capacity = intIn(body, "capacity", 1, ADMIN_LIMITS.maxCapacity, errors);
  const zone = timezone(body, "timezone", errors);
  const bookingMode = oneOf(body, "bookingMode", ["slot", "stay"], errors);

  required(errors, "code", body.code);
  required(errors, "name", body.name);
  required(errors, "kind", body.kind);
  required(errors, "timezone", body.timezone);

  const poolId = uuidOrNull(body, "poolId", errors);
  const checkIn = localTime(body, "stayCheckInTime", errors);
  const checkOut = localTime(body, "stayCheckOutTime", errors);
  const sortOrder = intIn(
    body,
    "sortOrder",
    -ADMIN_LIMITS.sortOrder,
    ADMIN_LIMITS.sortOrder,
    errors
  );
  const status = oneOf(body, "status", ["active", "inactive"], errors);
  let unitLabels: (string | null)[] = [];

  if (body.unitLabels !== undefined) {
    const labels = body.unitLabels;

    if (
      !Array.isArray(labels) ||
      labels.length > (capacity ?? ADMIN_LIMITS.maxCapacity) ||
      labels.some(
        (label) =>
          label !== null &&
          (typeof label !== "string" ||
            label.length < 1 ||
            label.length > ADMIN_LIMITS.maxUnitLabel)
      )
    ) {
      errors.push({
        field: "unitLabels",
        message: `unitLabels must be an array of at most capacity entries, each null or 1 to ${ADMIN_LIMITS.maxUnitLabel} characters.`
      });
    } else {
      unitLabels = labels as (string | null)[];
    }
  }

  const mode: BookingMode = bookingMode ?? "slot";
  const shape = {
    bookingMode: mode,
    stayCheckInTime: checkIn ?? null,
    stayCheckOutTime: checkOut ?? null
  };

  if (errors.length === 0) {
    errors.push(...validateResourceShape(shape));
  }

  return finish(errors, {
    code: code ?? "",
    name: name ?? "",
    kind: kind ?? "",
    capacity: capacity ?? 1,
    poolId: poolId ?? null,
    timezone: zone ?? "",
    sortOrder: sortOrder ?? 0,
    status: status ?? "active",
    unitLabels,
    ...shape
  });
}

export type UnitPatch = {
  id: string;
  label?: string | null;
  status?: "active" | "inactive";
};

export type ResourcePatchInput = {
  name?: string;
  kind?: string;
  status?: "active" | "inactive";
  poolId?: string | null;
  timezone?: string;
  bookingMode?: BookingMode;
  stayCheckInTime?: string | null;
  stayCheckOutTime?: string | null;
  sortOrder?: number;
  /** Grow only: units are never removed, they are deactivated. */
  capacity?: number;
  units?: UnitPatch[];
};

export function validateResourcePatch(
  raw: unknown
): Validated<ResourcePatchInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(
    raw,
    [
      "name",
      "kind",
      "status",
      "poolId",
      "timezone",
      "bookingMode",
      "stayCheckInTime",
      "stayCheckOutTime",
      "sortOrder",
      "capacity",
      "units"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const patch: ResourcePatchInput = {};
  const name = text(body, "name", null, ADMIN_LIMITS.maxName, errors);
  const kind = text(body, "kind", KIND_PATTERN, 32, errors);
  const status = oneOf(body, "status", ["active", "inactive"], errors);
  const poolId = uuidOrNull(body, "poolId", errors);
  const zone = timezone(body, "timezone", errors);
  const bookingMode = oneOf(body, "bookingMode", ["slot", "stay"], errors);
  const checkIn = localTime(body, "stayCheckInTime", errors);
  const checkOut = localTime(body, "stayCheckOutTime", errors);
  const sortOrder = intIn(
    body,
    "sortOrder",
    -ADMIN_LIMITS.sortOrder,
    ADMIN_LIMITS.sortOrder,
    errors
  );
  const capacity = intIn(body, "capacity", 1, ADMIN_LIMITS.maxCapacity, errors);

  if (name !== undefined) patch.name = name;
  if (kind !== undefined) patch.kind = kind;
  if (status !== undefined) patch.status = status;
  if (poolId !== undefined) patch.poolId = poolId;
  if (zone !== undefined && zone !== null) patch.timezone = zone;
  if (bookingMode !== undefined) patch.bookingMode = bookingMode;
  if (checkIn !== undefined) patch.stayCheckInTime = checkIn;
  if (checkOut !== undefined) patch.stayCheckOutTime = checkOut;
  if (sortOrder !== undefined && sortOrder !== null) {
    patch.sortOrder = sortOrder;
  }
  if (capacity !== undefined && capacity !== null) patch.capacity = capacity;

  if (body.units !== undefined) {
    const units: UnitPatch[] = [];
    const seen = new Set<string>();
    const list = body.units;

    if (!Array.isArray(list) || list.length > ADMIN_LIMITS.maxCapacity) {
      errors.push({
        field: "units",
        message: `units must be an array of at most ${ADMIN_LIMITS.maxCapacity} unit changes.`
      });
    } else {
      list.forEach((entry, index) => {
        const field = `units[${index}]`;

        if (typeof entry !== "object" || entry === null) {
          errors.push({ field, message: "A unit change must be an object." });
          return;
        }

        const unitErrors: ValidationError[] = [];
        const unitBody = objectBody(
          entry,
          ["id", "label", "status"],
          unitErrors
        )!;
        const id = asUuid(unitBody.id);
        const label = unitBody.label;
        const unitStatus = oneOf(
          unitBody,
          "status",
          ["active", "inactive"],
          unitErrors
        );

        if (!id) {
          unitErrors.push({ field: "id", message: "id must be a UUID." });
        } else if (seen.has(id)) {
          unitErrors.push({ field: "id", message: "A unit appears twice." });
        } else {
          seen.add(id);
        }

        if (
          label !== undefined &&
          label !== null &&
          (typeof label !== "string" ||
            label.length < 1 ||
            label.length > ADMIN_LIMITS.maxUnitLabel)
        ) {
          unitErrors.push({
            field: "label",
            message: `label must be null or 1 to ${ADMIN_LIMITS.maxUnitLabel} characters.`
          });
        }

        if (label === undefined && unitStatus === undefined) {
          unitErrors.push({
            field: "label",
            message: "A unit change names a label, a status or both."
          });
        }

        for (const issue of unitErrors) {
          errors.push({
            field: `${field}.${issue.field}`,
            message: issue.message
          });
        }

        if (unitErrors.length === 0 && id) {
          units.push({
            id,
            ...(label !== undefined ? { label: label as string | null } : {}),
            ...(unitStatus !== undefined ? { status: unitStatus } : {})
          });
        }
      });
    }

    patch.units = units;
  }

  if (Object.keys(patch).length === 0 && errors.length === 0) {
    errors.push({
      field: "body",
      message: "Send at least one field to change."
    });
  }

  return finish(errors, patch);
}

// -- Resource pools ----------------------------------------------------------

export type CreatePoolInput = {
  code: string;
  name: string;
  allocationPolicy: "first_free";
};

export function validateCreatePool(raw: unknown): Validated<CreatePoolInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(raw, ["code", "name", "allocationPolicy"], errors);

  if (!body) {
    return { valid: false, errors };
  }

  const code = text(body, "code", CODE_PATTERN, 64, errors);
  const name = text(body, "name", null, ADMIN_LIMITS.maxName, errors);
  const policy = oneOf(body, "allocationPolicy", ["first_free"], errors);

  required(errors, "code", body.code);
  required(errors, "name", body.name);

  return finish(errors, {
    code: code ?? "",
    name: name ?? "",
    allocationPolicy: policy ?? "first_free"
  });
}

export type PoolPatchInput = {
  name?: string;
  allocationPolicy?: "first_free";
};

export function validatePoolPatch(raw: unknown): Validated<PoolPatchInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(raw, ["name", "allocationPolicy"], errors);

  if (!body) {
    return { valid: false, errors };
  }

  const patch: PoolPatchInput = {};
  const name = text(body, "name", null, ADMIN_LIMITS.maxName, errors);
  const policy = oneOf(body, "allocationPolicy", ["first_free"], errors);

  if (name !== undefined) patch.name = name;
  if (policy !== undefined) patch.allocationPolicy = policy;

  if (Object.keys(patch).length === 0 && errors.length === 0) {
    errors.push({
      field: "body",
      message: "Send at least one field to change."
    });
  }

  return finish(errors, patch);
}

// -- Service offerings -------------------------------------------------------

export type OfferingFields = {
  granularity: "time" | "stay";
  durationSeconds: number | null;
  setupSeconds: number | null;
  cleanupSeconds: number | null;
  slotStepSeconds: number | null;
  minNights: number | null;
  maxNights: number | null;
  minParty: number;
  maxParty: number;
  confirmationMode: "immediate" | "hold_then_confirm";
  cancellationCutoffSeconds: number | null;
  minLeadSeconds: number | null;
  maxHorizonDays: number | null;
  status: "active" | "inactive";
};

/** The `awcms_booking_service_offerings_shape_check` and the party check, stated for a merged row. */
export function validateOfferingShape(
  offering: OfferingFields
): ValidationError[] {
  const errors: ValidationError[] = [];
  const timeOnly = [
    "durationSeconds",
    "setupSeconds",
    "cleanupSeconds",
    "slotStepSeconds"
  ] as const;
  const stayOnly = ["minNights", "maxNights"] as const;

  if (offering.granularity === "time") {
    for (const field of timeOnly) {
      if (offering[field] === null) {
        errors.push({
          field,
          message: `${field} is required for a time offering.`
        });
      }
    }

    for (const field of stayOnly) {
      if (offering[field] !== null) {
        errors.push({
          field,
          message: `${field} belongs to a stay offering; send null.`
        });
      }
    }

    if (offering.durationSeconds !== null && offering.durationSeconds < 1) {
      errors.push({
        field: "durationSeconds",
        message: "durationSeconds must be at least 1."
      });
    }

    if (
      offering.slotStepSeconds !== null &&
      offering.slotStepSeconds < AVAILABILITY_LIMITS.minSlotStepSeconds
    ) {
      errors.push({
        field: "slotStepSeconds",
        message: `slotStepSeconds must be at least ${AVAILABILITY_LIMITS.minSlotStepSeconds}.`
      });
    }
  } else {
    for (const field of timeOnly) {
      if (offering[field] !== null) {
        errors.push({
          field,
          message: `${field} belongs to a time offering; send null.`
        });
      }
    }

    for (const field of stayOnly) {
      if (offering[field] === null) {
        errors.push({
          field,
          message: `${field} is required for a stay offering.`
        });
      }
    }

    if (
      offering.minNights !== null &&
      offering.maxNights !== null &&
      offering.maxNights < offering.minNights
    ) {
      errors.push({
        field: "maxNights",
        message: "maxNights must be at least minNights."
      });
    }
  }

  if (offering.maxParty < offering.minParty) {
    errors.push({
      field: "maxParty",
      message: "maxParty must be at least minParty."
    });
  }

  return errors;
}

const OFFERING_FIELDS = [
  "name",
  "durationSeconds",
  "setupSeconds",
  "cleanupSeconds",
  "slotStepSeconds",
  "minNights",
  "maxNights",
  "minParty",
  "maxParty",
  "confirmationMode",
  "cancellationCutoffSeconds",
  "minLeadSeconds",
  "maxHorizonDays",
  "status"
] as const;

/** The editable offering fields present in the body, range-checked one by one. */
function offeringFields(
  body: Body,
  errors: ValidationError[]
): Partial<OfferingFields> & { name?: string } {
  const out: Partial<OfferingFields> & { name?: string } = {};
  const name = text(body, "name", null, ADMIN_LIMITS.maxName, errors);
  const seconds = (field: string, min: number, max: number) =>
    intIn(body, field, min, max, errors, { nullable: true });

  if (name !== undefined) out.name = name;

  const duration = seconds("durationSeconds", 1, 31_536_000);
  const setup = seconds("setupSeconds", 0, 86_400);
  const cleanup = seconds("cleanupSeconds", 0, 86_400);
  const step = seconds("slotStepSeconds", 1, 86_400);
  const minNights = seconds("minNights", 1, ADMIN_LIMITS.maxNights);
  const maxNights = seconds("maxNights", 1, ADMIN_LIMITS.maxNights);
  const cutoff = seconds(
    "cancellationCutoffSeconds",
    0,
    ADMIN_LIMITS.maxLeadSeconds
  );
  const lead = seconds("minLeadSeconds", 0, ADMIN_LIMITS.maxLeadSeconds);
  const horizon = seconds("maxHorizonDays", 1, ADMIN_LIMITS.maxHorizonDays);
  const minParty = intIn(body, "minParty", 1, ADMIN_LIMITS.maxParty, errors);
  const maxParty = intIn(body, "maxParty", 1, ADMIN_LIMITS.maxParty, errors);
  const mode = oneOf(
    body,
    "confirmationMode",
    ["immediate", "hold_then_confirm"],
    errors
  );
  const status = oneOf(body, "status", ["active", "inactive"], errors);

  if (duration !== undefined) out.durationSeconds = duration;
  if (setup !== undefined) out.setupSeconds = setup;
  if (cleanup !== undefined) out.cleanupSeconds = cleanup;
  if (step !== undefined) out.slotStepSeconds = step;
  if (minNights !== undefined) out.minNights = minNights;
  if (maxNights !== undefined) out.maxNights = maxNights;
  if (cutoff !== undefined) out.cancellationCutoffSeconds = cutoff;
  if (lead !== undefined) out.minLeadSeconds = lead;
  if (horizon !== undefined) out.maxHorizonDays = horizon;
  if (minParty !== undefined && minParty !== null) out.minParty = minParty;
  if (maxParty !== undefined && maxParty !== null) out.maxParty = maxParty;
  if (mode !== undefined) out.confirmationMode = mode;
  if (status !== undefined) out.status = status;

  return out;
}

export type CreateOfferingInput = OfferingFields & {
  code: string;
  name: string;
};

export function validateCreateOffering(
  raw: unknown
): Validated<CreateOfferingInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(
    raw,
    ["code", "granularity", ...OFFERING_FIELDS],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const code = text(body, "code", CODE_PATTERN, 64, errors);
  const granularity = oneOf(body, "granularity", ["time", "stay"], errors);
  const fields = offeringFields(body, errors);

  required(errors, "code", body.code);
  required(errors, "name", body.name);
  required(errors, "granularity", body.granularity);

  const value: CreateOfferingInput = {
    code: code ?? "",
    name: fields.name ?? "",
    granularity: granularity ?? "time",
    durationSeconds: fields.durationSeconds ?? null,
    setupSeconds: fields.setupSeconds ?? (granularity === "time" ? 0 : null),
    cleanupSeconds:
      fields.cleanupSeconds ?? (granularity === "time" ? 0 : null),
    slotStepSeconds: fields.slotStepSeconds ?? null,
    minNights: fields.minNights ?? null,
    maxNights: fields.maxNights ?? null,
    minParty: fields.minParty ?? 1,
    maxParty: fields.maxParty ?? fields.minParty ?? 1,
    confirmationMode: fields.confirmationMode ?? "hold_then_confirm",
    cancellationCutoffSeconds: fields.cancellationCutoffSeconds ?? null,
    minLeadSeconds: fields.minLeadSeconds ?? null,
    maxHorizonDays: fields.maxHorizonDays ?? null,
    status: fields.status ?? "active"
  };

  if (errors.length === 0) {
    errors.push(...validateOfferingShape(value));
  }

  return finish(errors, value);
}

export type OfferingPatchInput = Partial<
  Omit<OfferingFields, "granularity">
> & {
  name?: string;
};

/** `code` and `granularity` are not editable: reservations snapshot an offering, and a changed shape would orphan the snapshots' meaning. */
export function validateOfferingPatch(
  raw: unknown
): Validated<OfferingPatchInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(raw, OFFERING_FIELDS, errors);

  if (!body) {
    return { valid: false, errors };
  }

  const patch = offeringFields(body, errors);

  if (Object.keys(patch).length === 0 && errors.length === 0) {
    errors.push({
      field: "body",
      message: "Send at least one field to change."
    });
  }

  return finish(errors, patch);
}

// -- Policy ------------------------------------------------------------------

export type PolicyInput = {
  defaultHoldSeconds: number | null;
  maxHoldSeconds: number | null;
  maxActiveHoldsPerCustomer: number | null;
  maxActiveHoldsPerTenant: number | null;
  minLeadSeconds: number | null;
  maxHorizonDays: number | null;
  noShowGraceSeconds: number | null;
  defaultTimezone: string | null;
  defaultCheckInTime: string | null;
  defaultCheckOutTime: string | null;
};

export const POLICY_FIELDS = [
  "defaultHoldSeconds",
  "maxHoldSeconds",
  "maxActiveHoldsPerCustomer",
  "maxActiveHoldsPerTenant",
  "minLeadSeconds",
  "maxHorizonDays",
  "noShowGraceSeconds",
  "defaultTimezone",
  "defaultCheckInTime",
  "defaultCheckOutTime"
] as const;

/**
 * `PUT /policy` replaces the whole policy: EVERY field must be present, and
 * `null` means "the module default" (booking.md section 13). A missing key is a
 * 400, not a silent reset to the default, so a partial client cannot wipe a
 * tenant's hold caps by omission.
 */
export function validatePolicy(raw: unknown): Validated<PolicyInput> {
  const errors: ValidationError[] = [];
  const body = objectBody(raw, POLICY_FIELDS, errors);

  if (!body) {
    return { valid: false, errors };
  }

  for (const field of POLICY_FIELDS) {
    if (body[field] === undefined) {
      errors.push({
        field,
        message: `${field} is required (null selects the module default).`
      });
    }
  }

  const nullable = { nullable: true };
  const hold = (field: string) =>
    intIn(
      body,
      field,
      HOLD_LIMITS.minSeconds,
      HOLD_LIMITS.maxSeconds,
      errors,
      nullable
    );
  const defaultHold = hold("defaultHoldSeconds");
  const maxHold = hold("maxHoldSeconds");

  if (
    typeof defaultHold === "number" &&
    typeof maxHold === "number" &&
    defaultHold > maxHold
  ) {
    errors.push({
      field: "defaultHoldSeconds",
      message: "defaultHoldSeconds must not exceed maxHoldSeconds."
    });
  }

  const perCustomer = intIn(
    body,
    "maxActiveHoldsPerCustomer",
    1,
    ADMIN_LIMITS.maxCap,
    errors,
    nullable
  );
  const perTenant = intIn(
    body,
    "maxActiveHoldsPerTenant",
    1,
    ADMIN_LIMITS.maxCap,
    errors,
    nullable
  );
  const lead = intIn(
    body,
    "minLeadSeconds",
    0,
    ADMIN_LIMITS.maxLeadSeconds,
    errors,
    nullable
  );
  const horizon = intIn(
    body,
    "maxHorizonDays",
    1,
    ADMIN_LIMITS.maxHorizonDays,
    errors,
    nullable
  );
  const grace = intIn(
    body,
    "noShowGraceSeconds",
    0,
    ADMIN_LIMITS.maxNoShowGraceSeconds,
    errors,
    nullable
  );
  const zone = timezone(body, "defaultTimezone", errors, true);
  const checkIn = localTime(body, "defaultCheckInTime", errors);
  const checkOut = localTime(body, "defaultCheckOutTime", errors);

  return finish(errors, {
    defaultHoldSeconds: defaultHold ?? null,
    maxHoldSeconds: maxHold ?? null,
    maxActiveHoldsPerCustomer: perCustomer ?? null,
    maxActiveHoldsPerTenant: perTenant ?? null,
    minLeadSeconds: lead ?? null,
    maxHorizonDays: horizon ?? null,
    noShowGraceSeconds: grace ?? null,
    defaultTimezone: zone ?? null,
    defaultCheckInTime: checkIn ?? null,
    defaultCheckOutTime: checkOut ?? null
  });
}
