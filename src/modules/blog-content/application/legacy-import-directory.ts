/**
 * Bulk import of legacy articles (Issue #599).
 *
 * ## Why this is not `createBlogPost` plus `transitionBlogPostStatus`
 *
 * Three reasons, and the first is the one the whole issue is about.
 *
 * NOTE ON "23,906" (every occurrence in this file): the measured snapshot is
 * 25,029 — see ADR-0114 §Consequences, which is the single correction the
 * figure points at. Left standing because these are arguments about scale, and
 * scale does not move.
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
import {
  portableTextToPlainText,
  withProjectedBlocks
} from "../domain/portable-text-conversion";
import type {
  BlogContentStatus,
  BlogContentVisibility
} from "../domain/post-status";

/**
 * The `content_json` envelope for one imported row.
 *
 * ## It used to be a constant, and the constant was the bug
 *
 * This was `const EMPTY_CONTENT_JSON = { blocks: [] }`, bound directly into the
 * INSERT, under a docblock on `importLegacyBlogPost` claiming `content_json`
 * was "written as the same lossy projection every other write path produces …
 * so an imported row is indistinguishable in shape from an authored one".
 *
 * It was not the same projection. `blog-post-directory.ts:235` and
 * `blog-page-directory.ts:201` both call `withProjectedBlocks`; this file
 * called nothing and shipped a literal empty array. **A comment is not a
 * call** — this repo's recurring class, and here it cost the whole cutover:
 *
 *  - `ahliweb/awcms-astro` renders an article body with
 *    `renderContentBlocks(post.contentJson)`, which reads `contentJson.blocks`
 *    and returns `""` for anything that is not a non-empty array. Every
 *    imported article was a blank page.
 *  - The same repo decides whether an article is built at ALL with
 *    `readBlock(post).kategori === tab`, reading `contentJson.awcmsAstro`. With
 *    no such key that is `undefined === tab` for every configured tab, so no
 *    article page was generated — and no category archive either, because
 *    those are built from the same tab-filtered set. The 63 rubrik rules of
 *    ADR-0113 and the id-keyed article map of ADR-0114 would both have
 *    redirected onto pages that were never generated.
 *
 * Nothing in THIS repo could see either one: `/blog/{code}/{slug}` renders from
 * `body_portable_text` and only falls back to this projection for
 * un-backfilled rows (`blog-body-rendering.ts`), so an imported post looked
 * correct here while the repo that actually serves this archive built nothing.
 *
 * ## Bound as a VALUE
 *
 * Never `JSON.stringify` of one: Bun JSON-encodes a string parameter bound to a
 * jsonb slot, which stores the scalar string `"{\"blocks\":[]}"` instead of the
 * object (Issue #641).
 *
 * `awcmsAstro` is written only when a section was resolved, and the key is
 * OMITTED rather than set to `null` when it was not. `readBlock` treats a
 * non-object as absent, so the two behave identically on the consumer — but an
 * envelope that carries the key with no value reads, to the next person, like a
 * section that was chosen and came out empty.
 */
export function legacyContentJson(
  bodyPortableText: PortableTextDocument,
  section: string | null
): Record<string, unknown> {
  return withProjectedBlocks(
    section === null
      ? {}
      : { awcmsAstro: { schemaVersion: 1, kategori: section } },
    bodyPortableText
  );
}

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
  /**
   * The SECTION this article belongs to on the consuming site, resolved from
   * `--section-map` by the caller, or `null` when no map was supplied.
   *
   * It is written to `content_json.awcmsAstro.kategori`, which is the field
   * `ahliweb/awcms-astro` filters on to decide whether an article is built at
   * all (`getArticles`: `readBlock(post).kategori === tab`). `null` means the
   * article imports correctly here and is invisible there — a legitimate state
   * for a tenant this repo serves directly, and the reason the importer WARNS
   * rather than refuses. See `domain/legacy-section-map.ts`.
   *
   * Deliberately NOT verified here: a section is a tab slug in the consuming
   * repo's `siteConfig.tabs`, a vocabulary in another repository that nothing
   * in this database can be checked against. `parseLegacySectionMap` proves it
   * is a valid slug; nothing can prove it is a configured one.
   */
  section: string | null;
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
 * `content_json` is written by `legacyContentJson`, which calls the SAME
 * `withProjectedBlocks` the two authoring directories call (ADR-0100: the
 * canonical body is `body_portable_text`), and `content_text` is derived rather
 * than supplied, so an imported row is indistinguishable in shape from an
 * authored one. That sentence used to be here over a hard-coded `{ blocks: [] }`
 * that made it false — see `legacyContentJson` for what it cost.
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
      ${legacyContentJson(input.bodyPortableText, input.section)}::jsonb,
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
