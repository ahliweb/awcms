/**
 * Slug format shared by posts, pages, and terms: lowercase ASCII
 * alphanumerics separated by single hyphens, no leading/trailing/duplicate
 * hyphens. Uniqueness itself (`tenant_id, locale, slug` for posts/pages;
 * `tenant_id, taxonomy_type, slug` for terms) is enforced by the migration's
 * partial unique index — this only validates the string shape.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_SLUG_LENGTH = 200;

// Combining diacritical marks (U+0300-U+036F) left behind by NFKD
// normalization, e.g. turning "café" into "cafe" before slugifying.
const COMBINING_DIACRITICS_PATTERN = /[̀-ͯ]/g;

export function isValidSlug(slug: string): boolean {
  return (
    slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug)
  );
}

/**
 * Derives a candidate slug from a title. Callers (Issue #538's create
 * endpoint) still must check `isValidSlug` and dedup against existing rows —
 * this is a convenience default, not a guarantee of uniqueness or validity
 * (e.g. a title with no ASCII alphanumerics yields an empty string).
 */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS_PATTERN, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
