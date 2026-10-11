/**
 * Request validation for shift templates and assignments (Issue #946,
 * ADR-0132). Pure — no database, no config.
 *
 * **Strict bodies.** Every validator rejects a key it does not know. There is no
 * `reason`, `note` or `comment` field on an assignment on purpose: sick leave is
 * health data, so time off carries a coarse category and nothing else.
 */
import {
  isCalendarDate,
  type Validated,
  type ValidationError
} from "./hr-workforce-validation";
import { isValidTimeZone } from "./hr-shift-time";
import {
  SHIFT_LIMITS,
  isShiftKind,
  isTimeOffKind,
  type ShiftKind,
  type TimeOffKind
} from "./hr-shift-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::(\d{2})(?:\.\d+)?)?Z$/;
const MINUTE_MS = 60_000;

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
        message: `${key} is not an accepted field. A shift carries no free text and no personal data.`
      });
    }
  }

  return body;
}

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
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

function integer(
  body: Body,
  field: string,
  min: number,
  max: number,
  errors: ValidationError[]
): number | null {
  const value = body[field];

  if (value === undefined || value === null) {
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
      message: `${field} must be an integer ${min}-${max}.`
    });
    return null;
  }

  return value;
}

function zone(body: Body, errors: ValidationError[]): string | null {
  const value = body.timeZone;

  if (value === undefined || value === null) {
    return null;
  }

  if (!isValidTimeZone(value)) {
    errors.push({
      field: "timeZone",
      message: "timeZone must be an IANA zone name, e.g. Asia/Jakarta."
    });
    return null;
  }

  return value;
}

/** A whole-minute UTC instant ending in `Z`. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = INSTANT_PATTERN.exec(value);

  if (!match || (match[1] !== undefined && match[1] !== "00")) {
    return null;
  }

  if (/\.\d*[1-9]/.test(value)) {
    return null;
  }

  const date = new Date(value);
  const ms = date.getTime();

  return Number.isFinite(ms) && ms % MINUTE_MS === 0 ? date : null;
}

function instant(
  body: Body,
  field: string,
  errors: ValidationError[]
): Date | null {
  const value = body[field];

  if (value === undefined || value === null) {
    return null;
  }

  const parsed = parseInstant(value);

  if (!parsed) {
    errors.push({
      field,
      message: `${field} must be a whole-minute UTC instant ending in Z, e.g. 2026-10-12T01:00:00Z.`
    });
  }

  return parsed;
}

// --- Templates ----------------------------------------------------------------------

export type TemplateBreak = { offsetMinutes: number; minutes: number } | null;

export type CreateTemplateInput = {
  code: string;
  name: string;
  localStart: string;
  durationMinutes: number;
  break: TemplateBreak;
  timeZone: string;
  officeId: string | null;
};

function readName(body: Body, errors: ValidationError[]): string | null {
  const name = body.name;

  if (
    typeof name !== "string" ||
    name.trim().length < 1 ||
    name.trim().length > SHIFT_LIMITS.templateName
  ) {
    errors.push({
      field: "name",
      message: `name must be 1-${SHIFT_LIMITS.templateName} characters.`
    });
    return null;
  }

  return name.trim();
}

function readLocalStart(body: Body, errors: ValidationError[]): string | null {
  const value = body.localStart;

  if (typeof value !== "string" || !LOCAL_TIME_PATTERN.test(value)) {
    errors.push({
      field: "localStart",
      message: "localStart must be HH:MM (24 hours)."
    });
    return null;
  }

  return value;
}

function readBreak(
  body: Body,
  duration: number | null,
  errors: ValidationError[]
): TemplateBreak | undefined {
  const hasOffset =
    body.breakOffsetMinutes !== undefined && body.breakOffsetMinutes !== null;
  const hasLength =
    body.breakMinutes !== undefined && body.breakMinutes !== null;

  if (!hasOffset && !hasLength) {
    return null;
  }

  if (hasOffset !== hasLength) {
    errors.push({
      field: "breakMinutes",
      message: "breakOffsetMinutes and breakMinutes go together."
    });
    return undefined;
  }

  const offset = integer(body, "breakOffsetMinutes", 0, 1439, errors);
  const minutes = integer(body, "breakMinutes", 1, 1440, errors);

  if (offset === null || minutes === null) {
    return undefined;
  }

  if (duration !== null && offset + minutes > duration) {
    errors.push({
      field: "breakMinutes",
      message: "The break must end within the shift."
    });
    return undefined;
  }

  return { offsetMinutes: offset, minutes };
}

const TEMPLATE_FIELDS = [
  "name",
  "localStart",
  "durationMinutes",
  "breakOffsetMinutes",
  "breakMinutes",
  "timeZone",
  "officeId"
] as const;

export function validateCreateTemplate(
  raw: unknown
): Validated<CreateTemplateInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["code", ...TEMPLATE_FIELDS], errors);

  if (!body) {
    return { valid: false, errors };
  }

  const code =
    typeof body.code === "string" && CODE_PATTERN.test(body.code)
      ? body.code
      : null;

  if (!code) {
    errors.push({
      field: "code",
      message:
        "code must be 1-32 characters: letters, digits, and _ . -, starting with a letter or digit."
    });
  }

  const name = readName(body, errors);
  const localStart = readLocalStart(body, errors);
  const durationMinutes = integer(
    body,
    "durationMinutes",
    SHIFT_LIMITS.workMinMinutes,
    1440,
    errors
  );

  if (body.durationMinutes === undefined || body.durationMinutes === null) {
    errors.push({
      field: "durationMinutes",
      message: "durationMinutes is required."
    });
  }

  const breakValue = readBreak(body, durationMinutes, errors);
  const timeZone = zone(body, errors);

  if (!timeZone && !errors.some((e) => e.field === "timeZone")) {
    errors.push({ field: "timeZone", message: "timeZone is required." });
  }

  const officeId = uuid(body, "officeId", errors, false);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      code: code!,
      name: name!,
      localStart: localStart!,
      durationMinutes: durationMinutes!,
      break: breakValue ?? null,
      timeZone: timeZone!,
      officeId
    }
  };
}

/** A partial update: only the keys present change; `officeId: null` or both break keys `null` clear them. */
export type UpdateTemplateInput = {
  name?: string;
  localStart?: string;
  durationMinutes?: number;
  break?: TemplateBreak;
  timeZone?: string;
  officeId?: string | null;
};

