import {
  validateBlogContentCore,
  validateContentJsonField,
  validateContentTextField,
  validateDeleteReasonInput,
  validateExcerptField,
  validateLocaleField,
  validateSlugField,
  validateTitleField,
  type DeleteReasonInput
} from "./content-validation";
import { validateSeoFields } from "./seo-validation";
import {
  isBlogContentVisibility,
  type BlogContentVisibility
} from "./post-status";

export type ValidationError = {
  field: string;
  message: string;
};

export type CreateBlogPostInput = {
  title: string;
  slug: string;
  excerpt: string | null;
  contentJson: Record<string, unknown>;
  contentText: string;
  locale: string;
  visibility: BlogContentVisibility;
  featuredMediaId: string | null;
  /** Issue #649 — explicit "use this image for social/SEO preview" override; same shape as `featuredMediaId` (UUID-or-null, no existence check here — that is `news-media-reference-gate.ts`'s job in full-online R2-only mode). Takes priority over `featuredMediaId` at render time (`social-preview-image-resolution.ts`). */
  seoImageMediaId: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  termIds: string[] | undefined;
  translationGroupId: string | null;
  /** Issue #641 — manual per-post opt-out of automatic internal tag linking. Defaults `false` (linking behaves exactly as before this issue unless an editor explicitly opts a post out). */
  autoInternalTagLinksDisabled: boolean;
};

export type CreateBlogPostValidationResult =
  | { valid: true; value: CreateBlogPostInput }
  | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateFeaturedMediaId(
  value: unknown
): { valid: true; value: string | null } | { valid: false } {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return { valid: false };
  }

  return { valid: true, value };
}

/**
 * `translationGroupId` (Issue #542 §Multilingual Content) — an optional
 * UUID linking this post to its translation siblings; same shape/rule as
 * `featuredMediaId` above (optional, UUID-or-null, no existence check here
 * — that's `application/localized-content-directory.ts`'s job).
 */
function validateTranslationGroupId(
  value: unknown
): { valid: true; value: string | null } | { valid: false } {
  return validateFeaturedMediaId(value);
}

/**
 * `termIds` (doc issue #539 §Scope: "Post-term relation handling") —
 * validated here purely for shape (array of UUIDs); existence within the
 * caller's tenant is checked at the application layer
 * (`countExistingTerms`) since that requires a database round-trip a pure
 * validator cannot do.
 */
function validateTermIds(
  value: unknown
): { valid: true; value: string[] | undefined } | { valid: false } {
  if (value === undefined) {
    return { valid: true, value: undefined };
  }

  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && UUID_PATTERN.test(item))
  ) {
    return { valid: false };
  }

  return { valid: true, value: [...new Set(value as string[])] };
}

/** `POST /api/v1/blog/posts` (Issue #538). Composes the shared core/SEO validators from Issue #537 plus post-only fields (`visibility`, `featuredMediaId`). */
export function validateCreateBlogPostInput(
  body: unknown
): CreateBlogPostValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  const coreResult = validateBlogContentCore(record);
  if (!coreResult.valid) {
    errors.push(...coreResult.errors);
  }

  const seoResult = validateSeoFields(record);
  if (!seoResult.valid) {
    errors.push(...seoResult.errors);
  }

  let visibility: BlogContentVisibility = "public";
  if (record.visibility !== undefined) {
    if (!isBlogContentVisibility(record.visibility)) {
      errors.push({
        field: "visibility",
        message: "visibility must be one of public, private, unlisted."
      });
    } else {
      visibility = record.visibility;
    }
  }

  const featuredMediaIdResult = validateFeaturedMediaId(record.featuredMediaId);
  if (!featuredMediaIdResult.valid) {
    errors.push({
      field: "featuredMediaId",
      message: "featuredMediaId must be a UUID when provided."
    });
  }

  const seoImageMediaIdResult = validateFeaturedMediaId(record.seoImageMediaId);
  if (!seoImageMediaIdResult.valid) {
    errors.push({
      field: "seoImageMediaId",
      message: "seoImageMediaId must be a UUID when provided."
    });
  }

  const termIdsResult = validateTermIds(record.termIds);
  if (!termIdsResult.valid) {
    errors.push({
      field: "termIds",
      message: "termIds must be an array of UUIDs when provided."
    });
  }

  const translationGroupIdResult = validateTranslationGroupId(
    record.translationGroupId
  );
  if (!translationGroupIdResult.valid) {
    errors.push({
      field: "translationGroupId",
      message: "translationGroupId must be a UUID when provided."
    });
  }

  let autoInternalTagLinksDisabled = false;
  if (record.autoInternalTagLinksDisabled !== undefined) {
    if (typeof record.autoInternalTagLinksDisabled !== "boolean") {
      errors.push({
        field: "autoInternalTagLinksDisabled",
        message: "autoInternalTagLinksDisabled must be a boolean."
      });
    } else {
      autoInternalTagLinksDisabled = record.autoInternalTagLinksDisabled;
    }
  }

  if (
    errors.length > 0 ||
    !coreResult.valid ||
    !seoResult.valid ||
    !featuredMediaIdResult.valid ||
    !seoImageMediaIdResult.valid ||
    !termIdsResult.valid ||
    !translationGroupIdResult.valid
  ) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      ...coreResult.value,
      visibility,
      featuredMediaId: featuredMediaIdResult.value,
      seoImageMediaId: seoImageMediaIdResult.value,
      seoTitle: seoResult.value.seoTitle ?? null,
      metaDescription: seoResult.value.metaDescription ?? null,
      canonicalUrl: seoResult.value.canonicalUrl ?? null,
      termIds: termIdsResult.value,
      translationGroupId: translationGroupIdResult.value,
      autoInternalTagLinksDisabled
    }
  };
}

