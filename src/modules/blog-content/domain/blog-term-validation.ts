import { isValidSlug } from "./slug-policy";
import {
  isTaxonomyType,
  validateTermParent,
  type TaxonomyType
} from "./taxonomy-policy";
import {
  validateDeleteReasonInput,
  type DeleteReasonInput
} from "./content-validation";

export type ValidationError = {
  field: string;
  message: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateParentId(
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

export type CreateBlogTermInput = {
  taxonomyType: TaxonomyType;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
};

export type CreateBlogTermValidationResult =
  | { valid: true; value: CreateBlogTermInput }
  | { valid: false; errors: ValidationError[] };

/** `POST /api/v1/blog/terms` (Issue #539). Doc issue #539 §Data Rules — Categories and Tags: a tag must reject `parentId` (`validateTermParent`), slug format matches posts/pages. */
export function validateCreateBlogTermInput(
  body: unknown
): CreateBlogTermValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  if (!isTaxonomyType(record.taxonomyType)) {
    errors.push({
      field: "taxonomyType",
      message: "taxonomyType must be one of category, tag."
    });
  }

  if (!isNonEmptyString(record.name) || record.name.length > MAX_NAME_LENGTH) {
    errors.push({
      field: "name",
      message: `name is required and must be at most ${MAX_NAME_LENGTH} characters.`
    });
  }

  if (!isNonEmptyString(record.slug)) {
    errors.push({ field: "slug", message: "slug is required." });
  } else if (!isValidSlug(record.slug)) {
    errors.push({
      field: "slug",
      message:
        "slug must be lowercase alphanumeric segments separated by single hyphens."
    });
  }

  if (
    record.description !== undefined &&
    record.description !== null &&
    (typeof record.description !== "string" ||
      record.description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    errors.push({
      field: "description",
      message: `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters.`
    });
  }

  const parentIdResult = validateParentId(record.parentId);
  if (!parentIdResult.valid) {
    errors.push({
      field: "parentId",
      message: "parentId must be a UUID or null."
    });
  }

  if (isTaxonomyType(record.taxonomyType) && parentIdResult.valid) {
    const ownershipResult = validateTermParent(
      record.taxonomyType,
      null,
      parentIdResult.value
    );
    if (!ownershipResult.valid) {
      errors.push(...ownershipResult.errors);
    }
  }

  if (errors.length > 0 || !parentIdResult.valid) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      taxonomyType: record.taxonomyType as TaxonomyType,
      parentId: parentIdResult.value,
      name: (record.name as string).trim(),
      slug: (record.slug as string).trim(),
      description:
        record.description === undefined || record.description === null
          ? null
          : (record.description as string).trim()
    }
  };
}

export type UpdateBlogTermInput = {
  taxonomyType?: TaxonomyType;
  parentId?: string | null;
  name?: string;
  slug?: string;
  description?: string | null;
};

export type UpdateBlogTermValidationResult =
  | { valid: true; value: UpdateBlogTermInput }
  | { valid: false; errors: ValidationError[] };

/**
 * `PATCH /api/v1/blog/terms/{id}` (Issue #539). Only fields present in the
 * body are validated/copied. The tag/no-parent ownership rule is
 * re-checked here only when *both* `taxonomyType` and `parentId` are
 * being changed together — checking a lone `parentId` change against the
 * term's *existing* `taxonomyType` requires the current row, which the
 * validator (a pure function) does not have; the application layer
 * (`blog-taxonomy-directory.ts`'s `updateBlogTerm`) re-derives the
 * effective taxonomyType from the existing row before writing, and the
 * `awcms_blog_terms_tag_no_parent_check` DB constraint is the final
 * backstop either way.
 */
export function validateUpdateBlogTermInput(
  body: unknown
): UpdateBlogTermValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateBlogTermInput = {};

  if (record.taxonomyType !== undefined) {
    if (!isTaxonomyType(record.taxonomyType)) {
      errors.push({
        field: "taxonomyType",
        message: "taxonomyType must be one of category, tag."
      });
    } else {
      value.taxonomyType = record.taxonomyType;
    }
  }

  if (record.name !== undefined) {
    if (
      !isNonEmptyString(record.name) ||
      record.name.length > MAX_NAME_LENGTH
    ) {
      errors.push({
        field: "name",
        message: `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters.`
      });
    } else {
      value.name = record.name.trim();
    }
  }

  if (record.slug !== undefined) {
    if (!isNonEmptyString(record.slug)) {
      errors.push({ field: "slug", message: "slug is required." });
    } else if (!isValidSlug(record.slug)) {
      errors.push({
        field: "slug",
        message:
          "slug must be lowercase alphanumeric segments separated by single hyphens."
      });
    } else {
      value.slug = record.slug.trim();
    }
  }

  if (record.description !== undefined) {
    if (
      record.description !== null &&
      (typeof record.description !== "string" ||
        record.description.length > MAX_DESCRIPTION_LENGTH)
    ) {
      errors.push({
        field: "description",
        message: `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters or null.`
      });
    } else {
      value.description = record.description as string | null;
    }
  }

  if (record.parentId !== undefined) {
    const parentIdResult = validateParentId(record.parentId);
    if (!parentIdResult.valid) {
      errors.push({
        field: "parentId",
        message: "parentId must be a UUID or null."
      });
    } else {
      value.parentId = parentIdResult.value;
    }
  }

  if (value.taxonomyType !== undefined && value.parentId !== undefined) {
    const ownershipResult = validateTermParent(
      value.taxonomyType,
      null,
      value.parentId
    );
    if (!ownershipResult.valid) {
      errors.push(...ownershipResult.errors);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}

export type SoftDeleteBlogTermInput = DeleteReasonInput;

export type SoftDeleteBlogTermValidationResult =
  | { valid: true; value: SoftDeleteBlogTermInput }
  | { valid: false; errors: ValidationError[] };

/** `DELETE /api/v1/blog/terms/{id}` body: `{ reason: string }`. No restore/purge for terms (doc issue #537's permission seed has no `taxonomies.restore`/`.purge` — `taxonomies.configure` covers any future restore). */
export function validateSoftDeleteBlogTermInput(
  body: unknown
): SoftDeleteBlogTermValidationResult {
  return validateDeleteReasonInput(body);
}