export function validateUpdateTemplate(
  raw: unknown
): Validated<UpdateTemplateInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, TEMPLATE_FIELDS, errors);

  if (!body) {
    return { valid: false, errors };
  }

  const value: UpdateTemplateInput = {};

  if (body.name !== undefined) {
    const name = readName(body, errors);

    if (name !== null) value.name = name;
  }

  if (body.localStart !== undefined) {
    const localStart = readLocalStart(body, errors);

    if (localStart !== null) value.localStart = localStart;
  }

  if (body.durationMinutes !== undefined) {
    const duration = integer(
      body,
      "durationMinutes",
      SHIFT_LIMITS.workMinMinutes,
      1440,
      errors
    );

    if (duration !== null) value.durationMinutes = duration;
    else if (body.durationMinutes === null) {
      errors.push({
        field: "durationMinutes",
        message: "durationMinutes cannot be null."
      });
    }
  }

  if (
    body.breakOffsetMinutes !== undefined ||
    body.breakMinutes !== undefined
  ) {
    const bothNull =
      body.breakOffsetMinutes === null && body.breakMinutes === null;
    const breakValue = bothNull
      ? null
      : readBreak(body, value.durationMinutes ?? null, errors);

    if (breakValue !== undefined) value.break = breakValue;
  }

  if (body.timeZone !== undefined) {
    const timeZone = zone(body, errors);

    if (timeZone) value.timeZone = timeZone;
    else if (body.timeZone === null) {
      errors.push({ field: "timeZone", message: "timeZone cannot be null." });
    }
  }

  if (body.officeId !== undefined) {
    value.officeId = uuid(body, "officeId", errors, false);
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message: "Provide at least one field to change."
    });
  }

  return finish(errors, value);
}

// --- Assignments ----------------------------------------------------------------------

type AssignmentCommon = {
  employmentId: string;
  kind: ShiftKind;
  timeOffKind: TimeOffKind | null;
  officeId: string | null;
};

export type CreateAssignmentInput = AssignmentCommon &
  (
    | { source: "template"; templateId: string; localDate: string }
    | {
        source: "explicit";
        startsAt: Date;
        endsAt: Date;
        breakStartsAt: Date | null;
        breakEndsAt: Date | null;
        timeZone: string;
      }
  );

const ASSIGNMENT_FIELDS = [
  "employmentId",
  "kind",
  "timeOffKind",
  "templateId",
  "localDate",
  "startsAt",
  "endsAt",
  "breakStartsAt",
  "breakEndsAt",
  "timeZone",
  "officeId"
] as const;

