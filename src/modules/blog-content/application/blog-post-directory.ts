import type {
  BlogContentStatus,
  BlogContentVisibility
} from "../domain/post-status";
import type {
  CreateBlogPostInput,
  UpdateBlogPostInput
} from "../domain/blog-post-validation";
import {
  boundedPageNumber,
  boundedPageSize
} from "../../_shared/offset-pagination";

/**
 * Read/write query module for `awcms_blog_posts` (Issue #537 scaffolded
 * this file as a read-only placeholder; Issue #538 fills in the mutations
 * its admin API needs) — same "directory holds both reads and writes for one
 * resource" convention as `email/application/email-template-directory.ts`.
 */
export type BlogPostSummary = {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  locale: string;
  publishedAt: Date | null;
  updatedAt: Date;
};

type BlogPostSummaryRow = {
  id: string;
  tenant_id: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  locale: string;
  published_at: Date | null;
  updated_at: Date;
};

function toBlogPostSummary(row: BlogPostSummaryRow): BlogPostSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    visibility: row.visibility,
    locale: row.locale,
    publishedAt: row.published_at,
    updatedAt: row.updated_at
  };
}

export type BlogPostView = {
  id: string;
  tenantId: string;
  authorTenantUserId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentJson: Record<string, unknown>;
  contentText: string;
  status: BlogContentStatus;
  visibility: BlogContentVisibility;
  featuredMediaId: string | null;
  /** Issue #649 — explicit social/SEO preview image override; see `blog-post-validation.ts`'s `CreateBlogPostInput.seoImageMediaId`. */
  seoImageMediaId: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  locale: string;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
  restoredAt: Date | null;
  restoredBy: string | null;
  version: number;
  /** Issue #641 — manual per-post opt-out of automatic internal tag linking. */
  autoInternalTagLinksDisabled: boolean;
};

type BlogPostRow = {
  id: string;
  tenant_id: string;
  author_tenant_user_id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content_json: Record<string, unknown>;
  content_text: string;
  status: BlogContentStatus;
  visibility: BlogContentVisibility;
  featured_media_id: string | null;
  seo_image_media_id: string | null;
  seo_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  locale: string;
  published_at: Date | null;
  scheduled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
  restored_at: Date | null;
  restored_by: string | null;
  version: number;
  auto_internal_tag_links_disabled: boolean;
};

function toView(row: BlogPostRow): BlogPostView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    authorTenantUserId: row.author_tenant_user_id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    contentJson: row.content_json,
    contentText: row.content_text,
    status: row.status,
    visibility: row.visibility,
    featuredMediaId: row.featured_media_id,
    seoImageMediaId: row.seo_image_media_id,
    seoTitle: row.seo_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url,
    locale: row.locale,
    publishedAt: row.published_at,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason,
    restoredAt: row.restored_at,
    restoredBy: row.restored_by,
    version: row.version,
    autoInternalTagLinksDisabled: row.auto_internal_tag_links_disabled
  };
}

export async function createBlogPost(
  tx: Bun.SQL,
  tenantId: string,
  authorTenantUserId: string,
  input: CreateBlogPostInput
): Promise<BlogPostView> {
  const rows = (await tx`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
       content_text, status, visibility, featured_media_id, seo_image_media_id,
       seo_title, meta_description, canonical_url, locale,
       auto_internal_tag_links_disabled)
    VALUES (
      ${tenantId}, ${authorTenantUserId}, ${input.title}, ${input.slug},
      ${input.excerpt}, ${input.contentJson}, ${input.contentText}, 'draft',
      ${input.visibility}, ${input.featuredMediaId}, ${input.seoImageMediaId},
      ${input.seoTitle}, ${input.metaDescription}, ${input.canonicalUrl}, ${input.locale},
      ${input.autoInternalTagLinksDisabled}
    )
    RETURNING id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_image_media_id, seo_title,
      meta_description, canonical_url, locale, published_at, scheduled_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason,
      restored_at, restored_by, version, auto_internal_tag_links_disabled
  `) as BlogPostRow[];

  return toView(rows[0]!);
}

export type FetchBlogPostOptions = {
  includeDeleted?: boolean;
};

