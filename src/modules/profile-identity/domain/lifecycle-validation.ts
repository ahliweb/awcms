export type ValidationError = { field: string; message: string };

export type DeleteReasonRequestBody = { reason: string };

export type DeleteReasonValidationResult =
  | { valid: true; value: DeleteReasonRequestBody }
  | { valid: false; errors: ValidationError[] };

/** `reason` becomes `delete_reason` on `awcms_profiles` and is echoed into the audit event attributes. */
export function validateDeleteReasonRequestBody(
  body: unknown
): DeleteReasonValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
    errors.push({ field: "reason", message: "reason is required." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: { reason: (record.reason as string).trim() } };
}
