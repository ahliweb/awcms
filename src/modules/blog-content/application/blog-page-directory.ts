import type {
  BlogContentStatus,
  BlogContentVisibility
} from "../domain/post-status";
import type {
  CreateBlogPageInput,
  UpdateBlogPageInput
} from "../domain/blog-page-validation";
import type { PageType } from "../domain/page-type";
import {
  boundedPageNumber,
  boundedPageSize
} from "../../_shared/offset-pagination";

/**
 * Read/write query module for `awcms_blog_pages` (Issue #539) — same
 * "directory holds both reads and writes for one resource" convention
 * `blog-post-directory.ts` (Issue #538) established. Pages get plain CRUD
 * only (no publish/schedule/archive/restore/purge lifecycle actions —
 * doc issue #539's Routes section lists only GET/POST/GET/PATCH/DELETE for
 * pages, unlike posts; those permissions are already seeded (#537) for a
 * future issue to wire up, not this one).
 */
export type BlogPageSummary = {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  pageType: string;
  parentPageId: string | null;
  menuOrder: number;
  locale: string;
  updatedAt: Date;
};

type BlogPageSummaryRow = {
  id: string;
  tenant_id: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  page_type: string;
  parent_page_id: string | null;
  menu_order: number;
  locale: string;
  updated_at: Date;
};

function toBlogPageSummary(row: BlogPageSummaryRow): BlogPageSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    visibility: row.visibility,
    pageType: row.page_type,
    parentPageId: row.parent_page_id,
    menuOrder: row.menu_order,
    locale: row.locale,
    updatedAt: row.updated_at
  };
}

export type BlogPageView = {
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
  seoTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  locale: string;
  pageType: PageType;
  parentPageId: string | null;
  menuOrder: number;
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
};

type BlogPageRow = {
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
  seo_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  locale: string;
  page_type: PageType;
  parent_page_id: string | null;
  menu_order: number;
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
};

function toView(row: BlogPageRow): BlogPageView {
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
    seoTitle: row.seo_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url,
    locale: row.locale,
    pageType: row.page_type,
    parentPageId: row.parent_page_id,
    menuOrder: row.menu_order,
    publishedAt: row.published_at,
    scheduledAt: row.scheduled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason,
    restoredAt: row.restored_at,
    restoredBy: row.restored_by,
    version: row.version
  };
}

export async function createBlogPage(
  tx: Bun.SQL,
  tenantId: string,
  authorTenantUserId: string,
  input: CreateBlogPageInput
): Promise<BlogPageView> {
  const rows = (await tx`
    INSERT INTO awcms_blog_pages
      (tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
       content_text, status, visibility, featured_media_id, seo_title,
       meta_description, canonical_url, locale, page_type, parent_page_id,
       menu_order)
    VALUES (
      ${tenantId}, ${authorTenantUserId}, ${input.title}, ${input.slug},
      ${input.excerpt}, ${input.contentJson}, ${input.contentText}, 'draft',
      ${input.visibility}, ${input.featuredMediaId}, ${input.seoTitle},
      ${input.metaDescription}, ${input.canonicalUrl}, ${input.locale},
      ${input.pageType}, ${input.parentPageId}, ${input.menuOrder}
    )
    RETURNING id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_title,
      meta_description, canonical_url, locale, page_type, parent_page_id,
      menu_order, published_at, scheduled_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by, version
  `) as BlogPageRow[];

  return toView(rows[0]!);
}

export type FetchBlogPageOptions = {
  includeDeleted?: boolean;
};