/** Excludes soft-deleted posts unless `includeDeleted` (restore/purge need to look up an already-deleted row). */
export async function fetchBlogPostById(
  tx: Bun.SQL,
  tenantId: string,
  postId: string,
  options: FetchBlogPostOptions = {}
): Promise<BlogPostView | null> {
  const rows = (
    options.includeDeleted
      ? await tx`
        SELECT id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_image_media_id, seo_title,
      meta_description, canonical_url, locale, published_at, scheduled_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason,
      restored_at, restored_by, version, auto_internal_tag_links_disabled
        FROM awcms_blog_posts
        WHERE tenant_id = ${tenantId} AND id = ${postId}
      `
      : await tx`
        SELECT id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_image_media_id, seo_title,
      meta_description, canonical_url, locale, published_at, scheduled_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason,
      restored_at, restored_by, version, auto_internal_tag_links_disabled
        FROM awcms_blog_posts
        WHERE tenant_id = ${tenantId} AND id = ${postId} AND deleted_at IS NULL
      `
  ) as BlogPostRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

export type ListBlogPostsFilter = {
  status?: BlogContentStatus;
  limit?: number;
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/** `LIMIT` bounded (default 20, max 100), newest-updated first — same bounded-list convention as `email/templates` and `workflows/tasks` (no cursor pagination yet). */
export async function listBlogPosts(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListBlogPostsFilter = {}
): Promise<BlogPostSummary[]> {
  const limit = boundedPageSize(
    filter.limit,
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT
  );

  const rows = (
    filter.status
      ? await tx`
        SELECT id, tenant_id, title, slug, status, visibility, locale, published_at, updated_at
        FROM awcms_blog_posts
        WHERE tenant_id = ${tenantId} AND status = ${filter.status} AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
      : await tx`
        SELECT id, tenant_id, title, slug, status, visibility, locale, published_at, updated_at
        FROM awcms_blog_posts
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `
  ) as BlogPostSummaryRow[];

  return rows.map(toBlogPostSummary);
}

/** Kept for the pre-#538 call shape (filter by status with an explicit limit) — a thin wrapper over `listBlogPosts`. */
export async function listBlogPostsByStatus(
  tx: Bun.SQL,
  tenantId: string,
  status: BlogContentStatus,
  limit: number = DEFAULT_LIST_LIMIT
): Promise<BlogPostSummary[]> {
  return listBlogPosts(tx, tenantId, { status, limit });
}

/** Partial update; `version` is bumped on every successful write (monotonic change counter — no optimistic-concurrency check is enforced yet, see module README). */
export async function updateBlogPost(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: UpdateBlogPostInput
): Promise<BlogPostView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_posts
    SET title = COALESCE(${input.title ?? null}, title),
        slug = COALESCE(${input.slug ?? null}, slug),
        excerpt = CASE WHEN ${input.excerpt === undefined} THEN excerpt ELSE ${input.excerpt ?? null} END,
        content_json = COALESCE(${input.contentJson ?? null}, content_json),
        content_text = COALESCE(${input.contentText ?? null}, content_text),
        locale = COALESCE(${input.locale ?? null}, locale),
        visibility = COALESCE(${input.visibility ?? null}, visibility),
        featured_media_id = CASE
          WHEN ${input.featuredMediaId === undefined} THEN featured_media_id
          ELSE ${input.featuredMediaId ?? null}
        END,
        seo_image_media_id = CASE
          WHEN ${input.seoImageMediaId === undefined} THEN seo_image_media_id
          ELSE ${input.seoImageMediaId ?? null}
        END,
        seo_title = CASE WHEN ${input.seoTitle === undefined} THEN seo_title ELSE ${input.seoTitle ?? null} END,
        meta_description = CASE
          WHEN ${input.metaDescription === undefined} THEN meta_description
          ELSE ${input.metaDescription ?? null}
        END,
        canonical_url = CASE
          WHEN ${input.canonicalUrl === undefined} THEN canonical_url
          ELSE ${input.canonicalUrl ?? null}
        END,
        auto_internal_tag_links_disabled = COALESCE(
          ${input.autoInternalTagLinksDisabled ?? null},
          auto_internal_tag_links_disabled
        ),
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_image_media_id, seo_title,
      meta_description, canonical_url, locale, published_at, scheduled_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason,
      restored_at, restored_by, version, auto_internal_tag_links_disabled
  `) as BlogPostRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function softDeleteBlogPost(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_posts
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

export type TransitionBlogPostStatusOptions = {
  scheduledAt?: Date;
};

/**
 * Shared mutation for submit-review/publish/schedule/archive (Issue #538) —
 * status-transition validity itself (`isValidStatusTransition`) is checked
 * by the caller before this runs, so this is a plain conditional write, not
 * a second source of truth for which transitions are legal.
 */
export async function transitionBlogPostStatus(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  toStatus: BlogContentStatus,
  options: TransitionBlogPostStatusOptions = {}
): Promise<BlogPostView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_posts
    SET status = ${toStatus},
        published_at = CASE WHEN ${toStatus === "published"} THEN now() ELSE published_at END,
        scheduled_at = CASE
          WHEN ${toStatus === "scheduled"} THEN ${options.scheduledAt ?? null}
          WHEN ${toStatus !== "scheduled"} THEN NULL
          ELSE scheduled_at
        END,
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_image_media_id, seo_title,
      meta_description, canonical_url, locale, published_at, scheduled_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason,
      restored_at, restored_by, version, auto_internal_tag_links_disabled
  `) as BlogPostRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function restoreBlogPost(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string
): Promise<BlogPostView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_posts
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        restored_at = now(), restored_by = ${actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
    RETURNING id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_image_media_id, seo_title,
      meta_description, canonical_url, locale, published_at, scheduled_at,
      created_at, updated_at, deleted_at, deleted_by, delete_reason,
      restored_at, restored_by, version, auto_internal_tag_links_disabled
  `) as BlogPostRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type ListBlogPostsForAdminFilter = {
  search?: string;
  status?: BlogContentStatus;
  /** Matches posts assigned this category/tag term id (via `awcms_blog_post_terms`). */
  termId?: string;
  page?: number;
  pageSize?: number;
};

export type ListBlogPostsForAdminResult = {
  items: (BlogPostSummary & { authorTenantUserId: string })[];
  total: number;
  page: number;
  pageSize: number;
};

type BlogPostAdminListRow = BlogPostSummaryRow & {
  author_tenant_user_id: string;
};

const DEFAULT_ADMIN_LIST_PAGE_SIZE = 20;
const MAX_ADMIN_LIST_PAGE_SIZE = 100;

/**
 * Admin post list (Issue #543 §Post List — search, status filter,
 * category/tag filter, pagination) — additive to this file, does not touch
 * `listBlogPosts` (still used by `GET /api/v1/blog/posts` as-is). `search`
 * is a plain `ILIKE` on `title` (not `search_vector`/`websearch_to_tsquery`
 * — those reject an empty query, which the default "no filter" list view
 * needs to tolerate). `termId` matches via `EXISTS` against
 * `awcms_blog_post_terms` rather than a `JOIN`, so a post with several
 * terms is never returned more than once. Page-number/`LIMIT`/`OFFSET`
 * pagination (not keyset) — this is a human-browsed admin table with
 * "page 1, 2, 3" controls, same UX category `public-blog-directory.ts`'s
 * index/archive pagination already chose over keyset for the same reason.
 */
export async function listBlogPostsForAdmin(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListBlogPostsForAdminFilter = {}
): Promise<ListBlogPostsForAdminResult> {
  const pageSize = boundedPageSize(
    filter.pageSize,
    DEFAULT_ADMIN_LIST_PAGE_SIZE,
    MAX_ADMIN_LIST_PAGE_SIZE
  );
  const page = boundedPageNumber(filter.page);
  const offset = (page - 1) * pageSize;
  const search = filter.search?.trim() || null;
  const status = filter.status ?? null;
  const termId = filter.termId ?? null;

  const rows = (await tx`
    SELECT p.id, p.tenant_id, p.title, p.slug, p.status, p.visibility, p.locale,
           p.author_tenant_user_id, p.published_at, p.updated_at
    FROM awcms_blog_posts p
    WHERE p.tenant_id = ${tenantId} AND p.deleted_at IS NULL
      AND (${status}::text IS NULL OR p.status = ${status})
      AND (${search}::text IS NULL OR p.title ILIKE '%' || ${search} || '%')
      AND (
        ${termId}::uuid IS NULL
        OR EXISTS (
          SELECT 1 FROM awcms_blog_post_terms pt
          WHERE pt.tenant_id = p.tenant_id AND pt.post_id = p.id AND pt.term_id = ${termId}
        )
      )
    ORDER BY p.updated_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `) as BlogPostAdminListRow[];

  const countRows = (await tx`
    SELECT count(*)::int AS count
    FROM awcms_blog_posts p
    WHERE p.tenant_id = ${tenantId} AND p.deleted_at IS NULL
      AND (${status}::text IS NULL OR p.status = ${status})
      AND (${search}::text IS NULL OR p.title ILIKE '%' || ${search} || '%')
      AND (
        ${termId}::uuid IS NULL
        OR EXISTS (
          SELECT 1 FROM awcms_blog_post_terms pt
          WHERE pt.tenant_id = p.tenant_id AND pt.post_id = p.id AND pt.term_id = ${termId}
        )
      )
  `) as { count: number }[];

  return {
    items: rows.map((row) => ({
      ...toBlogPostSummary(row),
      authorTenantUserId: row.author_tenant_user_id
    })),
    total: countRows[0]?.count ?? 0,
    page,
    pageSize
  };
}

/**
 * Hard delete. `awcms_blog_post_terms` rows for this post are deleted
 * first — they are pure join metadata with no independent meaning once the
 * post is gone, unlike `awcms_blog_revisions` (no FK to the post,
 * intentionally left as historical record, same reasoning audit events keep
 * referencing purged resources by id). Caller must have already verified
 * `canPurgePost` (archived or soft-deleted) before calling this.
 */
export async function purgeBlogPost(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<boolean> {
  await tx`
    DELETE FROM awcms_blog_post_terms
    WHERE tenant_id = ${tenantId} AND post_id = ${id}
  `;

  const rows = await tx`
    DELETE FROM awcms_blog_posts
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING id
  `;

  return rows.length > 0;
}
