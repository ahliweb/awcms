/**
 * Bulk import of legacy articles (Issue #599).
 *
 * ## Why this is not `createBlogPost` plus `transitionBlogPostStatus`
 *
 * Three reasons, and the first is the one the whole issue is about.
 *
 * 1. **`published_at`.** `transitionBlogPostStatus` sets it to `now()`, which is
 *    correct for an editor pressing Publish and destroys the thing being
 *    migrated here. 23,906 articles have been indexed for years under their own
 *    dates; re-dating them all to the cutover afternoon is the SEO equity loss
 *    this issue exists to prevent, arriving through the back door.
 * 2. **Idempotency.** The expected workflow is preview -> commit -> fix the
 *    rejected rows -> commit again. A create-then-publish pair has no conflict
 *    target, so the second run would either duplicate every article or need a
 *    read-then-write that two concurrent runs could interleave with. One
 *    statement with `ON CONFLICT DO NOTHING` on the `sql/138` partial unique
 *    index cannot.
 * 3. **Cost.** Two statements per article across 23,906 articles is 47,812 round
 *    trips for work that is one INSERT.
 *
 * ## What it deliberately does NOT do
 *
 * It writes no revision and no audit event. A revision records a change an
 * editor made to something that existed here; an import is the arrival of
 * something that existed somewhere else, and 23,906 revisions of "created by
 * import" is noise that makes the real history harder to read. The provenance
 * columns are the record — they say where each row came from, which is what a
 * later question about an imported article actually asks.
 *
 * It also never publishes anything the caller did not say to publish. A legacy
 * archive contains drafts and withdrawn articles, and importing them as
 * published would put them back on the internet.
 */
import type { PortableTextDocument } from "../domain/portable-text";
import { portableTextToPlainText } from "../domain/portable-text-conversion";
import type {
  BlogContentStatus,
  BlogContentVisibility
} from "../domain/post-status";

/**
 * The lossy projection every write path stores alongside the canonical body
 * (ADR-0100). Bound as a VALUE, not `JSON.stringify` of one: Bun JSON-encodes a
 * string parameter bound to a jsonb slot, which stores the scalar string
 * `"{\"blocks\":[]}"` instead of the object (Issue #641).
 */
const EMPTY_CONTENT_JSON = { blocks: [] as unknown[] };

export type LegacyPostImportInput = {
  /** The id the legacy system used — what makes the redirect map derivable. */
  legacyId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  bodyPortableText: PortableTextDocument;
  locale: string;
  status: BlogContentStatus;
  visibility: BlogContentVisibility;
  /** The ORIGINAL publication instant. Null only for a row that was never published. */
  publishedAt: Date | null;
  seoTitle: string | null;
  metaDescription: string | null;
  /**
   * The lead photograph, already resolved to a managed media object and already
   * checked against THIS tenant's registry by the caller
   * (`isMediaReferenceSafe`, once per distinct id, before any conversion).
   *
   * This type had no media field at all and the INSERT below named 16 columns
   * without `featured_media_id`, so every imported article arrived without the
   * photograph the legacy page led with — 25,029 of 25,029 for SeputarBorneo,
   * silently, because `--images` scanned body HTML only and never mentioned
   * them (ADR-0114). The column has existed since `sql/035:46` and
   * `public-content-port-adapter.ts` has been serving it to `awcms-astro` the
   * whole time; the writer was the missing half.
   *
   * No FK by design (`sql/035`), so this value is only as good as the caller's
   * check. Do not add a second, weaker one here — one chokepoint or none.
   */
  featuredMediaId: string | null;
};

export type LegacyPostImportOutcome = {
  legacyId: string;
  /** `null` when the row already existed — the import is a no-op for it. */
  postId: string | null;
};

/**
 * Inserts one legacy article, or does nothing if this `(system, legacyId)` is
 * already present for this tenant.
 *
 * `content_json` is written as the same lossy projection every other write path
 * produces (ADR-0100: the canonical body is `body_portable_text`), and
 * `content_text` is derived rather than supplied, so an imported row is
 * indistinguishable in shape from an authored one.
 */
export async function importLegacyBlogPost(
  tx: Bun.SQL,
  tenantId: string,
  authorTenantUserId: string,
  system: string,
  input: LegacyPostImportInput
): Promise<LegacyPostImportOutcome> {
  const rows = (await tx`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
       content_text, body_portable_text, status, visibility, locale,
       featured_media_id, seo_title, meta_description, published_at,
       legacy_source_system, legacy_source_id)
    VALUES (
      ${tenantId}, ${authorTenantUserId}, ${input.title}, ${input.slug},
      ${input.excerpt},
      ${EMPTY_CONTENT_JSON}::jsonb,
      ${portableTextToPlainText(input.bodyPortableText)},
      ${input.bodyPortableText}::jsonb,
      ${input.status}, ${input.visibility}, ${input.locale},
      ${input.featuredMediaId}::uuid,
      ${input.seoTitle}, ${input.metaDescription}, ${input.publishedAt},
      ${system}, ${input.legacyId}
    )
    ON CONFLICT (tenant_id, legacy_source_system, legacy_source_id)
      WHERE legacy_source_id IS NOT NULL
      DO NOTHING
    RETURNING id
  `) as { id: string }[];

  return { legacyId: input.legacyId, postId: rows[0]?.id ?? null };
}

/**
 * Slugs already taken in this tenant, out of a candidate set.
 *
 * A legacy archive routinely holds two articles whose titles slugified to the
 * same string years apart, and `awcms_blog_posts` has its own slug uniqueness.
 * Finding out one row at a time means a partially-completed import and a
 * constraint error in the middle of 23,906 rows; finding out up front means a
 * report the operator reads BEFORE anything is written, which is the whole
 * reason preview is the default mode.
 */
export async function findTakenSlugs(
  tx: Bun.SQL,
  tenantId: string,
  slugs: readonly string[]
): Promise<Set<string>> {
  if (slugs.length === 0) {
    return new Set();
  }

  // `tx.array` rather than `${slugs}`: an array interpolated directly arrives
  // as comma-joined TEXT and fails with 22P02, which is a repo-wide trap.
  const rows = (await tx`
    SELECT slug
    FROM awcms_blog_posts
    WHERE tenant_id = ${tenantId}
      AND deleted_at IS NULL
      AND slug = ANY(${tx.array([...slugs], "text")}::text[])
  `) as { slug: string }[];

  return new Set(rows.map((row) => row.slug));
}
