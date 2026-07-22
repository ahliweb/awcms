/**
 * `PublicContentPort` (Issue #681, epic #679 platform-hardening) — the
 * capability `news_portal` consumes from `blog_content`: read-only,
 * public-safe post/category queries for the editorial homepage section
 * composer (Issue #637). Lives in neutral ground (`_shared`, imports
 * NOTHING from either module), same reasoning as `news-media-port.ts`
 * (see that file's header) but for the opposite direction of capability
 * flow — `blog_content` is the PROVIDER here, `news_portal` the consumer.
 *
 * DTOs here are deliberately their own, minimal shape (not a re-export of
 * `blog-content/application/public-blog-directory.ts`'s own exported
 * types) — a port must not create a source dependency on the module that
 * happens to implement it today.
 *
 * Before this issue, `news-portal/application/homepage-section-
 * composer.ts` and `homepage-section-reference-validation.ts` imported
 * `blog-content/application/public-blog-directory.ts` and
 * `blog-content/application/blog-post-directory.ts` directly. The
 * concrete implementation now lives in
 * `blog-content/application/public-content-port-adapter.ts`, wired at the
 * composition root (every `news_portal` route handler that needs this
 * capability imports the concrete adapter and passes it in).
 */
export type PublicContentPostSummaryDTO = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featuredMediaId: string | null;
};

export type PublicContentPostPageDTO = {
  items: readonly PublicContentPostSummaryDTO[];
  hasNextPage: boolean;
};

export type PublicContentCategoryDTO = {
  id: string;
  name: string;
  slug: string;
};

export type PublicContentPort = {
  /** `true` only if `postId` exists for `tenantId` and is not soft-deleted — existence/ownership check, NOT a public-visibility check (curated homepage sections may reference a not-yet-published post; render-time re-resolution enforces visibility separately). */
  postExists(tx: Bun.SQL, tenantId: string, postId: string): Promise<boolean>;

  /** Public/published post summaries for a curated set of ids, in the CALLER's requested order (curation order, not chronological) — a stale/unpublished/cross-tenant id is silently dropped. */
  fetchPostSummariesByIds(
    tx: Bun.SQL,
    tenantId: string,
    postIds: readonly string[]
  ): Promise<PublicContentPostSummaryDTO[]>;

  /** `null` if the category doesn't exist for `tenantId` or is soft-deleted. */
  fetchCategoryBySlug(
    tx: Bun.SQL,
    tenantId: string,
    slug: string
  ): Promise<PublicContentCategoryDTO | null>;

  /** Latest published/public posts, newest first. */
  listPosts(
    tx: Bun.SQL,
    tenantId: string,
    options: { pageSize?: number }
  ): Promise<PublicContentPostPageDTO>;

  /** Latest published/public posts in `categoryId`, newest first. */
  listPostsByCategoryId(
    tx: Bun.SQL,
    tenantId: string,
    categoryId: string,
    options: { pageSize?: number }
  ): Promise<PublicContentPostPageDTO>;
};
