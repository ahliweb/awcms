import { log } from "../../../lib/logging/logger";
import type { PortableTextDocument } from "../domain/portable-text";

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
  /** ADR-0100 — the body as it stood at this revision. `[]` on a revision written before the cutover; the restore path converts from `contentJson.blocks` in that case. */
  bodyPortableText: PortableTextDocument;
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
  /** ADR-0100 — the body as it stood at this revision. `[]` on a revision written before the cutover; the restore path converts from `contentJson.blocks` in that case. */
  bodyPortableText: PortableTextDocument;
  excerpt: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
};

type BlogRevisionDetailRow = BlogRevisionSummaryRow & {
  content_json: Record<string, unknown>;
  content_text: string;
  body_portable_text: PortableTextDocument;
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
    bodyPortableText: row.body_portable_text,
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
       content_json, content_text, body_portable_text, excerpt, seo_title,
       meta_description,
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
      ${snapshot.bodyPortableText}::jsonb,
      ${snapshot.excerpt}, ${snapshot.seoTitle}, ${snapshot.metaDescription},
      ${snapshot.canonicalUrl}, ${snapshot.status}, ${changeNote},
      ${createdByTenantUserId}
    )
    RETURNING id, tenant_id, resource_type, resource_id, revision_number, title,
      content_json, content_text, body_portable_text, excerpt, seo_title,
      meta_description,
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

export type BlogRevisionBatchEntry = {
  resourceId: string;
  createdByTenantUserId: string;
  snapshot: BlogRevisionSnapshot;
  changeNote?: string | null;
};

/**
 * The same write as {@link createBlogRevision}, for a WHOLE BATCH of
 * DISTINCT resources — one statement, not one per resource
 * (`blog-scheduled-publish.ts`'s sweep). Every entry must name a
 * different `resourceId`: this batch computes each row's `revision_number`
 * against what is already on disk, not against sibling rows in the same
 * call, so two entries sharing a `resourceId` would both compute the SAME
 * next number and collide on `awcms_blog_revisions_unique` — the scheduled
 * publish sweep's `due` selection can never produce that (each post appears
 * at most once per run), and no other caller exists yet, so this is
 * documented as a precondition rather than defended in code.
 *
 * `jsonb_to_recordset`, not `unnest` — same reason `recordAuditEvents`
 * gives: this table has several nullable text columns plus two `jsonb`
 * ones, and the `unnest`-per-column idiom cannot carry a NULL without a
 * sentinel per nullable column. One `jsonb` parameter sidesteps all of it.
 */
export async function createBlogRevisions(
  tx: Bun.SQL,
  tenantId: string,
  resourceType: RevisionResourceType,
  entries: readonly BlogRevisionBatchEntry[],
  correlationId?: string
): Promise<BlogRevisionDetail[]> {
  if (entries.length === 0) {
    return [];
  }

  const rows = entries.map((entry) => ({
    resource_id: entry.resourceId,
    title: entry.snapshot.title,
    content_json: entry.snapshot.contentJson,
    content_text: entry.snapshot.contentText,
    body_portable_text: entry.snapshot.bodyPortableText,
    excerpt: entry.snapshot.excerpt,
    seo_title: entry.snapshot.seoTitle,
    meta_description: entry.snapshot.metaDescription,
    canonical_url: entry.snapshot.canonicalUrl,
    status: entry.snapshot.status,
    change_note: entry.changeNote ?? null,
    created_by_tenant_user_id: entry.createdByTenantUserId
  }));

  const inserted = (await tx`
    INSERT INTO awcms_blog_revisions
      (tenant_id, resource_type, resource_id, revision_number, title,
       content_json, content_text, body_portable_text, excerpt, seo_title,
       meta_description,
       canonical_url, status, change_note, created_by_tenant_user_id)
    SELECT ${tenantId}, ${resourceType}, entry.resource_id,
      COALESCE(
        (SELECT MAX(revision_number) FROM awcms_blog_revisions r
          WHERE r.tenant_id = ${tenantId} AND r.resource_type = ${resourceType}
            AND r.resource_id = entry.resource_id),
        0
      ) + 1,
      entry.title, entry.content_json, entry.content_text,
      entry.body_portable_text, entry.excerpt, entry.seo_title,
      entry.meta_description, entry.canonical_url, entry.status,
      entry.change_note, entry.created_by_tenant_user_id
    FROM jsonb_to_recordset(${rows}::jsonb) AS entry (
      resource_id uuid,
      title text,
      content_json jsonb,
      content_text text,
      body_portable_text jsonb,
      excerpt text,
      seo_title text,
      meta_description text,
      canonical_url text,
      status text,
      change_note text,
      created_by_tenant_user_id uuid
    )
    RETURNING id, tenant_id, resource_type, resource_id, revision_number, title,
      content_json, content_text, body_portable_text, excerpt, seo_title,
      meta_description,
      canonical_url, status, change_note, created_by_tenant_user_id, created_at
  `) as BlogRevisionDetailRow[];

  const revisions = inserted.map(toDetail);

  for (const revision of revisions) {
    log("info", "blog-content.revision.created", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      resourceType,
      resourceId: revision.resourceId,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber
    });
  }

  return revisions;
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
      content_json, content_text, body_portable_text, excerpt, seo_title,
      meta_description,
      canonical_url, status, change_note, created_by_tenant_user_id, created_at
    FROM awcms_blog_revisions
    WHERE tenant_id = ${tenantId} AND resource_type = ${resourceType}
      AND resource_id = ${resourceId} AND id = ${revisionId}
  `) as BlogRevisionDetailRow[];

  const row = rows[0];
  return row ? toDetail(row) : null;
}
