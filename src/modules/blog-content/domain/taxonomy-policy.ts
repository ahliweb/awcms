/**
 * The tenant's content vocabularies.
 *
 * `category`/`tag` are the original pair (Issue #537/#539). `channel` and
 * `topic` were added for PRD LenteraKalteng §8.5/§12.4 (migration sql/131),
 * which requires channel, institution, region and topic to be FOUR SEPARATE
 * DIMENSIONS rather than one overloaded string — the collapse that makes the
 * legacy portal's archive unable to answer "every article about this body".
 *
 * Institution is deliberately NOT a member: it carries a branch, a region code
 * and its own landing-page SEO, so it is a table of its own
 * (`institution-validation.ts`). Region is not a member either — PRD §12.3
 * requires it to reference the `idn_admin_regions` master by code rather than
 * being retyped per tenant.
 */
export type TaxonomyType = "category" | "tag" | "channel" | "topic";

export const TAXONOMY_TYPES: readonly TaxonomyType[] = [
  "category",
  "tag",
  "channel",
  "topic"
];

/**
 * Vocabularies that may never nest, enforced by
 * `awcms_blog_terms_flat_taxonomy_no_parent_check` (sql/131).
 *
 * A `tag` has been flat since Issue #537. A `topic` joins it because PRD §12.4
 * defines topics as cross-channel issue labels (APBD, Infrastruktur, Korupsi):
 * nesting them raises "is Korupsi under Hukum or under Politik", a question
 * with no editorial answer, and every consumer would then have to decide
 * whether to roll children up. `channel` is left nestable — it is primary
 * navigation, and a second level (Olahraga -> Sepak Bola) is a real editorial
 * possibility.
 */
export const FLAT_TAXONOMY_TYPES: readonly TaxonomyType[] = ["tag", "topic"];

export function isTaxonomyType(value: unknown): value is TaxonomyType {
  return (
    typeof value === "string" && (TAXONOMY_TYPES as string[]).includes(value)
  );
}

export function isFlatTaxonomyType(value: TaxonomyType): boolean {
  return (FLAT_TAXONOMY_TYPES as string[]).includes(value);
}

/** Rendered into validator messages so a widened enum can never leave a message naming the old list. */
export const TAXONOMY_TYPE_LIST = TAXONOMY_TYPES.join(", ");

export type ValidationError = {
  field: string;
  message: string;
};

export type TermParentValidationResult =
  { valid: true } | { valid: false; errors: ValidationError[] };

/**
 * Enforces the two term-hierarchy rules from Issue #537/#539: a FLAT
 * vocabulary must never have a `parentId` (schema `CHECK` in
 * `026_awcms_blog_content_schema.sql`, widened by sql/131 and renamed
 * `awcms_blog_terms_flat_taxonomy_no_parent_check`, backs this up at the DB
 * level — this is the pre-insert application-layer check that returns a
 * field-level error instead of a raw constraint violation), and a term can
 * never be its own parent. Cross-taxonomy-type parents (a tag id used as a
 * category's parent) and cycles beyond one level are Issue #539's
 * admin-endpoint concern, once terms are actually mutable through an API.
 *
 * The flat set is read from `FLAT_TAXONOMY_TYPES` rather than compared against
 * the literal `"tag"`: when sql/131 added `topic` as the second flat
 * vocabulary, a hard-coded comparison here would have kept accepting a nested
 * topic through the API and only failed at the database, surfacing as a raw
 * constraint violation instead of a field error.
 */
export function validateTermParent(
  taxonomyType: TaxonomyType,
  termId: string | null,
  parentId: string | null | undefined
): TermParentValidationResult {
  const errors: ValidationError[] = [];

  if (isFlatTaxonomyType(taxonomyType) && parentId != null) {
    errors.push({
      field: "parentId",
      message: `A ${taxonomyType} must not have a parentId.`
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
