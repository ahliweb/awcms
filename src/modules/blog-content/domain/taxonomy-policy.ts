export type TaxonomyType = "category" | "tag";

export const TAXONOMY_TYPES: readonly TaxonomyType[] = ["category", "tag"];

export function isTaxonomyType(value: unknown): value is TaxonomyType {
  return (
    typeof value === "string" && (TAXONOMY_TYPES as string[]).includes(value)
  );
}

export type ValidationError = {
  field: string;
  message: string;
};

export type TermParentValidationResult =
  { valid: true } | { valid: false; errors: ValidationError[] };

/**
 * Enforces the two term-hierarchy rules from Issue #537/#539: a `tag` must
 * never have a `parentId` (schema `CHECK` in
 * `026_awcms_blog_content_schema.sql` backs this up at the DB level —
 * this is the pre-insert application-layer check that returns a field-level
 * error instead of a raw constraint violation), and a term can never be its
 * own parent. Cross-taxonomy-type parents (a tag id used as a category's
 * parent) and cycles beyond one level are Issue #539's admin-endpoint
 * concern, once terms are actually mutable through an API.
 */
export function validateTermParent(
  taxonomyType: TaxonomyType,
  termId: string | null,
  parentId: string | null | undefined
): TermParentValidationResult {
  const errors: ValidationError[] = [];

  if (taxonomyType === "tag" && parentId != null) {
    errors.push({
      field: "parentId",
      message: "A tag must not have a parentId."
    });
  }

  if (parentId != null && termId != null && parentId === termId) {
    errors.push({
      field: "parentId",
      message: "A term cannot be its own parent."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}
