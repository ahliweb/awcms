import { isValidSlug } from "./slug-policy";

export type ValidationError = {
  field: string;
  message: string;
};

/**
 * Core fields shared by posts and pages (doc issue #537 §Core Data Rules).
 * Lifecycle fields (`status`, `visibility`), SEO fields, and page-only
 * fields (`pageType`, `parentPageId`, `menuOrder`) are validated separately
 * (`post-status.ts`, `seo-validation.ts`) so each concern stays independently
 * testable — Issue #538/#539's create/update handlers compose all of them.
 */
export type BlogContentCoreInput = {
  title: string;
  slug: string;
  excerpt: string | null;
  contentJson: Record<string, unknown>;
  contentText: string;
  locale: string;
};

export type BlogContentCoreValidationResult =
  | { valid: true; value: BlogContentCoreInput }
  | { valid: false; errors: ValidationError[] };

const MAX_TITLE_LENGTH = 200;
const MAX_EXCERPT_LENGTH = 500;

/** Same list `email-template-validation.ts` uses for admin-authored HTML template shells (doc 20 §XSS) — applied here to `contentJson`/`contentText` (Issue #538 acceptance criterion: "Unsafe HTML/script/embed content is rejected or sanitized"). Rejects rather than sanitizes, same choice email templates made. */
const UNSAFE_HTML_PATTERNS: readonly RegExp[] = [
  /<script\b/i,
  /<iframe\b/i,
  /<embed\b/i,
  /<object\b/i,
  /\bon\w+\s*=/i,
  /javascript:/i
];

/** Exported for reuse by other free-text fields in this module (Issue #542's widget `bodyText`) that need the same reject-don't-sanitize check, without duplicating the pattern list. */
export function containsUnsafeHtml(value: string): boolean {
  return UNSAFE_HTML_PATTERNS.some((pattern) => pattern.test(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Field-level validators, each independently usable so a partial-update
 * validator (Issue #538's `PATCH /api/v1/blog/posts/{id}`) can check only
 * the fields actually present in the request body, without needing to
 * fabricate placeholder values for the fields it composes from
 * `validateBlogContentCore`.
 */
export function validateTitleField(value: unknown): ValidationError | null {
  if (!isNonEmptyString(value)) {
    return { field: "title", message: "title is required." };
  }

  if (value.length > MAX_TITLE_LENGTH) {
    return {
      field: "title",
      message: `title must be at most ${MAX_TITLE_LENGTH} characters.`
    };
  }

  return null;
}

export function validateSlugField(value: unknown): ValidationError | null {
  if (!isNonEmptyString(value)) {
    return { field: "slug", message: "slug is required." };
  }

  if (!isValidSlug(value)) {
    return {
      field: "slug",
      message:
        "slug must be lowercase alphanumeric segments separated by single hyphens."
    };
  }

  return null;
}

export function validateExcerptField(value: unknown): ValidationError | null {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "string" || value.length > MAX_EXCERPT_LENGTH)
  ) {
    return {
      field: "excerpt",
      message: `excerpt must be a string of at most ${MAX_EXCERPT_LENGTH} characters.`
    };
  }

  return null;
}

export function validateContentJsonField(
  value: unknown
): ValidationError | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      field: "contentJson",
      message: "contentJson is required and must be an object."
    };
  }

  if (containsUnsafeHtml(JSON.stringify(value))) {
    return {
      field: "contentJson",
      message:
        "contentJson must not contain <script>, <iframe>, <embed>, <object>, inline event handler attributes, or javascript: URLs."
    };
  }

  return null;
}

export function validateContentTextField(
  value: unknown
): ValidationError | null {
  if (!isNonEmptyString(value)) {
    return { field: "contentText", message: "contentText is required." };
  }

  if (containsUnsafeHtml(value)) {
    return {
      field: "contentText",
      message:
        "contentText must not contain <script>, <iframe>, <embed>, <object>, inline event handler attributes, or javascript: URLs."
    };
  }

  return null;
}

export function validateLocaleField(value: unknown): ValidationError | null {
  if (value !== undefined && !isNonEmptyString(value)) {
    return {
      field: "locale",
      message: "locale must be a non-empty string when provided."
    };
  }

  return null;
}

export type DeleteReasonInput = {
  reason: string;
};

export type DeleteReasonValidationResult =
  | { valid: true; value: DeleteReasonInput }
  | { valid: false; errors: ValidationError[] };

/**
 * Shared soft-delete `{ reason: string }` body validator (Issue #538's
 * `DELETE /api/v1/blog/posts/{id}` established this shape; Issue #539
 * reuses it verbatim for pages and terms rather than re-deriving it).
 */
export function validateDeleteReasonInput(
  body: unknown
): DeleteReasonValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(record.reason)) {
    return {
      valid: false,
      errors: [{ field: "reason", message: "reason is required." }]
    };
  }

  return { valid: true, value: { reason: record.reason.trim() } };
}

export function validateBlogContentCore(
  body: unknown
): BlogContentCoreValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors = [
    validateTitleField(record.title),
    validateSlugField(record.slug),
    validateExcerptField(record.excerpt),
    validateContentJsonField(record.contentJson),
    validateContentTextField(record.contentText),
    validateLocaleField(record.locale)
  ].filter((error): error is ValidationError => error !== null);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      title: (record.title as string).trim(),
      slug: (record.slug as string).trim(),
      excerpt:
        record.excerpt === undefined || record.excerpt === null
          ? null
          : (record.excerpt as string).trim(),
      contentJson: record.contentJson as Record<string, unknown>,
      contentText: record.contentText as string,
      locale: isNonEmptyString(record.locale) ? record.locale.trim() : "id"
    }
  };
}
