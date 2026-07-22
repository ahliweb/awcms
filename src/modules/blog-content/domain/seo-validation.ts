export type ValidationError = {
  field: string;
  message: string;
};

export type SeoFieldsInput = {
  seoTitle?: string | null;
  metaDescription?: string | null;
  canonicalUrl?: string | null;
};

export type SeoValidationResult =
  | { valid: true; value: SeoFieldsInput }
  | { valid: false; errors: ValidationError[] };

const MAX_SEO_TITLE_LENGTH = 70;
const MAX_META_DESCRIPTION_LENGTH = 160;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Exported for render-time re-validation (Issue #540: "Do not render unsafe URLs" — defense in depth on top of the write-time check below). */
export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates the optional SEO metadata shared by posts and pages
 * (`seo_title`, `meta_description`, `canonical_url`). All three fields are
 * optional/nullable — this only rejects a *present* value that violates the
 * shape/length rule, matching how `blog_content.seo.configure` gates just
 * these fields independent of the rest of the content payload.
 */
export function validateSeoFields(input: unknown): SeoValidationResult {
  const errors: ValidationError[] = [];
  const record = (input ?? {}) as Record<string, unknown>;
  const value: SeoFieldsInput = {};

  if (record.seoTitle !== undefined && record.seoTitle !== null) {
    if (!isNonEmptyString(record.seoTitle)) {
      errors.push({
        field: "seoTitle",
        message: "seoTitle must be a non-empty string."
      });
    } else if (record.seoTitle.length > MAX_SEO_TITLE_LENGTH) {
      errors.push({
        field: "seoTitle",
        message: `seoTitle must be at most ${MAX_SEO_TITLE_LENGTH} characters.`
      });
    } else {
      value.seoTitle = record.seoTitle.trim();
    }
  } else if (record.seoTitle === null) {
    value.seoTitle = null;
  }

  if (record.metaDescription !== undefined && record.metaDescription !== null) {
    if (!isNonEmptyString(record.metaDescription)) {
      errors.push({
        field: "metaDescription",
        message: "metaDescription must be a non-empty string."
      });
    } else if (record.metaDescription.length > MAX_META_DESCRIPTION_LENGTH) {
      errors.push({
        field: "metaDescription",
        message: `metaDescription must be at most ${MAX_META_DESCRIPTION_LENGTH} characters.`
      });
    } else {
      value.metaDescription = record.metaDescription.trim();
    }
  } else if (record.metaDescription === null) {
    value.metaDescription = null;
  }

  if (record.canonicalUrl !== undefined && record.canonicalUrl !== null) {
    if (
      !isNonEmptyString(record.canonicalUrl) ||
      !isAbsoluteHttpUrl(record.canonicalUrl)
    ) {
      errors.push({
        field: "canonicalUrl",
        message: "canonicalUrl must be an absolute http(s) URL."
      });
    } else {
      value.canonicalUrl = record.canonicalUrl.trim();
    }
  } else if (record.canonicalUrl === null) {
    value.canonicalUrl = null;
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
