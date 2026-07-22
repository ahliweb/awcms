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
import { isPageType, type PageType } from "./page-type";

export type ValidationError = {
  field: string;
  message: string;
};

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

function validateParentPageId(
  value: unknown,
  pageId: string | null
): { valid: true; value: string | null } | { valid: false; message: string } {
  if (value === undefined || value === null) {
    return { valid: true, value: null };
  }

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return { valid: false, message: "parentPageId must be a UUID or null." };
  }

  if (pageId !== null && value === pageId) {
    return { valid: false, message: "A page cannot be its own parent." };
  }

  return { valid: true, value };
}

function validateMenuOrder(
  value: unknown
): { valid: true; value: number } | { valid: false } {
  if (value === undefined) {
    return { valid: true, value: 0 };
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { valid: false };
  }

  return { valid: true, value };
}

export type CreateBlogPageInput = {
  title: string;
  slug: string;
  excerpt: string | null;
  contentJson: Record<string, unknown>;
  contentText: string;
  locale: string;
  visibility: BlogContentVisibility;
  featuredMediaId: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  pageType: PageType;
  parentPageId: string | null;
  menuOrder: number;
};

export type CreateBlogPageValidationResult =
  | { valid: true; value: CreateBlogPageInput }
  | { valid: false; errors: ValidationError[] };

/** `POST /api/v1/blog/pages` (Issue #539). Same core/SEO composition as `validateCreateBlogPostInput`, plus page-only fields (`pageType`, `parentPageId`, `menuOrder`, doc issue #539 §Data Rules — Pages). */
export function validateCreateBlogPageInput(
  body: unknown
): CreateBlogPageValidationResult {
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

  let pageType: PageType = "standard";
  if (record.pageType !== undefined) {
    if (!isPageType(record.pageType)) {
      errors.push({
        field: "pageType",
        message: "pageType must be one of standard, landing, legal, system."
      });
    } else {
      pageType = record.pageType;
    }
  }

  const parentPageIdResult = validateParentPageId(record.parentPageId, null);
  if (!parentPageIdResult.valid) {
    errors.push({ field: "parentPageId", message: parentPageIdResult.message });
  }

  const menuOrderResult = validateMenuOrder(record.menuOrder);
  if (!menuOrderResult.valid) {
    errors.push({
      field: "menuOrder",
      message: "menuOrder must be a non-negative integer."
    });
  }

  if (
    errors.length > 0 ||
    !coreResult.valid ||
    !seoResult.valid ||
    !featuredMediaIdResult.valid ||
    !parentPageIdResult.valid ||
    !menuOrderResult.valid
  ) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      ...coreResult.value,
      visibility,
      featuredMediaId: featuredMediaIdResult.value,
      seoTitle: seoResult.value.seoTitle ?? null,
      metaDescription: seoResult.value.metaDescription ?? null,
      canonicalUrl: seoResult.value.canonicalUrl ?? null,
      pageType,
      parentPageId: parentPageIdResult.value,
      menuOrder: menuOrderResult.value
    }
  };
}

export type UpdateBlogPageInput = {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  contentJson?: Record<string, unknown>;
  contentText?: string;
  locale?: string;
  visibility?: BlogContentVisibility;
  featuredMediaId?: string | null;
  seoTitle?: string | null;
  metaDescription?: string | null;
  canonicalUrl?: string | null;
  pageType?: PageType;
  parentPageId?: string | null;
  menuOrder?: number;
};

export type UpdateBlogPageValidationResult =
  | { valid: true; value: UpdateBlogPageInput }
  | { valid: false; errors: ValidationError[] };

/** `PATCH /api/v1/blog/pages/{id}` (Issue #539). Only fields present in the body are validated/copied — same partial-update shape as `validateUpdateBlogPostInput`. */
export function validateUpdateBlogPageInput(
  body: unknown,
  pageId: string
): UpdateBlogPageValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateBlogPageInput = {};

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

  if (record.pageType !== undefined) {
    if (!isPageType(record.pageType)) {
      errors.push({
        field: "pageType",
        message: "pageType must be one of standard, landing, legal, system."
      });
    } else {
      value.pageType = record.pageType;
    }
  }

  if (record.parentPageId !== undefined) {
    const parentPageIdResult = validateParentPageId(
      record.parentPageId,
      pageId
    );
    if (!parentPageIdResult.valid) {
      errors.push({
        field: "parentPageId",
        message: parentPageIdResult.message
      });
    } else {
      value.parentPageId = parentPageIdResult.value;
    }
  }

  if (record.menuOrder !== undefined) {
    const menuOrderResult = validateMenuOrder(record.menuOrder);
    if (!menuOrderResult.valid) {
      errors.push({
        field: "menuOrder",
        message: "menuOrder must be a non-negative integer."
      });
    } else {
      value.menuOrder = menuOrderResult.value;
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

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}

export type SoftDeleteBlogPageInput = DeleteReasonInput;

export type SoftDeleteBlogPageValidationResult =
  | { valid: true; value: SoftDeleteBlogPageInput }
  | { valid: false; errors: ValidationError[] };

/** `DELETE /api/v1/blog/pages/{id}` body: `{ reason: string }`. */
export function validateSoftDeleteBlogPageInput(
  body: unknown
): SoftDeleteBlogPageValidationResult {
  return validateDeleteReasonInput(body);
}