export function validateCreateAssignment(
  raw: unknown
): Validated<CreateAssignmentInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ASSIGNMENT_FIELDS, errors);

  if (!body) {
    return { valid: false, errors };
  }

  const employmentId = uuid(body, "employmentId", errors, true);
  const officeId = uuid(body, "officeId", errors, false);
  const kind = isShiftKind(body.kind) ? body.kind : null;

  if (!kind) {
    errors.push({ field: "kind", message: "kind must be work or time_off." });
  }

  let timeOffKind: TimeOffKind | null = null;

  if (kind === "time_off") {
    if (isTimeOffKind(body.timeOffKind)) {
      timeOffKind = body.timeOffKind;
    } else {
      errors.push({
        field: "timeOffKind",
        message:
          "timeOffKind must be leave, holiday or other. A reason is never accepted."
      });
    }
  } else if (
    kind === "work" &&
    body.timeOffKind !== undefined &&
    body.timeOffKind !== null
  ) {
    errors.push({
      field: "timeOffKind",
      message: "timeOffKind applies to time_off only."
    });
  }

  const templateId = uuid(body, "templateId", errors, false);

  if (templateId) {
    if (kind === "time_off") {
      errors.push({
        field: "templateId",
        message: "A template describes work, not time off."
      });
    }

    for (const field of [
      "startsAt",
      "endsAt",
      "breakStartsAt",
      "breakEndsAt",
      "timeZone"
    ]) {
      if (body[field] !== undefined && body[field] !== null) {
        errors.push({
          field,
          message: `${field} comes from the template; send templateId and localDate, or the explicit interval, not both.`
        });
      }
    }

    const localDate = body.localDate;

    if (typeof localDate !== "string" || !isCalendarDate(localDate)) {
      errors.push({
        field: "localDate",
        message: "localDate must be a calendar date, YYYY-MM-DD."
      });
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      value: {
        source: "template",
        employmentId: employmentId!,
        kind: kind!,
        timeOffKind,
        officeId,
        templateId,
        localDate: localDate as string
      }
    };
  }

  if (body.localDate !== undefined && body.localDate !== null) {
    errors.push({
      field: "localDate",
      message: "localDate needs a templateId."
    });
  }

  const startsAt = instant(body, "startsAt", errors);
  const endsAt = instant(body, "endsAt", errors);
  const breakStartsAt = instant(body, "breakStartsAt", errors);
  const breakEndsAt = instant(body, "breakEndsAt", errors);
  const timeZone = zone(body, errors);

  for (const [field, present] of [
    ["startsAt", startsAt],
    ["endsAt", endsAt],
    ["timeZone", timeZone]
  ] as const) {
    if (!present && !errors.some((e) => e.field === field)) {
      errors.push({
        field,
        message: `${field} is required without a templateId.`
      });
    }
  }

  if (startsAt && endsAt) {
    const length = endsAt.getTime() - startsAt.getTime();
    const limit =
      kind === "time_off"
        ? SHIFT_LIMITS.timeOffMaxMinutes
        : SHIFT_LIMITS.workMaxMinutes;

    if (length <= 0) {
      errors.push({
        field: "endsAt",
        message: "endsAt must be after startsAt."
      });
    } else if (
      kind === "work" &&
      length < SHIFT_LIMITS.workMinMinutes * MINUTE_MS
    ) {
      errors.push({
        field: "endsAt",
        message: `A work shift is at least ${SHIFT_LIMITS.workMinMinutes} minutes.`
      });
    } else if (length > limit * MINUTE_MS) {
      errors.push({
        field: "endsAt",
        message:
          kind === "time_off"
            ? "Time off is at most 31 days."
            : "A work shift is at most 24 hours."
      });
    }

    if ((breakStartsAt === null) !== (breakEndsAt === null)) {
      errors.push({
        field: "breakEndsAt",
        message: "breakStartsAt and breakEndsAt go together."
      });
    } else if (breakStartsAt && breakEndsAt) {
      if (kind !== "work") {
        errors.push({
          field: "breakStartsAt",
          message: "A break applies to a work shift only."
        });
      } else if (
        breakEndsAt <= breakStartsAt ||
        breakStartsAt < startsAt ||
        breakEndsAt > endsAt
      ) {
        errors.push({
          field: "breakStartsAt",
          message: "The break must be a non-empty interval inside the shift."
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      source: "explicit",
      employmentId: employmentId!,
      kind: kind!,
      timeOffKind,
      officeId,
      startsAt: startsAt!,
      endsAt: endsAt!,
      breakStartsAt,
      breakEndsAt,
      timeZone: timeZone!
    }
  };
}
