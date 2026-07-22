/**
 * Public (anonymous) read queries for `awcms_blog_posts` (Issue
 * #540). Every function here enforces tenant scoping via an explicit
 * `tenant_id = $1` predicate (the caller connects via the least-privilege
 * app role with RLS FORCE'd — same defense-in-depth convention as every
 * other tenant-scoped query in this repo) and a public-visibility
 * predicate — never the admin `blog-post-directory.ts` functions, which
 * assume an authenticated+authorized caller.
 *
 * Two distinct predicates, both from doc issue #540:
 * - **Listing** (index/category/tag archive/feed/sitemap):
 *   `status = 'published' AND visibility = 'public' AND deleted_at IS NULL
 *   AND published_at IS NOT NULL AND published_at <= now()` — the exact
 *   predicate #539's `searchPublicBlogContent` already implements.
 * - **Detail** (single post by slug): same, but `visibility IN ('public',
 *   'unlisted')` — doc issue #540's acceptance criteria explicitly scope
 *   the unlisted exclusion to "listing/search/feed/sitemap" only, meaning
 *   an unlisted post *is* reachable by direct link (that is the entire
 *   point of the "unlisted" tier existing separately from "private",
 *   which is never publicly reachable at all).
 */
import type { BlogContentVisibility } from "../domain/post-status";
import {
  boundedPageNumber,
  boundedPageSize as sharedBoundedPageSize
} from "../../_shared/offset-pagination";
export type PublicBlogPostDetail = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentJson: Record<string, unknown>;
  contentText: string;
  seoTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  locale: string;
  publishedAt: Date;
  /** Issue #649 — `dateModified` for JSON-LD `NewsArticle` structured data. */
  updatedAt: Date;
  /** Issue #649 — `public` renders indexable metadata (`index,follow,...`); `unlisted` (reachable by direct link only, excluded from listings/sitemap/feed) renders `noindex,nofollow`. `private` never reaches this far (`fetchPublicBlogPostBySlug`'s own predicate excludes it). */
  visibility: BlogContentVisibility;
  /** Issue #636 — added so public detail routes can resolve it to a verified R2 media object for gallery/og:image rendering (`resolveVerifiedNewsMediaReferences`). Not previously selected here since nothing rendered it before this issue. */
  featuredMediaId: string | null;
  /** Issue #641 — per-post opt-out of automatic internal tag linking, read by the public detail routes before calling `renderContentHtmlWithInternalTagLinks`. */
  autoInternalTagLinksDisabled: boolean;
  /** Issue #649 — explicit "use this image for social/SEO preview" override; highest priority source in `social-preview-image-resolution.ts`'s chain, ahead of `featuredMediaId`. */
  seoImageMediaId: string | null;
};

type PublicBlogPostDetailRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content_json: Record<string, unknown>;
  content_text: string;
  seo_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  locale: string;
  published_at: Date;
  updated_at: Date;
  visibility: BlogContentVisibility;
  featured_media_id: string | null;
  auto_internal_tag_links_disabled: boolean;
  seo_image_media_id: string | null;
};

function toDetail(row: PublicBlogPostDetailRow): PublicBlogPostDetail {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    contentJson: row.content_json,
    contentText: row.content_text,
    seoTitle: row.seo_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url,
    locale: row.locale,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    visibility: row.visibility,
    featuredMediaId: row.featured_media_id,
    autoInternalTagLinksDisabled: row.auto_internal_tag_links_disabled,
    seoImageMediaId: row.seo_image_media_id
  };
}

export async function fetchPublicBlogPostBySlug(
  tx: Bun.SQL,
  tenantId: string,
  slug: string
): Promise<PublicBlogPostDetail | null> {
  const rows = (await tx`
    SELECT id, title, slug, excerpt, content_json, content_text, seo_title,
      meta_description, canonical_url, locale, published_at, updated_at,
      visibility, featured_media_id, auto_internal_tag_links_disabled,
      seo_image_media_id
    FROM awcms_blog_posts
    WHERE tenant_id = ${tenantId} AND slug = ${slug}
      AND status = 'published' AND visibility IN ('public', 'unlisted')
      AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()
    ORDER BY published_at DESC
    LIMIT 1
  `) as PublicBlogPostDetailRow[];

  const row = rows[0];
  return row ? toDetail(row) : null;
}

export type PublicBlogPostSummary = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  publishedAt: Date;
  /** Issue #637 — added so homepage section cards can resolve it to a verified R2 media object, same reason #636 added it to `PublicBlogPostDetail`. Not selected by every query below (only where a caller actually renders an image). */
  featuredMediaId: string | null;
};

type PublicBlogPostSummaryRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  published_at: Date;
  featured_media_id: string | null;
};

function toSummary(row: PublicBlogPostSummaryRow): PublicBlogPostSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    publishedAt: row.published_at,
    featuredMediaId: row.featured_media_id
  };
}

export type PublicBlogPostPage = {
  items: PublicBlogPostSummary[];
  hasNextPage: boolean;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

function boundedPageSize(pageSize: number | undefined): number {
  return sharedBoundedPageSize(pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
}

/**
 * Clamped at both ends via the shared helper (Issue #819) — these routes are
 * public and unauthenticated, so an unbounded `page` was a one-request
 * deep-offset scan (`?page=1e8` → `OFFSET 1e9`) and `NaN` was a 500.
 */
function boundedPage(page: number | undefined): number {
  return boundedPageNumber(page);
}

/** Standard `?page=` (1-indexed) pagination — fetches `pageSize + 1` rows to derive `hasNextPage` without a separate `COUNT(*)` query, same "one extra row" trick used for cursor pagination elsewhere in this repo. */
export async function listPublicBlogPosts(
  tx: Bun.SQL,
  tenantId: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<PublicBlogPostPage> {
  const pageSize = boundedPageSize(options.pageSize);
  const page = boundedPage(options.page);
  const offset = (page - 1) * pageSize;

  const rows = (await tx`
    SELECT id, title, slug, excerpt, published_at, featured_media_id
    FROM awcms_blog_posts
    WHERE tenant_id = ${tenantId}
      AND status = 'published' AND visibility = 'public'
      AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()
    ORDER BY published_at DESC
    LIMIT ${pageSize + 1} OFFSET ${offset}
  `) as PublicBlogPostSummaryRow[];

  const hasNextPage = rows.length > pageSize;

  return {
    items: rows.slice(0, pageSize).map(toSummary),
    hasNextPage
  };
}

export type PublicTermSummary = {
  id: string;
  taxonomyType: string;
  name: string;
  slug: string;
  description: string | null;
};

/** Category/tag lookup for an archive page — 404 if the term doesn't exist or is soft-deleted, same as any other public "not found" case. */
export async function fetchPublicTermBySlug(
  tx: Bun.SQL,
  tenantId: string,
  taxonomyType: string,
  slug: string
): Promise<PublicTermSummary | null> {
  const rows = (await tx`
    SELECT id, taxonomy_type, name, slug, description
    FROM awcms_blog_terms
    WHERE tenant_id = ${tenantId} AND taxonomy_type = ${taxonomyType}
      AND slug = ${slug} AND deleted_at IS NULL
  `) as {
    id: string;
    taxonomy_type: string;
    name: string;
    slug: string;
    description: string | null;
  }[];

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    taxonomyType: row.taxonomy_type,
    name: row.name,
    slug: row.slug,
    description: row.description
  };
}

export type PublicPostTaxonomyTerm = {
  taxonomyType: string;
  name: string;
  slug: string;
};

/**
 * Category/tag names assigned to a public post (Issue #649 — `article:
 * section`/`article:tag` Open Graph meta and JSON-LD `NewsArticle`
 * `articleSection`/`keywords`). Tenant-scoped join against
 * `awcms_blog_post_terms`, excludes soft-deleted terms (same
 * `deleted_at IS NULL` convention as `fetchPublicTermBySlug`) — a term an
 * editor later archived should stop appearing in newly-rendered share
 * previews without needing a post edit. Ordered by taxonomy type then name
 * so category-typed terms are deterministically first (the caller picks the
 * first `taxonomyType === "category"` entry as `article:section`, and the
 * remainder — including tags — as `article:tag`).
 */
export async function fetchPublicPostTaxonomyTerms(
  tx: Bun.SQL,
  tenantId: string,
  postId: string
): Promise<PublicPostTaxonomyTerm[]> {
  const rows = (await tx`
    SELECT t.taxonomy_type, t.name, t.slug
    FROM awcms_blog_post_terms pt
    JOIN awcms_blog_terms t
      ON t.id = pt.term_id AND t.tenant_id = pt.tenant_id
    WHERE pt.tenant_id = ${tenantId} AND pt.post_id = ${postId}
      AND t.deleted_at IS NULL
    ORDER BY t.taxonomy_type ASC, t.name ASC
  `) as { taxonomy_type: string; name: string; slug: string }[];

  return rows.map((row) => ({
    taxonomyType: row.taxonomy_type,
    name: row.name,
    slug: row.slug
  }));
}

export async function listPublicBlogPostsByTermId(
  tx: Bun.SQL,
  tenantId: string,
  termId: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<PublicBlogPostPage> {
  const pageSize = boundedPageSize(options.pageSize);
  const page = boundedPage(options.page);
  const offset = (page - 1) * pageSize;

  const rows = (await tx`
    SELECT p.id, p.title, p.slug, p.excerpt, p.published_at, p.featured_media_id
    FROM awcms_blog_posts p
    JOIN awcms_blog_post_terms pt
      ON pt.post_id = p.id AND pt.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${tenantId} AND pt.term_id = ${termId}
      AND p.status = 'published' AND p.visibility = 'public'
      AND p.deleted_at IS NULL AND p.published_at IS NOT NULL AND p.published_at <= now()
    ORDER BY p.published_at DESC
    LIMIT ${pageSize + 1} OFFSET ${offset}
  `) as PublicBlogPostSummaryRow[];

  const hasNextPage = rows.length > pageSize;

  return {
    items: rows.slice(0, pageSize).map(toSummary),
    hasNextPage
  };
}

/**
 * Fetches public/published summaries for a curated set of post ids (Issue
 * #637 — `headline`/`featured_posts`/`editor_picks` homepage sections),
 * preserving the CALLER's requested order (not `published_at DESC`) since
 * curation order is editorially meaningful here, unlike the chronological
 * listing functions above. A stale/unpublished/cross-tenant/soft-deleted
 * id is silently dropped from the result rather than throwing — same
 * "degrade, don't 500" convention `resolveVerifiedNewsMediaReferences`
 * uses for media references.
 */
export async function fetchPublicBlogPostSummariesByIds(
  tx: Bun.SQL,
  tenantId: string,
  postIds: readonly string[]
): Promise<PublicBlogPostSummary[]> {
  if (postIds.length === 0) {
    return [];
  }

  const rows = (await tx`
    SELECT id, title, slug, excerpt, published_at, featured_media_id
    FROM awcms_blog_posts
    WHERE tenant_id = ${tenantId} AND id = ANY(${tx.array([...new Set(postIds)], "uuid")})
      AND status = 'published' AND visibility = 'public'
      AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()
  `) as PublicBlogPostSummaryRow[];

  const byId = new Map(rows.map((row) => [row.id, toSummary(row)]));

  return postIds
    .map((id) => byId.get(id))
    .filter(
      (summary): summary is PublicBlogPostSummary => summary !== undefined
    );
}

const FEED_ITEM_LIMIT = 50;

/** RSS/sitemap source — flat, unpaginated (feeds/sitemaps are consumed by machines, not paged by a visitor), bounded to the latest 50 published public posts. */
export async function listPublicBlogPostsForFeed(
  tx: Bun.SQL,
  tenantId: string
): Promise<PublicBlogPostDetail[]> {
  const rows = (await tx`
    SELECT id, title, slug, excerpt, content_json, content_text, seo_title,
      meta_description, canonical_url, locale, published_at, updated_at,
      visibility, featured_media_id, seo_image_media_id
    FROM awcms_blog_posts
    WHERE tenant_id = ${tenantId}
      AND status = 'published' AND visibility = 'public'
      AND deleted_at IS NULL
      AND published_at IS NOT NULL AND published_at <= now()
    ORDER BY published_at DESC
    LIMIT ${FEED_ITEM_LIMIT}
  `) as PublicBlogPostDetailRow[];

  return rows.map(toDetail);
}

export type PublicBlogSettings = {
  postsPerPage: number;
  seoDefaultTitle: string | null;
  seoDefaultDescription: string | null;
};

const DEFAULT_POSTS_PER_PAGE = 10;

/** Reads `awcms_blog_settings` (Issue #537), falling back to schema defaults when the tenant has never configured a row — same "missing row = default" convention `resolveModuleEnabled` uses for `awcms_tenant_modules`. */
export async function fetchPublicBlogSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<PublicBlogSettings> {
  const rows = (await tx`
    SELECT posts_per_page, seo_default_title, seo_default_description
    FROM awcms_blog_settings
    WHERE tenant_id = ${tenantId}
  `) as {
    posts_per_page: number;
    seo_default_title: string | null;
    seo_default_description: string | null;
  }[];

  const row = rows[0];

  return {
    postsPerPage: row?.posts_per_page ?? DEFAULT_POSTS_PER_PAGE,
    seoDefaultTitle: row?.seo_default_title ?? null,
    seoDefaultDescription: row?.seo_default_description ?? null
  };
}