export type UpdateBlogPostInput = {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  contentJson?: Record<string, unknown>;
  contentText?: string;
  locale?: string;
  visibility?: BlogContentVisibility;
  featuredMediaId?: string | null;
  seoImageMediaId?: string | null;
  seoTitle?: string | null;
  metaDescription?: string | null;
  canonicalUrl?: string | null;
  termIds?: string[];
  translationGroupId?: string | null;
  /** Issue #641 — manual per-post opt-out of automatic internal tag linking. */
  autoInternalTagLinksDisabled?: boolean;
};

export type UpdateBlogPostValidationResult =
  | { valid: true; value: UpdateBlogPostInput }
  | { valid: false; errors: ValidationError[] };

/** `PATCH /api/v1/blog/posts/{id}` (Issue #538). Only the fields actually present in the body are validated/copied — each reuses the same field-level validator `validateBlogContentCore` composes for create, so update and create can never silently drift apart on what counts as a valid slug/contentJson/etc. */
export function validateUpdateBlogPostInput(
  body: unknown
): UpdateBlogPostValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateBlogPostInput = {};

  if (record.title !== undefined) {
    const error = validateTitleField(record.title);
    if (error) {
      errors.push(error);
    } else {
      value.title = (record.title as string).trim();
    }
  }

  if (record.slug !== undefined) {
    const error = validateSlugField(record.slug);
    if (error) {
      errors.push(error);
    } else {
      value.slug = (record.slug as string).trim();
    }
  }

  if (record.excerpt !== undefined) {
    const error = validateExcerptField(record.excerpt);
    if (error) {
      errors.push(error);
    } else {
      value.excerpt =
        record.excerpt === null ? null : (record.excerpt as string).trim();
    }
  }

  if (record.contentJson !== undefined) {
    const error = validateContentJsonField(record.contentJson);
    if (error) {
      errors.push(error);
    } else {
      value.contentJson = record.contentJson as Record<string, unknown>;
    }
  }

  if (record.contentText !== undefined) {
    const error = validateContentTextField(record.contentText);
    if (error) {
      errors.push(error);
    } else {
      value.contentText = record.contentText as string;
    }
  }

  if (record.locale !== undefined) {
    const error = validateLocaleField(record.locale);
    if (error) {
      errors.push(error);
    } else {
      value.locale = (record.locale as string).trim();
    }
  }

  if (record.visibility !== undefined) {
    if (!isBlogContentVisibility(record.visibility)) {
      errors.push({
        field: "visibility",
        message: "visibility must be one of public, private, unlisted."
      });
    } else {
      value.visibility = record.visibility;
    }
  }

  if (record.featuredMediaId !== undefined) {
    const featuredMediaIdResult = validateFeaturedMediaId(
      record.featuredMediaId
    );
    if (!featuredMediaIdResult.valid) {
      errors.push({
        field: "featuredMediaId",
        message: "featuredMediaId must be a UUID or null."
      });
    } else {
      value.featuredMediaId = featuredMediaIdResult.value;
    }
  }

  if (record.seoImageMediaId !== undefined) {
    const seoImageMediaIdResult = validateFeaturedMediaId(
      record.seoImageMediaId
    );
    if (!seoImageMediaIdResult.valid) {
      errors.push({
        field: "seoImageMediaId",
        message: "seoImageMediaId must be a UUID or null."
      });
    } else {
      value.seoImageMediaId = seoImageMediaIdResult.value;
    }
  }

  if (
    record.seoTitle !== undefined ||
    record.metaDescription !== undefined ||
    record.canonicalUrl !== undefined
  ) {
    const seoResult = validateSeoFields(record);
    if (!seoResult.valid) {
      errors.push(...seoResult.errors);
    } else {
      if (record.seoTitle !== undefined) {
        value.seoTitle = seoResult.value.seoTitle ?? null;
      }
      if (record.metaDescription !== undefined) {
        value.metaDescription = seoResult.value.metaDescription ?? null;
      }
      if (record.canonicalUrl !== undefined) {
        value.canonicalUrl = seoResult.value.canonicalUrl ?? null;
      }
    }
  }

  if (record.termIds !== undefined) {
    const termIdsResult = validateTermIds(record.termIds);
    if (!termIdsResult.valid) {
      errors.push({
        field: "termIds",
        message: "termIds must be an array of UUIDs when provided."
      });
    } else {
      value.termIds = termIdsResult.value;
    }
  }

  if (record.translationGroupId !== undefined) {
    const translationGroupIdResult = validateTranslationGroupId(
      record.translationGroupId
    );
    if (!translationGroupIdResult.valid) {
      errors.push({
        field: "translationGroupId",
        message: "translationGroupId must be a UUID or null."
      });
    } else {
      value.translationGroupId = translationGroupIdResult.value;
    }
  }

  if (record.autoInternalTagLinksDisabled !== undefined) {
    if (typeof record.autoInternalTagLinksDisabled !== "boolean") {
      errors.push({
        field: "autoInternalTagLinksDisabled",
        message: "autoInternalTagLinksDisabled must be a boolean."
      });
    } else {
      value.autoInternalTagLinksDisabled = record.autoInternalTagLinksDisabled;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}

export type ScheduleBlogPostInput = {
  scheduledAt: Date;
};

export type ScheduleBlogPostValidationResult =
  | { valid: true; value: ScheduleBlogPostInput }
  | { valid: false; errors: ValidationError[] };

/** `POST /api/v1/blog/posts/{id}/schedule` body: `{ scheduledAt: <ISO 8601 datetime> }`, must be in the future. */
export function validateScheduleBlogPostInput(
  body: unknown
): ScheduleBlogPostValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;

  if (typeof record.scheduledAt !== "string") {
    return {
      valid: false,
      errors: [{ field: "scheduledAt", message: "scheduledAt is required." }]
    };
  }

  const scheduledAt = new Date(record.scheduledAt);

  if (Number.isNaN(scheduledAt.getTime())) {
    return {
      valid: false,
      errors: [
        {
          field: "scheduledAt",
          message: "scheduledAt must be a valid ISO 8601 datetime."
        }
      ]
    };
  }

  if (scheduledAt.getTime() <= Date.now()) {
    return {
      valid: false,
      errors: [
        { field: "scheduledAt", message: "scheduledAt must be in the future." }
      ]
    };
  }

  return { valid: true, value: { scheduledAt } };
}

export type SoftDeleteBlogPostInput = DeleteReasonInput;

export type SoftDeleteBlogPostValidationResult =
  | { valid: true; value: SoftDeleteBlogPostInput }
  | { valid: false; errors: ValidationError[] };

/** `DELETE /api/v1/blog/posts/{id}` body: `{ reason: string }` — same required-reason convention as `DELETE /api/v1/profiles/{id}` and `DELETE /api/v1/email/templates/{id}`. Thin wrapper over the shared `validateDeleteReasonInput` (Issue #539 reuses it directly for pages/terms instead of duplicating this). */
export function validateSoftDeleteBlogPostInput(
  body: unknown
): SoftDeleteBlogPostValidationResult {
  return validateDeleteReasonInput(body);
}
