/**
 * Pure validation for the admin sync node management endpoint
 * (`PATCH /api/v1/sync/nodes/{id}`). Same shape/style as
 * `identity-access/domain/user-management.ts`'s update validators — no I/O
 * here.
 */
export type ValidationError = {
  field: string;
  message: string;
};

export type UpdateSyncNodeInput = {
  status?: "active" | "inactive";
  nodeName?: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const NODE_STATUSES = new Set(["active", "inactive"]);

export function validateUpdateSyncNodeInput(
  body: unknown
): Result<UpdateSyncNodeInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateSyncNodeInput = {};

  if (record.status !== undefined) {
    if (
      typeof record.status !== "string" ||
      !NODE_STATUSES.has(record.status)
    ) {
      errors.push({
        field: "status",
        message: "status must be 'active' or 'inactive'."
      });
    } else {
      value.status = record.status as "active" | "inactive";
    }
  }

  if (record.nodeName !== undefined) {
    if (
      typeof record.nodeName !== "string" ||
      record.nodeName.trim().length === 0
    ) {
      errors.push({
        field: "nodeName",
        message: "nodeName must be a non-empty string."
      });
    } else {
      value.nodeName = record.nodeName.trim();
    }
  }

  if (
    errors.length === 0 &&
    value.status === undefined &&
    value.nodeName === undefined
  ) {
    errors.push({
      field: "body",
      message: "Provide at least one of status or nodeName."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
