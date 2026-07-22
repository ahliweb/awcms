import { containsUnsafeHtml } from "./content-validation";

/**
 * Widgets (Issue #542 §Widgets: "Support positions... Widget content must
 * be safely rendered. Widget visibility must respect tenant isolation.").
 * `bodyText` reuses `content-validation.ts`'s `containsUnsafeHtml` reject
 * list (`<script>`/`<iframe>`/`<embed>`/`<object>`/inline handlers/
 * `javascript:`) so this doesn't re-derive the same XSS rule a second time;
 * rendering itself is plain-text-escaped, same convention
 * `content-block-rendering.ts` established. Tenant isolation is RLS
 * (`awcms_blog_widgets_tenant_isolation`), not an application-layer
 * concern this file needs to re-enforce.
 */
export type WidgetPosition =
  "header" | "sidebar" | "footer" | "content_before" | "content_after";

export const WIDGET_POSITIONS: readonly WidgetPosition[] = [
  "header",
  "sidebar",
  "footer",
  "content_before",
  "content_after"
];

export function isWidgetPosition(value: unknown): value is WidgetPosition {
  return (
    typeof value === "string" && (WIDGET_POSITIONS as string[]).includes(value)
  );
}

export type ValidationError = {
  field: string;
  message: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export type CreateWidgetInput = {
  position: WidgetPosition;
  title: string;
  bodyText: string;
  isActive: boolean;
  sortOrder: number;
};

export type CreateWidgetValidationResult =
  | { valid: true; value: CreateWidgetInput }
  | { valid: false; errors: ValidationError[] };

export function validateCreateWidgetInput(
  body: unknown
): CreateWidgetValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (!isWidgetPosition(record.position)) {
    errors.push({
      field: "position",
      message: `position must be one of ${WIDGET_POSITIONS.join(", ")}.`
    });
  }

  if (!isNonEmptyString(record.title)) {
    errors.push({ field: "title", message: "title is required." });
  }

  const bodyText = typeof record.bodyText === "string" ? record.bodyText : "";

  if (bodyText.length > 0 && containsUnsafeHtml(bodyText)) {
    errors.push({
      field: "bodyText",
      message:
        "bodyText must not contain <script>, <iframe>, <embed>, <object>, inline event handler attributes, or javascript: URLs."
    });
  }

  if (record.sortOrder !== undefined && typeof record.sortOrder !== "number") {
    errors.push({
      field: "sortOrder",
      message: "sortOrder must be a number when provided."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      position: record.position as WidgetPosition,
      title: (record.title as string).trim(),
      bodyText,
      isActive: record.isActive !== false,
      sortOrder: typeof record.sortOrder === "number" ? record.sortOrder : 0
    }
  };
}

export type UpdateWidgetInput = {
  position?: WidgetPosition;
  title?: string;
  bodyText?: string;
  isActive?: boolean;
  sortOrder?: number;
};

export type UpdateWidgetValidationResult =
  | { valid: true; value: UpdateWidgetInput }
  | { valid: false; errors: ValidationError[] };

export function validateUpdateWidgetInput(
  body: unknown
): UpdateWidgetValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const value: UpdateWidgetInput = {};

  if (record.position !== undefined) {
    if (!isWidgetPosition(record.position)) {
      errors.push({
        field: "position",
        message: `position must be one of ${WIDGET_POSITIONS.join(", ")}.`
      });
    } else {
      value.position = record.position;
    }
  }

  if (record.title !== undefined) {
    if (!isNonEmptyString(record.title)) {
      errors.push({
        field: "title",
        message: "title must be a non-empty string."
      });
    } else {
      value.title = record.title.trim();
    }
  }

  if (record.bodyText !== undefined) {
    if (typeof record.bodyText !== "string") {
      errors.push({ field: "bodyText", message: "bodyText must be a string." });
    } else if (containsUnsafeHtml(record.bodyText)) {
      errors.push({
        field: "bodyText",
        message:
          "bodyText must not contain <script>, <iframe>, <embed>, <object>, inline event handler attributes, or javascript: URLs."
      });
    } else {
      value.bodyText = record.bodyText;
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

  if (record.sortOrder !== undefined) {
    if (typeof record.sortOrder !== "number") {
      errors.push({
        field: "sortOrder",
        message: "sortOrder must be a number."
      });
    } else {
      value.sortOrder = record.sortOrder;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
