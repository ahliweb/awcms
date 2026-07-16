/**
 * Pure validation for the email template endpoints (Issue #498). Same
 * shape/style as `form-drafts/domain/form-draft-validation.ts` — no I/O
 * here.
 */
import { isKnownEmailTemplateCategory } from "./email-template-categories";

export type ValidationError = {
  field: string;
  message: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export type LocalizedTemplateTextInput = Record<string, string>;

export type CreateEmailTemplateInput = {
  templateKey: string;
  name: string;
  subjectTemplate: LocalizedTemplateTextInput;
  textBodyTemplate?: LocalizedTemplateTextInput;
  htmlBodyTemplate?: LocalizedTemplateTextInput;
  isActive?: boolean;
};

export type UpdateEmailTemplateInput = {
  name?: string;
  subjectTemplate?: LocalizedTemplateTextInput;
  textBodyTemplate?: LocalizedTemplateTextInput | null;
  htmlBodyTemplate?: LocalizedTemplateTextInput | null;
  isActive?: boolean;
};

// Mirrors migration 020's SQL CHECK constraint — keep both in sync.
const TEMPLATE_KEY_FORMAT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const LOCALE_CODE_FORMAT = /^[a-z]{2}$/;
const MAX_NAME_LENGTH = 128;
const MAX_SUBJECT_LENGTH = 500;
const MAX_BODY_LENGTH = 20_000;
const DEFAULT_LOCALE = "en";

/** Blocks the most common script/event-handler injection vectors in admin-authored HTML template shells (doc 20 §XSS). Interpolated variables are separately HTML-escaped at render time (`email-template-render.ts`) — this check is about the template body itself, not the variables substituted into it. */
const UNSAFE_HTML_PATTERNS: readonly RegExp[] = [
  /<script\b/i,
  /<iframe\b/i,
  /\bon\w+\s*=/i,
  /javascript:/i
];

/**
 * `value === null` is checked *before* narrowing by `typeof` — CodeQL's
 * `js/comparison-between-incompatible-types` query flags the more common
 * `typeof value === "object" && value !== null` ordering as a false
 * positive here (it infers `value`'s narrowed type as
 * "Date, object or regular expression" after the `typeof` check, then
 * treats the subsequent `!== null` as an "incompatible" comparison — `null`
 * is directly comparable to any reference value in JS, this is the
 * standard non-null-object check, not a bug). Same runtime behavior,
 * reordered to avoid the false positive.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || Array.isArray(value)) {
    return false;
  }

  return typeof value === "object";
}

function validateLocalizedText(
  field: string,
  value: unknown,
  errors: ValidationError[],
  options: { required: boolean; maxLength: number; checkUnsafeHtml: boolean }
): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    if (options.required) {
      errors.push({ field, message: `${field} is required.` });
    }
    return undefined;
  }

  if (!isPlainObject(value)) {
    errors.push({
      field,
      message: `${field} must be an object of locale code to string, e.g. { "en": "...", "id": "..." }.`
    });
    return undefined;
  }

  const entries = Object.entries(value);

  if (entries.length === 0) {
    errors.push({ field, message: `${field} must not be empty.` });
    return undefined;
  }

  if (!(DEFAULT_LOCALE in value)) {
    errors.push({
      field,
      message: `${field} must include an "${DEFAULT_LOCALE}" (English) entry.`
    });
    return undefined;
  }

  const result: Record<string, string> = {};

  for (const [locale, text] of entries) {
    if (!LOCALE_CODE_FORMAT.test(locale)) {
      errors.push({
        field,
        message: `${field} locale key "${locale}" must be a 2-letter lowercase code (e.g. "en", "id").`
      });
      continue;
    }

    if (typeof text !== "string" || text.trim().length === 0) {
      errors.push({
        field,
        message: `${field}.${locale} must be a non-empty string.`
      });
      continue;
    }

    if (text.length > options.maxLength) {
      errors.push({
        field,
        message: `${field}.${locale} must not exceed ${options.maxLength} characters.`
      });
      continue;
    }

    if (
      options.checkUnsafeHtml &&
      UNSAFE_HTML_PATTERNS.some((pattern) => pattern.test(text))
    ) {
      errors.push({
        field,
        message: `${field}.${locale} must not contain <script>, <iframe>, inline event handler attributes, or javascript: URLs.`
      });
      continue;
    }

    result[locale] = text;
  }

  return errors.length === 0 ? result : undefined;
}

export function validateCreateEmailTemplateInput(
  body: unknown
): Result<CreateEmailTemplateInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  let templateKey: string | undefined;
  if (
    typeof record.templateKey !== "string" ||
    !TEMPLATE_KEY_FORMAT.test(record.templateKey)
  ) {
    errors.push({
      field: "templateKey",
      message:
        'templateKey must be dot-separated lowercase snake_case segments, e.g. "auth.password_reset".'
    });
  } else if (!isKnownEmailTemplateCategory(record.templateKey)) {
    errors.push({
      field: "templateKey",
      message: `templateKey "${record.templateKey}" is not a recognized category. Base categories are fixed; a "derived.*" category must be registered first (registerDerivedEmailTemplateCategory).`
    });
  } else {
    templateKey = record.templateKey;
  }

  let name: string | undefined;
  if (
    typeof record.name !== "string" ||
    record.name.trim().length === 0 ||
    record.name.length > MAX_NAME_LENGTH
  ) {
    errors.push({
      field: "name",
      message: `name is required and must be up to ${MAX_NAME_LENGTH} characters.`
    });
  } else {
    name = record.name.trim();
  }

  const subjectTemplate = validateLocalizedText(
    "subjectTemplate",
    record.subjectTemplate,
    errors,
    { required: true, maxLength: MAX_SUBJECT_LENGTH, checkUnsafeHtml: false }
  );
  const textBodyTemplate = validateLocalizedText(
    "textBodyTemplate",
    record.textBodyTemplate,
    errors,
    { required: false, maxLength: MAX_BODY_LENGTH, checkUnsafeHtml: false }
  );
  const htmlBodyTemplate = validateLocalizedText(
    "htmlBodyTemplate",
    record.htmlBodyTemplate,
    errors,
    { required: false, maxLength: MAX_BODY_LENGTH, checkUnsafeHtml: true }
  );

  if (
    record.textBodyTemplate === undefined &&
    record.htmlBodyTemplate === undefined
  ) {
    errors.push({
      field: "body",
      message:
        "At least one of textBodyTemplate or htmlBodyTemplate is required."
    });
  }

  let isActive: boolean | undefined;
  if (record.isActive !== undefined) {
    if (typeof record.isActive !== "boolean") {
      errors.push({
        field: "isActive",
        message: "isActive must be a boolean."
      });
    } else {
      isActive = record.isActive;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      templateKey: templateKey!,
      name: name!,
      subjectTemplate: subjectTemplate!,
      textBodyTemplate,
      htmlBodyTemplate,
      isActive
    }
  };
}

export function validateUpdateEmailTemplateInput(
  body: unknown
): Result<UpdateEmailTemplateInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateEmailTemplateInput = {};

  if (record.name !== undefined) {
    if (
      typeof record.name !== "string" ||
      record.name.trim().length === 0 ||
      record.name.length > MAX_NAME_LENGTH
    ) {
      errors.push({
        field: "name",
        message: `name must be a non-empty string up to ${MAX_NAME_LENGTH} characters.`
      });
    } else {
      value.name = record.name.trim();
    }
  }

  if (record.subjectTemplate !== undefined) {
    const subjectTemplate = validateLocalizedText(
      "subjectTemplate",
      record.subjectTemplate,
      errors,
      { required: true, maxLength: MAX_SUBJECT_LENGTH, checkUnsafeHtml: false }
    );
    if (subjectTemplate !== undefined) {
      value.subjectTemplate = subjectTemplate;
    }
  }

  if (record.textBodyTemplate !== undefined) {
    if (record.textBodyTemplate === null) {
      value.textBodyTemplate = null;
    } else {
      const textBodyTemplate = validateLocalizedText(
        "textBodyTemplate",
        record.textBodyTemplate,
        errors,
        { required: true, maxLength: MAX_BODY_LENGTH, checkUnsafeHtml: false }
      );
      if (textBodyTemplate !== undefined) {
        value.textBodyTemplate = textBodyTemplate;
      }
    }
  }

  if (record.htmlBodyTemplate !== undefined) {
    if (record.htmlBodyTemplate === null) {
      value.htmlBodyTemplate = null;
    } else {
      const htmlBodyTemplate = validateLocalizedText(
        "htmlBodyTemplate",
        record.htmlBodyTemplate,
        errors,
        { required: true, maxLength: MAX_BODY_LENGTH, checkUnsafeHtml: true }
      );
      if (htmlBodyTemplate !== undefined) {
        value.htmlBodyTemplate = htmlBodyTemplate;
      }
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

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message:
        "Provide at least one of name, subjectTemplate, textBodyTemplate, htmlBodyTemplate, isActive."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
