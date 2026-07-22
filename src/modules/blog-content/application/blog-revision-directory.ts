import { log } from "../../../lib/logging/logger";

/**
 * Read/write query module for `awcms_blog_revisions` (Issue #541).
 * Append-only: `createBlogRevision` only ever `INSERT`s, there is no
 * update/delete function in this file — matches the module README's
 * "restore revisi" note (§Skema data, point 5) and the same convention
 * `awcms_workflow_decisions`/`awcms_audit_events` already use.
 */
export type RevisionResourceType = "post" | "page";

export type BlogRevisionSnapshot = {
  title: string;
  contentJson: Record<string, unknown>;
  contentText: string;
  excerpt: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  status: string;
};

export type BlogRevisionSummary = {
  id: string;
  tenantId: string;
  resourceType: RevisionResourceType;
  resourceId: string;
  revisionNumber: number;
  title: string;
  status: string;
  changeNote: string | null;
  createdByTenantUserId: string;
  createdAt: Date;
};

type BlogRevisionSummaryRow = {
  id: string;
  tenant_id: string;
  resource_type: RevisionResourceType;
  resource_id: string;
  revision_number: number;
  title: string;
  status: string;
  change_note: string | null;
  created_by_tenant_user_id: string;
  created_at: Date;
};

function toSummary(row: BlogRevisionSummaryRow): BlogRevisionSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    revisionNumber: row.revision_number,
    title: row.title,
    status: row.status,
    changeNote: row.change_note,
    createdByTenantUserId: row.created_by_tenant_user_id,
    createdAt: row.created_at
  };
}

export type BlogRevisionDetail = BlogRevisionSummary & {
  contentJson: Record<string, unknown>;
  contentText: string;
  excerpt: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
};

type BlogRevisionDetailRow = BlogRevisionSummaryRow & {
  content_json: Record<string, unknown>;
  content_text: string;
  excerpt: string | null;
  seo_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
};

function toDetail(row: BlogRevisionDetailRow): BlogRevisionDetail {
  return {
    ...toSummary(row),
    contentJson: row.content_json,
    contentText: row.content_text,
    excerpt: row.excerpt,
    seoTitle: row.seo_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url
  };
}

/**
 * Inserts the next revision for a resource — `revision_number` is
 * `MAX(revision_number) + 1` scoped to `(tenant_id, resource_type,
 * resource_id)`, computed in the same statement so two concurrent writers
 * can't compute the same number (the table's unique constraint on that
 * triple is the actual guarantee; this subquery just avoids relying on a
 * retry loop for the common case).
 */
export async function createBlogRevision(
  tx: Bun.SQL,
  tenantId: string,
  resourceType: RevisionResourceType,
  resourceId: string,
  createdByTenantUserId: string,
  snapshot: BlogRevisionSnapshot,
  changeNote: string | null = null,
  correlationId?: string
): Promise<BlogRevisionDetail> {
  const rows = (await tx`
    INSERT INTO awcms_blog_revisions
      (tenant_id, resource_type, resource_id, revision_number, title,
       content_json, content_text, excerpt, seo_title, meta_description,
       canonical_url, status, change_note, created_by_tenant_user_id)
    VALUES (
      ${tenantId}, ${resourceType}, ${resourceId},
      COALESCE(
        (SELECT MAX(revision_number) FROM awcms_blog_revisions
          WHERE tenant_id = ${tenantId} AND resource_type = ${resourceType}
            AND resource_id = ${resourceId}),
        0
      ) + 1,
      ${snapshot.title}, ${snapshot.contentJson}, ${snapshot.contentText},
      ${snapshot.excerpt}, ${snapshot.seoTitle}, ${snapshot.metaDescription},
      ${snapshot.canonicalUrl}, ${snapshot.status}, ${changeNote},
      ${createdByTenantUserId}
    )
    RETURNING id, tenant_id, resource_type, resource_id, revision_number, title,
      content_json, content_text, excerpt, seo_title, meta_description,
      canonical_url, status, change_note, created_by_tenant_user_id, created_at
  `) as BlogRevisionDetailRow[];

  const revision = toDetail(rows[0]!);

  log("info", "blog-content.revision.created", {
    correlationId,
    tenantId,
    moduleKey: "blog_content",
    resourceType,
    resourceId,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber
  });

  return revision;
}

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/** Newest revision first — same bounded-list convention as `listBlogPosts` (no cursor pagination yet). */
export async function listBlogRevisions(
  tx: Bun.SQL,
  tenantId: string,
  resourceType: RevisionResourceType,
  resourceId: string,
  options: { limit?: number } = {}
): Promise<BlogRevisionSummary[]> {
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_LIST_LIMIT, 1),
    MAX_LIST_LIMIT
  );

  const rows = (await tx`
    SELECT id, tenant_id, resource_type, resource_id, revision_number, title,
      status, change_note, created_by_tenant_user_id, created_at
    FROM awcms_blog_revisions
    WHERE tenant_id = ${tenantId} AND resource_type = ${resourceType}
      AND resource_id = ${resourceId}
    ORDER BY revision_number DESC
    LIMIT ${limit}
  `) as BlogRevisionSummaryRow[];

  return rows.map(toSummary);
}

/** Scoped to `resourceId` as well as `id` — a revision id from a different post/page must not be readable via this resource's URL. */
export async function fetchBlogRevisionById(
  tx: Bun.SQL,
  tenantId: string,
  resourceType: RevisionResourceType,
  resourceId: string,
  revisionId: string
): Promise<BlogRevisionDetail | null> {
  const rows = (await tx`
    SELECT id, tenant_id, resource_type, resource_id, revision_number, title,
      content_json, content_text, excerpt, seo_title, meta_description,
      canonical_url, status, change_note, created_by_tenant_user_id, created_at
    FROM awcms_blog_revisions
    WHERE tenant_id = ${tenantId} AND resource_type = ${resourceType}
      AND resource_id = ${resourceId} AND id = ${revisionId}
  `) as BlogRevisionDetailRow[];

  const row = rows[0];
  return row ? toDetail(row) : null;
}
