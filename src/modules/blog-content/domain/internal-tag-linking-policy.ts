/**
 * `PATCH /api/v1/blog/internal-tag-links/settings` validator (Issue #641).
 * Shape-only — `disabledTagIds` existence/tenant-ownership/taxonomy-type
 * checks require a database round trip and are done by the application
 * layer (`internal-tag-link-settings-directory.ts`'s
 * `countExistingTagTermIds`), same split `validateTermIds` in
 * `blog-post-validation.ts` already uses for `termIds`.
 */
export type ValidationError = {
  field: string;
  message: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_DISABLED_TAG_IDS = 500;

export type UpdateInternalTagLinkingSettingsInput = {
  enabled?: boolean;
  caseInsensitive?: boolean;
  disabledTagIds?: string[];
};

export type UpdateInternalTagLinkingSettingsValidationResult =
  | { valid: true; value: UpdateInternalTagLinkingSettingsInput }
  | { valid: false; errors: ValidationError[] };

function validateDisabledTagIds(
  value: unknown
): { valid: true; value: string[] } | { valid: false } {
  if (
    !Array.isArray(value) ||
    value.length > MAX_DISABLED_TAG_IDS ||
    !value.every((item) => typeof item === "string" && UUID_PATTERN.test(item))
  ) {
    return { valid: false };
  }

  return { valid: true, value: [...new Set(value as string[])] };
}

export function validateUpdateInternalTagLinkingSettingsInput(
  body: unknown
): UpdateInternalTagLinkingSettingsValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateInternalTagLinkingSettingsInput = {};

  if (record.enabled !== undefined) {
    if (typeof record.enabled !== "boolean") {
      errors.push({ field: "enabled", message: "enabled must be a boolean." });
    } else {
      value.enabled = record.enabled;
    }
  }

  if (record.caseInsensitive !== undefined) {
    if (typeof record.caseInsensitive !== "boolean") {
      errors.push({
        field: "caseInsensitive",
        message: "caseInsensitive must be a boolean."
      });
    } else {
      value.caseInsensitive = record.caseInsensitive;
    }
  }

  if (record.disabledTagIds !== undefined) {
    const result = validateDisabledTagIds(record.disabledTagIds);
    if (!result.valid) {
      errors.push({
        field: "disabledTagIds",
        message: `disabledTagIds must be an array of at most ${MAX_DISABLED_TAG_IDS} UUIDs.`
      });
    } else {
      value.disabledTagIds = result.value;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
