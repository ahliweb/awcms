import {
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type { BlogContentStatus } from "../domain/post-status";

/**
 * PostgreSQL full-text search across `awcms_blog_posts` and
 * `awcms_blog_pages` (doc issue #539 §Scope: "PostgreSQL full-text
 * search for posts and pages"). Both tables' `search_vector` is a
 * `GENERATED ALWAYS ... STORED` column (migration 028) — no trigger or
 * application code populates it, so this file only ever *reads*
 * `search_vector`, never writes it.
 *
 * Two entry points, matching the issue's split: `searchBlogContentAdmin`
 * (tenant-scoped, all statuses, gated by `blog_content.search.read`) and
 * `searchPublicBlogContent` (the "public-safe search helper" — doc issue
 * #539 explicitly calls this a *helper*, not a route: no
 * `GET /api/v1/blog/search`-equivalent public endpoint exists yet, public
 * route rendering is Issue #540's scope). Both share the same query shape
 * and keyset-cursor pagination (`_shared/keyset-pagination.ts`, same
 * `(created_at, id)` convention `GET /api/v1/logs/audit` established) —
 * only the WHERE predicate differs.
 */
export type BlogSearchResourceType = "post" | "page";

export type BlogSearchResultItem = {
  resourceType: BlogSearchResourceType;
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  status: string;
  visibility: string;
  locale: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type BlogSearchRow = {
  resource_type: BlogSearchResourceType;
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  status: string;
  visibility: string;
  locale: string;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /**
   * Full-precision (microsecond) UTC text form of `created_at`, for the
   * keyset cursor ONLY — never the display value (Issue #158; see
   * `_shared/keyset-pagination.ts`'s module doc comment for why a JS `Date`
   * would silently skip rows sharing a millisecond).
   */
  created_at_cursor: string;
};

function toResultItem(row: BlogSearchRow): BlogSearchResultItem {
  return {
    resourceType: row.resource_type,
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    status: row.status,
    visibility: row.visibility,
    locale: row.locale,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type BlogSearchResult = {
  items: BlogSearchResultItem[];
  nextCursor: string | null;
};

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

export type SearchBlogContentAdminFilter = {
  query: string;
  resourceType?: BlogSearchResourceType;
  status?: BlogContentStatus;
  cursor?: KeysetCursor;
  limit?: number;
};

/** `GET /api/v1/blog/search` (Issue #539) — gated by `blog_content.search.read`, may return content of any status per doc issue #539: "Admin search may include draft/review/scheduled/published/archived content according to permission." */
export async function searchBlogContentAdmin(
  tx: Bun.SQL,
  tenantId: string,
  filter: SearchBlogContentAdminFilter
): Promise<BlogSearchResult> {
  const limit = Math.min(
    Math.max(filter.limit ?? DEFAULT_SEARCH_LIMIT, 1),
    MAX_SEARCH_LIMIT
  );
  const cursorCreatedAt = filter.cursor?.createdAt ?? null;
  const cursorId = filter.cursor?.id ?? null;
  const resourceTypeFilter = filter.resourceType ?? null;
  const statusFilter = filter.status ?? null;

  const rows = (await tx`
    SELECT * FROM (
      SELECT 'post' AS resource_type, id, title, slug, excerpt, status, visibility,
             locale, published_at, created_at, updated_at,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor
      FROM awcms_blog_posts
      WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        AND search_vector @@ websearch_to_tsquery('simple', ${filter.query})
        AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
      UNION ALL
      SELECT 'page' AS resource_type, id, title, slug, excerpt, status, visibility,
             locale, published_at, created_at, updated_at,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor
      FROM awcms_blog_pages
      WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        AND search_vector @@ websearch_to_tsquery('simple', ${filter.query})
        AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
    ) combined
    WHERE (${resourceTypeFilter}::text IS NULL OR resource_type = ${resourceTypeFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as BlogSearchRow[];

  const items = rows.map(toResultItem);
  const nextCursor =
    rows.length === limit
      ? encodeKeysetCursor(
          rows[rows.length - 1]!.created_at_cursor,
          rows[rows.length - 1]!.id
        )
      : null;

  return { items, nextCursor };
}

export type SearchPublicBlogContentFilter = {
  query: string;
  resourceType?: BlogSearchResourceType;
  cursor?: KeysetCursor;
  limit?: number;
};

/**
 * Public-safe search helper (doc issue #539 §Public Visibility Predicate)
 * — `status = 'published' AND visibility = 'public' AND deleted_at IS NULL
 * AND published_at IS NOT NULL AND published_at <= now()`, applied to both
 * posts and pages. Not wired to any route in this issue (public route
 * rendering is Issue #540's scope, out of scope here) — exported so #540
 * calls this directly instead of re-deriving the predicate.
 */
export async function searchPublicBlogContent(
  tx: Bun.SQL,
  tenantId: string,
  filter: SearchPublicBlogContentFilter
): Promise<BlogSearchResult> {
  const limit = Math.min(
    Math.max(filter.limit ?? DEFAULT_SEARCH_LIMIT, 1),
    MAX_SEARCH_LIMIT
  );
  const cursorCreatedAt = filter.cursor?.createdAt ?? null;
  const cursorId = filter.cursor?.id ?? null;
  const resourceTypeFilter = filter.resourceType ?? null;

  const rows = (await tx`
    SELECT * FROM (
      SELECT 'post' AS resource_type, id, title, slug, excerpt, status, visibility,
             locale, published_at, created_at, updated_at,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor
      FROM awcms_blog_posts
      WHERE tenant_id = ${tenantId}
        AND status = 'published' AND visibility = 'public'
        AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()
        AND search_vector @@ websearch_to_tsquery('simple', ${filter.query})
      UNION ALL
      SELECT 'page' AS resource_type, id, title, slug, excerpt, status, visibility,
             locale, published_at, created_at, updated_at,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at_cursor
      FROM awcms_blog_pages
      WHERE tenant_id = ${tenantId}
        AND status = 'published' AND visibility = 'public'
        AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()
        AND search_vector @@ websearch_to_tsquery('simple', ${filter.query})
    ) combined
    WHERE (${resourceTypeFilter}::text IS NULL OR resource_type = ${resourceTypeFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as BlogSearchRow[];

  const items = rows.map(toResultItem);
  const nextCursor =
    rows.length === limit
      ? encodeKeysetCursor(
          rows[rows.length - 1]!.created_at_cursor,
          rows[rows.length - 1]!.id
        )
      : null;

  return { items, nextCursor };
}
