import { isValidSlug } from "./slug-policy";

/**
 * Templates (Issue #542 §Templates: "Support layout configuration...
 * Template rendering must stay within safe predefined layout rules").
 * `layoutJson` is a **whitelisted shape**, not arbitrary JSON — only the
 * fields below are ever read by a renderer, so there is no path from a
 * template row to executable script, matching the same "whitelist
 * everything, no raw escape hatch" convention `content-block-rendering.ts`
 * established for `content_json` (Issue #540).
 */
export type ValidationError = {
  field: string;
  message: string;
};

export type TemplateLayout = {
  columns: 1 | 2 | 3;
  sidebarPosition: "left" | "right" | "none";
};

const VALID_COLUMNS = new Set([1, 2, 3]);
const VALID_SIDEBAR_POSITIONS = new Set(["left", "right", "none"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateTemplateLayout(
  value: unknown
): { valid: true; value: TemplateLayout } | { valid: false } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false };
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.columns !== "number" ||
    !VALID_COLUMNS.has(record.columns) ||
    typeof record.sidebarPosition !== "string" ||
    !VALID_SIDEBAR_POSITIONS.has(record.sidebarPosition)
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    value: {
      columns: record.columns as 1 | 2 | 3,
      sidebarPosition: record.sidebarPosition as "left" | "right" | "none"
    }
  };
}

export type CreateTemplateInput = {
  key: string;
  name: string;
  layoutJson: TemplateLayout;
  isActive: boolean;
};

export type CreateTemplateValidationResult =
  | { valid: true; value: CreateTemplateInput }
  | { valid: false; errors: ValidationError[] };

export function validateCreateTemplateInput(
  body: unknown
): CreateTemplateValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(record.key) || !isValidSlug(record.key.trim())) {
    errors.push({
      field: "key",
      message:
        "key is required and must be lowercase alphanumeric segments separated by single hyphens."
    });
  }

  if (!isNonEmptyString(record.name)) {
    errors.push({ field: "name", message: "name is required." });
  }

  const layoutResult = validateTemplateLayout(record.layoutJson);

  if (!layoutResult.valid) {
    errors.push({
      field: "layoutJson",
      message:
        "layoutJson must be { columns: 1|2|3, sidebarPosition: 'left'|'right'|'none' }."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      key: (record.key as string).trim(),
      name: (record.name as string).trim(),
      layoutJson: (layoutResult as { valid: true; value: TemplateLayout })
        .value,
      isActive: record.isActive !== false
    }
  };
}

export type UpdateTemplateInput = {
  name?: string;
  layoutJson?: TemplateLayout;
  isActive?: boolean;
};

export type UpdateTemplateValidationResult =
  | { valid: true; value: UpdateTemplateInput }
  | { valid: false; errors: ValidationError[] };

export function validateUpdateTemplateInput(
  body: unknown
): UpdateTemplateValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const value: UpdateTemplateInput = {};

  if (record.name !== undefined) {
    if (!isNonEmptyString(record.name)) {
      errors.push({
        field: "name",
        message: "name must be a non-empty string."
      });
    } else {
      value.name = record.name.trim();
    }
  }

  if (record.layoutJson !== undefined) {
    const layoutResult = validateTemplateLayout(record.layoutJson);

    if (!layoutResult.valid) {
      errors.push({
        field: "layoutJson",
        message:
          "layoutJson must be { columns: 1|2|3, sidebarPosition: 'left'|'right'|'none' }."
      });
    } else {
      value.layoutJson = layoutResult.value;
    }
  }

  if (record.isActive !== undefined) {
    if (typeof record.isActive !== "boolean") {
      errors.push({
        field: "isActive",
        message: "isActive must be a boolean."
      });
    } else {
      value.isActive = record.isActive;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
