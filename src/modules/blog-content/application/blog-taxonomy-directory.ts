import type { TaxonomyType } from "../domain/taxonomy-policy";
import type {
  CreateBlogTermInput,
  UpdateBlogTermInput
} from "../domain/blog-term-validation";

/**
 * Read/write query module for `awcms_blog_terms` and
 * `awcms_blog_post_terms` (Issue #537 scaffolded this as a read-only
 * placeholder; Issue #539 fills in term CRUD and post-term relation
 * management) — same "directory holds both reads and writes" convention as
 * `blog-post-directory.ts`/`blog-page-directory.ts`.
 */
export type BlogTermView = {
  id: string;
  tenantId: string;
  taxonomyType: TaxonomyType;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

type BlogTermRow = {
  id: string;
  tenant_id: string;
  taxonomy_type: TaxonomyType;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

function toView(row: BlogTermRow): BlogTermView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taxonomyType: row.taxonomy_type,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason
  };
}

export async function createBlogTerm(
  tx: Bun.SQL,
  tenantId: string,
  input: CreateBlogTermInput
): Promise<BlogTermView> {
  const rows = (await tx`
    INSERT INTO awcms_blog_terms
      (tenant_id, taxonomy_type, parent_id, name, slug, description)
    VALUES (
      ${tenantId}, ${input.taxonomyType}, ${input.parentId}, ${input.name},
      ${input.slug}, ${input.description}
    )
    RETURNING id, tenant_id, taxonomy_type, parent_id, name, slug, description,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogTermRow[];

  return toView(rows[0]!);
}

export async function fetchBlogTermById(
  tx: Bun.SQL,
  tenantId: string,
  termId: string
): Promise<BlogTermView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, taxonomy_type, parent_id, name, slug, description,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_terms
    WHERE tenant_id = ${tenantId} AND id = ${termId} AND deleted_at IS NULL
  `) as BlogTermRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

export type ListBlogTermsFilter = {
  taxonomyType?: TaxonomyType;
};

/** `LIMIT 100`, name ascending — terms are low-cardinality config, same bounded-list convention as email templates. */
export async function listBlogTerms(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListBlogTermsFilter = {}
): Promise<BlogTermView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, taxonomy_type, parent_id, name, slug, description,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_terms
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${filter.taxonomyType ?? null}::text IS NULL OR taxonomy_type = ${filter.taxonomyType ?? null})
    ORDER BY name ASC
    LIMIT 100
  `) as BlogTermRow[];

  return rows.map(toView);
}

/** Thin convenience wrapper kept for the pre-#539 call shape (Issue #537). */
export async function fetchBlogTermsByTaxonomyType(
  tx: Bun.SQL,
  tenantId: string,
  taxonomyType: TaxonomyType
): Promise<BlogTermView[]> {
  return listBlogTerms(tx, tenantId, { taxonomyType });
}

export async function updateBlogTerm(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: UpdateBlogTermInput
): Promise<BlogTermView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_terms
    SET taxonomy_type = COALESCE(${input.taxonomyType ?? null}, taxonomy_type),
        parent_id = CASE
          WHEN ${input.parentId === undefined} THEN parent_id
          ELSE ${input.parentId ?? null}
        END,
        name = COALESCE(${input.name ?? null}, name),
        slug = COALESCE(${input.slug ?? null}, slug),
        description = CASE
          WHEN ${input.description === undefined} THEN description
          ELSE ${input.description ?? null}
        END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, taxonomy_type, parent_id, name, slug, description,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogTermRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function softDeleteBlogTerm(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_terms
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

/**
 * Post <-> term assignment (doc issue #539 §Scope: "Post-term relation
 * handling"). No dedicated REST route is listed for this in the issue —
 * it is embedded in the blog post create/update payload instead
 * (`termIds?: string[]`, see `blog-post-validation.ts`/
 * `blog-post-directory.ts`). Full replace semantics (delete all existing
 * assignments for the post, then insert the given set) rather than a diff
 * — simplest correct behavior for a small per-post tag/category list, same
 * "PATCH replaces the whole sub-resource" precedent
 * `module_management`'s settings merge docs contrast against (this is
 * the "replace", not "merge", side of that distinction, since the caller
 * always sends the complete desired term list).
 */
export async function syncPostTermAssignments(
  tx: Bun.SQL,
  tenantId: string,
  postId: string,
  termIds: readonly string[]
): Promise<void> {
  await tx`
    DELETE FROM awcms_blog_post_terms
    WHERE tenant_id = ${tenantId} AND post_id = ${postId}
  `;

  for (const termId of termIds) {
    await tx`
      INSERT INTO awcms_blog_post_terms (tenant_id, post_id, term_id)
      VALUES (${tenantId}, ${postId}, ${termId})
    `;
  }
}

export async function fetchPostTermIds(
  tx: Bun.SQL,
  tenantId: string,
  postId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT term_id FROM awcms_blog_post_terms
    WHERE tenant_id = ${tenantId} AND post_id = ${postId}
  `) as { term_id: string }[];

  return rows.map((row) => row.term_id);
}

/** Used before `syncPostTermAssignments` to reject a `termIds` list containing an id that doesn't exist (or belongs to another tenant, or is soft-deleted) — a bare FK violation would otherwise surface as a raw 500. */
export async function countExistingTerms(
  tx: Bun.SQL,
  tenantId: string,
  termIds: readonly string[]
): Promise<number> {
  if (termIds.length === 0) {
    return 0;
  }

  const rows = (await tx`
    SELECT count(*)::int AS count FROM awcms_blog_terms
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND id = ANY(${tx.array([...termIds], "uuid")})
  `) as { count: number }[];

  return rows[0]?.count ?? 0;
}