export async function fetchBlogPageById(
  tx: Bun.SQL,
  tenantId: string,
  pageId: string,
  options: FetchBlogPageOptions = {}
): Promise<BlogPageView | null> {
  const rows = (
    options.includeDeleted
      ? await tx`
        SELECT id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_title,
      meta_description, canonical_url, locale, page_type, parent_page_id,
      menu_order, published_at, scheduled_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by, version
        FROM awcms_blog_pages
        WHERE tenant_id = ${tenantId} AND id = ${pageId}
      `
      : await tx`
        SELECT id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_title,
      meta_description, canonical_url, locale, page_type, parent_page_id,
      menu_order, published_at, scheduled_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by, version
        FROM awcms_blog_pages
        WHERE tenant_id = ${tenantId} AND id = ${pageId} AND deleted_at IS NULL
      `
  ) as BlogPageRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

export type ListBlogPagesFilter = {
  status?: BlogContentStatus;
  pageType?: PageType;
  limit?: number;
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/** `LIMIT` bounded (default 20, max 100), newest-updated first — same convention as `listBlogPosts`. */
export async function listBlogPages(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListBlogPagesFilter = {}
): Promise<BlogPageSummary[]> {
  const limit = Math.min(
    Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1),
    MAX_LIST_LIMIT
  );

  const rows = (await tx`
    SELECT id, tenant_id, title, slug, status, visibility, page_type, parent_page_id, menu_order, locale, updated_at
    FROM awcms_blog_pages
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.pageType ?? null}::text IS NULL OR page_type = ${filter.pageType ?? null})
    ORDER BY menu_order ASC, updated_at DESC
    LIMIT ${limit}
  `) as BlogPageSummaryRow[];

  return rows.map(toBlogPageSummary);
}

export type ListBlogPagesForAdminFilter = {
  search?: string;
  status?: BlogContentStatus;
  pageType?: PageType;
  page?: number;
  pageSize?: number;
};

export type ListBlogPagesForAdminResult = {
  items: BlogPageSummary[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_ADMIN_LIST_PAGE_SIZE = 20;
const MAX_ADMIN_LIST_PAGE_SIZE = 100;

/**
 * Admin page list (Issue #543 §Page List) — additive, mirrors
 * `blog-post-directory.ts`'s `listBlogPostsForAdmin` (`ILIKE` title search,
 * page-number pagination with a total count) minus the term filter (pages
 * have no taxonomy relation).
 */
export async function listBlogPagesForAdmin(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListBlogPagesForAdminFilter = {}
): Promise<ListBlogPagesForAdminResult> {
  const pageSize = boundedPageSize(
    filter.pageSize,
    DEFAULT_ADMIN_LIST_PAGE_SIZE,
    MAX_ADMIN_LIST_PAGE_SIZE
  );
  const page = boundedPageNumber(filter.page);
  const offset = (page - 1) * pageSize;
  const search = filter.search?.trim() || null;
  const status = filter.status ?? null;
  const pageType = filter.pageType ?? null;

  const rows = (await tx`
    SELECT id, tenant_id, title, slug, status, visibility, page_type, parent_page_id, menu_order, locale, updated_at
    FROM awcms_blog_pages
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${status}::text IS NULL OR status = ${status})
      AND (${pageType}::text IS NULL OR page_type = ${pageType})
      AND (${search}::text IS NULL OR title ILIKE '%' || ${search} || '%')
    ORDER BY updated_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `) as BlogPageSummaryRow[];

  const countRows = (await tx`
    SELECT count(*)::int AS count
    FROM awcms_blog_pages
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${status}::text IS NULL OR status = ${status})
      AND (${pageType}::text IS NULL OR page_type = ${pageType})
      AND (${search}::text IS NULL OR title ILIKE '%' || ${search} || '%')
  `) as { count: number }[];

  return {
    items: rows.map(toBlogPageSummary),
    total: countRows[0]?.count ?? 0,
    page,
    pageSize
  };
}

/** Partial update; `version` bumped on every successful write (same monotonic-counter convention as `updateBlogPost`, no optimistic-concurrency check yet). */
export async function updateBlogPage(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: UpdateBlogPageInput
): Promise<BlogPageView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_pages
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
        seo_title = CASE WHEN ${input.seoTitle === undefined} THEN seo_title ELSE ${input.seoTitle ?? null} END,
        meta_description = CASE
          WHEN ${input.metaDescription === undefined} THEN meta_description
          ELSE ${input.metaDescription ?? null}
        END,
        canonical_url = CASE
          WHEN ${input.canonicalUrl === undefined} THEN canonical_url
          ELSE ${input.canonicalUrl ?? null}
        END,
        page_type = COALESCE(${input.pageType ?? null}, page_type),
        parent_page_id = CASE
          WHEN ${input.parentPageId === undefined} THEN parent_page_id
          ELSE ${input.parentPageId ?? null}
        END,
        menu_order = COALESCE(${input.menuOrder ?? null}, menu_order),
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, author_tenant_user_id, title, slug, excerpt, content_json,
      content_text, status, visibility, featured_media_id, seo_title,
      meta_description, canonical_url, locale, page_type, parent_page_id,
      menu_order, published_at, scheduled_at, created_at, updated_at,
      deleted_at, deleted_by, delete_reason, restored_at, restored_by, version
  `) as BlogPageRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function softDeleteBlogPage(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_pages
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}
