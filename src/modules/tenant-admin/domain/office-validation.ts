export type ValidationError = { field: string; message: string };

type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export const OFFICE_TYPES = [
  "head_office",
  "branch",
  "store",
  "warehouse",
  "other"
] as const;
export type OfficeType = (typeof OFFICE_TYPES)[number];

export const OFFICE_STATUSES = ["active", "inactive"] as const;
export type OfficeStatus = (typeof OFFICE_STATUSES)[number];

export type CreateOfficeInput = {
  officeCode: string;
  officeName: string;
  officeType: OfficeType;
  parentOfficeId: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCreateOfficeInput(
  body: unknown
): ValidationResult<CreateOfficeInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.officeCode !== "string" ||
    record.officeCode.trim().length === 0
  ) {
    errors.push({ field: "officeCode", message: "officeCode is required." });
  }

  if (
    typeof record.officeName !== "string" ||
    record.officeName.trim().length === 0
  ) {
    errors.push({ field: "officeName", message: "officeName is required." });
  }

  let officeType: OfficeType = "branch";

  if (record.officeType !== undefined) {
    if (
      typeof record.officeType !== "string" ||
      !OFFICE_TYPES.includes(record.officeType as OfficeType)
    ) {
      errors.push({
        field: "officeType",
        message: `officeType must be one of: ${OFFICE_TYPES.join(", ")}.`
      });
    } else {
      officeType = record.officeType as OfficeType;
    }
  }

  let parentOfficeId: string | null = null;

  if (record.parentOfficeId !== undefined && record.parentOfficeId !== null) {
    if (
      typeof record.parentOfficeId !== "string" ||
      !UUID_PATTERN.test(record.parentOfficeId)
    ) {
      errors.push({
        field: "parentOfficeId",
        message: "parentOfficeId must be a valid UUID."
      });
    } else {
      parentOfficeId = record.parentOfficeId;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      officeCode: (record.officeCode as string).trim(),
      officeName: (record.officeName as string).trim(),
      officeType,
      parentOfficeId
    }
  };
}

export type UpdateOfficeInput = {
  officeName?: string;
  officeType?: OfficeType;
  status?: OfficeStatus;
};

export function validateUpdateOfficeInput(
  body: unknown
): ValidationResult<UpdateOfficeInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const value: UpdateOfficeInput = {};

  if (record.officeName !== undefined) {
    if (
      typeof record.officeName !== "string" ||
      record.officeName.trim().length === 0
    ) {
      errors.push({
        field: "officeName",
        message: "officeName must be a non-empty string."
      });
    } else {
      value.officeName = record.officeName.trim();
    }
  }

  if (record.officeType !== undefined) {
    if (
      typeof record.officeType !== "string" ||
      !OFFICE_TYPES.includes(record.officeType as OfficeType)
    ) {
      errors.push({
        field: "officeType",
        message: `officeType must be one of: ${OFFICE_TYPES.join(", ")}.`
      });
    } else {
      value.officeType = record.officeType as OfficeType;
    }
  }

  if (record.status !== undefined) {
    if (
      typeof record.status !== "string" ||
      !OFFICE_STATUSES.includes(record.status as OfficeStatus)
    ) {
      errors.push({
        field: "status",
        message: `status must be one of: ${OFFICE_STATUSES.join(", ")}.`
      });
    } else {
      value.status = record.status as OfficeStatus;
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message: "Provide at least one of officeName, officeType, status."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}

export type DeleteOfficeInput = { reason: string | null };

/**
 * Validates the OPTIONAL body of `DELETE /api/v1/offices/{id}`. `reason` is
 * echoed into `awcms_offices.delete_reason` and the audit event, but the verb
 * is meaningful with no body at all (a bodyless soft-delete), so an absent /
 * null reason is accepted and normalised to `null`. A `reason` that is present
 * but blank is rejected — an empty string carries no more intent than omitting
 * it, and silently storing `""` would hide that.
 */
export function validateDeleteOfficeInput(
  body: unknown
): ValidationResult<DeleteOfficeInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  let reason: string | null = null;

  if (record.reason !== undefined && record.reason !== null) {
    if (
      typeof record.reason !== "string" ||
      record.reason.trim().length === 0
    ) {
      errors.push({
        field: "reason",
        message: "reason must be a non-empty string when provided."
      });
    } else {
      reason = record.reason.trim();
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: { reason } };
}
