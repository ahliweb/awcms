/**
 * Input validation for the role (RBAC) write actions (Issue #171). Pure —
 * no I/O — so it can be unit-tested without a database. Mirrors the shape of
 * `tenant-admin/domain/office-validation.ts`: a discriminated
 * `ValidationResult<T>` with a flat `{ field, message }` error list that the
 * route surfaces via `fail(400, "VALIDATION_ERROR", …)`.
 */
export type ValidationError = { field: string; message: string };

export type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `role_code` is the stable machine identifier joined against
 * `awcms_access_assignments` and surfaced in `TenantContext.roles`, so it is
 * constrained to a slug: lowercase letters, digits, `_` and `-`. `role_name`
 * is the free-text display label.
 */
const ROLE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

const MAX_ROLE_NAME_LENGTH = 120;
const MAX_REASON_LENGTH = 500;

export type CreateRoleInput = {
  roleCode: string;
  roleName: string;
};

export function validateCreateRoleInput(
  body: unknown
): ValidationResult<CreateRoleInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  const roleCode =
    typeof record.roleCode === "string" ? record.roleCode.trim() : "";
  if (roleCode.length === 0) {
    errors.push({ field: "roleCode", message: "roleCode is required." });
  } else if (!ROLE_CODE_PATTERN.test(roleCode)) {
    errors.push({
      field: "roleCode",
      message:
        "roleCode must be 2–64 chars: lowercase letters, digits, '_' or '-'."
    });
  }

  const roleName =
    typeof record.roleName === "string" ? record.roleName.trim() : "";
  if (roleName.length === 0) {
    errors.push({ field: "roleName", message: "roleName is required." });
  } else if (roleName.length > MAX_ROLE_NAME_LENGTH) {
    errors.push({
      field: "roleName",
      message: `roleName must be at most ${MAX_ROLE_NAME_LENGTH} characters.`
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value: { roleCode, roleName } };
}

export type UpdateRoleInput = {
  roleName: string;
};

export function validateUpdateRoleInput(
  body: unknown
): ValidationResult<UpdateRoleInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  const roleName =
    typeof record.roleName === "string" ? record.roleName.trim() : "";
  if (roleName.length === 0) {
    errors.push({ field: "roleName", message: "roleName is required." });
  } else if (roleName.length > MAX_ROLE_NAME_LENGTH) {
    errors.push({
      field: "roleName",
      message: `roleName must be at most ${MAX_ROLE_NAME_LENGTH} characters.`
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value: { roleName } };
}

export type DeleteRoleInput = {
  /** Optional free-text reason echoed into the soft-delete audit event. */
  reason: string | null;
};

/**
 * The DELETE body is OPTIONAL (a bodyless `DELETE /roles/{id}` is valid, and
 * the admin UI's delete control sends none) — `delete_reason` is nullable. When
 * a `reason` IS supplied it must be a non-empty string within the length cap.
 */
export function validateDeleteRoleInput(
  body: unknown
): ValidationResult<DeleteRoleInput> {
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
    } else if (record.reason.trim().length > MAX_REASON_LENGTH) {
      errors.push({
        field: "reason",
        message: `reason must be at most ${MAX_REASON_LENGTH} characters.`
      });
    } else {
      reason = record.reason.trim();
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value: { reason } };
}

export type PermissionRefInput = {
  permissionId: string;
};

/** Shared by grant (POST) and revoke (DELETE): both carry a `permissionId` UUID. */
export function validatePermissionRefInput(
  body: unknown
): ValidationResult<PermissionRefInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  const permissionId =
    typeof record.permissionId === "string" ? record.permissionId.trim() : "";
  if (permissionId.length === 0) {
    errors.push({
      field: "permissionId",
      message: "permissionId is required."
    });
  } else if (!UUID_PATTERN.test(permissionId)) {
    errors.push({
      field: "permissionId",
      message: "permissionId must be a valid UUID."
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value: { permissionId } };
}
