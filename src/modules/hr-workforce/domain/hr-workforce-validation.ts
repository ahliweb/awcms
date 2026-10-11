/**
 * Request validation for `hr_workforce` (Issue #945, ADR-0132). Pure — no
 * database, no config.
 *
 * **Strict bodies.** Every validator rejects a key it does not know, so a client
 * can never assert `terminatedOn` (derived from a `terminated` term) or a
 * personal field (`name`, `nik`, `npwp`, a photo): the employment REFERENCES a
 * `profile_identity` party and never carries a copy of it.
 */
import {
  isEmploymentStatus,
  isEmploymentType,
  type EmploymentStatus,
  type EmploymentType
} from "./hr-workforce-types";

export type ValidationError = { field: string; message: string };

export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMPLOYEE_NO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/;
const WORKFLOW_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,99}$/;

/** Mirror the CHECK constraints in `sql/176`. */
export const HR_WORKFORCE_LIMITS = {
  employeeNo: 64,
  jobTitle: 120,
  reason: 500,
  clockSkewMaxSeconds: 3600,
  minYear: 1900,
  maxYear: 2200
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
        message: `${key} is not an accepted field. An employment references a profile_identity party and never carries personal data, and its end date is derived from a terminated term.`
      });
    }
  }

  return body;
}

function finish<T>(errors: ValidationError[], value: T): Validated<T> {
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

function uuidField(
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

/** A real calendar date, `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));

  // A bounded range: `date` accepts far more than any employment can mean, and
  // an absurd year would otherwise reach the database and the `infinity` logic.
  return (
    year >= HR_WORKFORCE_LIMITS.minYear &&
    year <= HR_WORKFORCE_LIMITS.maxYear &&
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

function jobTitleField(body: Body, errors: ValidationError[]): string | null {
  const value = body.jobTitle;

  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > HR_WORKFORCE_LIMITS.jobTitle
  ) {
    errors.push({
      field: "jobTitle",
      message: `jobTitle must be 1-${HR_WORKFORCE_LIMITS.jobTitle} characters.`
    });
    return null;
  }

  return value.trim();
}

export type TermsInput = {
  officeId: string | null;
  managerEmploymentId: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  status: EmploymentStatus;
};

function readTerms(
  body: Body,
  errors: ValidationError[],
  allowTerminated: boolean
): TermsInput | null {
  const officeId = uuidField(body, "officeId", errors, false);
  const managerEmploymentId = uuidField(
    body,
    "managerEmploymentId",
    errors,
    false
  );
  const jobTitle = jobTitleField(body, errors);

  if (!isEmploymentType(body.employmentType)) {
    errors.push({
      field: "employmentType",
      message:
        "employmentType must be one of permanent, fixed_term, part_time, casual."
    });
  }

  if (!isEmploymentStatus(body.status)) {
    errors.push({
      field: "status",
      message: "status must be one of active, on_leave, suspended, terminated."
    });
  } else if (body.status === "terminated" && !allowTerminated) {
    errors.push({
      field: "status",
      message:
        "A new employment cannot start terminated; record a terminated term on an existing employment."
    });
  }

  if (
    !isEmploymentType(body.employmentType) ||
    !isEmploymentStatus(body.status)
  ) {
    return null;
  }

  return {
    officeId,
    managerEmploymentId,
    jobTitle,
    employmentType: body.employmentType,
    status: body.status
  };
}

export type CreateEmploymentInput = {
  profileId: string;
  employeeNo: string;
  hiredOn: string;
  terms: TermsInput;
};

export function validateCreateEmployment(
  raw: unknown
): Validated<CreateEmploymentInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "profileId",
      "employeeNo",
      "hiredOn",
      "officeId",
      "managerEmploymentId",
      "jobTitle",
      "employmentType",
      "status"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const profileId = uuidField(body, "profileId", errors, true);
  const hiredOn = dateField(body, "hiredOn", errors, true);

  if (
    typeof body.employeeNo !== "string" ||
    !EMPLOYEE_NO_PATTERN.test(body.employeeNo)
  ) {
    errors.push({
      field: "employeeNo",
      message: `employeeNo must be 1-${HR_WORKFORCE_LIMITS.employeeNo} characters: letters, digits, and _ . / -, starting with a letter or digit.`
    });
  }

  const terms = readTerms(body, errors, false);

  if (errors.length > 0 || !profileId || !hiredOn || !terms) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      profileId,
      employeeNo: body.employeeNo as string,
      hiredOn,
      terms
    }
  };
}

export type ChangeTermsInput = { effectiveFrom: string; terms: TermsInput };

export function validateChangeTerms(raw: unknown): Validated<ChangeTermsInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    [
      "effectiveFrom",
      "officeId",
      "managerEmploymentId",
      "jobTitle",
      "employmentType",
      "status"
    ],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  const effectiveFrom = dateField(body, "effectiveFrom", errors, true);
  const terms = readTerms(body, errors, true);

  if (errors.length > 0 || !effectiveFrom || !terms) {
    return { valid: false, errors };
  }

  return { valid: true, value: { effectiveFrom, terms } };
}

export type AssignAccountInput = { tenantUserId: string | null };

export function validateAssignAccount(
  raw: unknown
): Validated<AssignAccountInput> {
  const errors: ValidationError[] = [];
  const body = asBody(raw, ["tenantUserId"], errors);

  if (!body) {
    return { valid: false, errors };
  }

  if (!("tenantUserId" in body)) {
    errors.push({
      field: "tenantUserId",
      message: "tenantUserId is required (a UUID, or null to unlink)."
    });
  }

  const tenantUserId = uuidField(body, "tenantUserId", errors, false);

  return finish(errors, { tenantUserId });
}

export function validateReason(
  required: boolean
): (raw: unknown) => Validated<{ reason: string | null }> {
  return (raw) => {
    const errors: ValidationError[] = [];
    const body = asBody(raw ?? {}, ["reason"], errors);
    let reason: string | null = null;

    if (body && body.reason !== undefined && body.reason !== null) {
      if (
        typeof body.reason !== "string" ||
        body.reason.trim().length < 1 ||
        body.reason.length > HR_WORKFORCE_LIMITS.reason
      ) {
        errors.push({
          field: "reason",
          message: `reason must be 1-${HR_WORKFORCE_LIMITS.reason} characters.`
        });
      } else {
        reason = body.reason.trim();
      }
    } else if (body && required) {
      errors.push({ field: "reason", message: "reason is required." });
    }

    return finish(errors, { reason });
  };
}

export function validateEmptyBody(
  raw: unknown
): Validated<Record<string, never>> {
  const errors: ValidationError[] = [];

  asBody(raw ?? {}, [], errors);

  return finish(errors, {});
}

export type SettingsInput = {
  clockSkewSeconds: number | null;
  correctionWorkflowKey: string | null;
};

export function validateSettings(raw: unknown): Validated<SettingsInput> {
  const errors: ValidationError[] = [];
  const body = asBody(
    raw,
    ["clockSkewSeconds", "correctionWorkflowKey"],
    errors
  );

  if (!body) {
    return { valid: false, errors };
  }

  let clockSkewSeconds: number | null = null;
  let correctionWorkflowKey: string | null = null;

  if (body.clockSkewSeconds !== undefined) {
    if (
      typeof body.clockSkewSeconds !== "number" ||
      !Number.isInteger(body.clockSkewSeconds) ||
      body.clockSkewSeconds < 0 ||
      body.clockSkewSeconds > HR_WORKFORCE_LIMITS.clockSkewMaxSeconds
    ) {
      errors.push({
        field: "clockSkewSeconds",
        message: `clockSkewSeconds must be an integer 0-${HR_WORKFORCE_LIMITS.clockSkewMaxSeconds}.`
      });
    } else {
      clockSkewSeconds = body.clockSkewSeconds;
    }
  }

  if (body.correctionWorkflowKey !== undefined) {
    if (
      typeof body.correctionWorkflowKey !== "string" ||
      !WORKFLOW_KEY_PATTERN.test(body.correctionWorkflowKey)
    ) {
      errors.push({
        field: "correctionWorkflowKey",
        message:
          "correctionWorkflowKey must be a lower-case key: letters, digits, and _ . -, starting with a letter."
      });
    } else {
      correctionWorkflowKey = body.correctionWorkflowKey;
    }
  }

  if (
    errors.length === 0 &&
    clockSkewSeconds === null &&
    correctionWorkflowKey === null
  ) {
    errors.push({
      field: "body",
      message: "Provide clockSkewSeconds and/or correctionWorkflowKey."
    });
  }

  return finish(errors, { clockSkewSeconds, correctionWorkflowKey });
}
