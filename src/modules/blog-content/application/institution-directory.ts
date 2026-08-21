import type {
  CreateInstitutionInput,
  InstitutionBranch,
  UpdateInstitutionInput
} from "../domain/institution-validation";

/**
 * Read/write query module for `awcms_blog_institutions` and
 * `awcms_blog_post_institutions` (sql/131, PRD LenteraKalteng §12.2) — same
 * "directory holds both reads and writes" convention as
 * `blog-taxonomy-directory.ts`, whose shape this file deliberately mirrors so
 * the two classification surfaces read alike.
 *
 * Every statement carries an explicit `tenant_id = ${tenantId}` predicate even
 * though both tables are `FORCE ROW LEVEL SECURITY`. That belt-and-braces is
 * the repo convention, and it is what keeps these functions correct when
 * called from a context that set the GUC for a different tenant.
 */

export type InstitutionView = {
  id: string;
  tenantId: string;
  branch: InstitutionBranch;
  name: string;
  slug: string;
  regionCode: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

type InstitutionRow = {
  id: string;
  tenant_id: string;
  branch: InstitutionBranch;
  name: string;
  slug: string;
  region_code: string | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

function toView(row: InstitutionRow): InstitutionView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branch: row.branch,
    name: row.name,
    slug: row.slug,
    regionCode: row.region_code,
    description: row.description,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason
  };
}

export async function createInstitution(
  tx: Bun.SQL,
  tenantId: string,
  input: CreateInstitutionInput
): Promise<InstitutionView> {
  const rows = (await tx`
    INSERT INTO awcms_blog_institutions
      (tenant_id, branch, name, slug, region_code, description, seo_title,
       seo_description)
    VALUES (
      ${tenantId}, ${input.branch}, ${input.name}, ${input.slug},
      ${input.regionCode}, ${input.description}, ${input.seoTitle},
      ${input.seoDescription}
    )
    RETURNING id, tenant_id, branch, name, slug, region_code, description,
      seo_title, seo_description, created_at, updated_at, deleted_at,
      deleted_by, delete_reason
  `) as InstitutionRow[];

  return toView(rows[0]!);
}

export async function fetchInstitutionById(
  tx: Bun.SQL,
  tenantId: string,
  institutionId: string
): Promise<InstitutionView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, branch, name, slug, region_code, description,
      seo_title, seo_description, created_at, updated_at, deleted_at,
      deleted_by, delete_reason
    FROM awcms_blog_institutions
    WHERE tenant_id = ${tenantId} AND id = ${institutionId}
      AND deleted_at IS NULL
  `) as InstitutionRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

/**
 * Slug lookup for the public landing page (PRD §12.2,
 * `/legislatif/{institution-slug}/`). Separate from the id lookup because the
 * public route only ever holds a slug, and resolving it through a list would
 * make every landing page render an unbounded read.
 */
export async function fetchInstitutionBySlug(
  tx: Bun.SQL,
  tenantId: string,
  slug: string
): Promise<InstitutionView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, branch, name, slug, region_code, description,
      seo_title, seo_description, created_at, updated_at, deleted_at,
      deleted_by, delete_reason
    FROM awcms_blog_institutions
    WHERE tenant_id = ${tenantId} AND slug = ${slug} AND deleted_at IS NULL
  `) as InstitutionRow[];

  const row = rows[0];
  return row ? toView(row) : null;
}

export type ListInstitutionsFilter = {
  branch?: InstitutionBranch;
  /**
   * `false` (the default) lists live rows; `true` lists the soft-deleted ones.
   *
   * Deliberately a SWITCH rather than an "include deleted" widening: every
   * caller wants one set or the other, and a mixed list would make the admin
   * table's Delete/Restore actions depend on a per-row state the operator has
   * to read off a column. It also keeps the restore surface reachable — an
   * institution nobody can list is an institution nobody can restore, which is
   * how `blog_content.institutions.restore` would have become a permission
   * with no screen.
   */
  deleted?: boolean;
};

/**
 * `LIMIT 200`, name ascending.
 *
 * Bounded by design, same reasoning as `listBlogTerms`' `LIMIT 100`: this is
 * low-cardinality editorial configuration, not content. The ceiling is 200
 * rather than 100 because the tenant this was built for carries thirty
 * institutions on day one (fifteen legislative + fifteen executive, PRD
 * §8.3/§8.4) and a province with more regencies must not silently lose rows
 * off the end of its own mega menu. A tenant that genuinely outgrows 200 needs
 * pagination and a different menu design, not a bigger constant — and it will
 * find out by reading this comment rather than by a menu that quietly stops.
 */
export async function listInstitutions(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListInstitutionsFilter = {}
): Promise<InstitutionView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, branch, name, slug, region_code, description,
      seo_title, seo_description, created_at, updated_at, deleted_at,
      deleted_by, delete_reason
    FROM awcms_blog_institutions
    WHERE tenant_id = ${tenantId}
      AND (
        CASE WHEN ${filter.deleted === true}
          THEN deleted_at IS NOT NULL
          ELSE deleted_at IS NULL
        END
      )
      AND (${filter.branch ?? null}::text IS NULL OR branch = ${filter.branch ?? null})
    ORDER BY name ASC
    LIMIT 200
  `) as InstitutionRow[];

  return rows.map(toView);
}

export async function updateInstitution(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: UpdateInstitutionInput
): Promise<InstitutionView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_institutions
    SET branch = COALESCE(${input.branch ?? null}, branch),
        name = COALESCE(${input.name ?? null}, name),
        slug = COALESCE(${input.slug ?? null}, slug),
        region_code = CASE
          WHEN ${input.regionCode === undefined} THEN region_code
          ELSE ${input.regionCode ?? null}
        END,
        description = CASE
          WHEN ${input.description === undefined} THEN description
          ELSE ${input.description ?? null}
        END,
        seo_title = CASE
          WHEN ${input.seoTitle === undefined} THEN seo_title
          ELSE ${input.seoTitle ?? null}
        END,
        seo_description = CASE
          WHEN ${input.seoDescription === undefined} THEN seo_description
          ELSE ${input.seoDescription ?? null}
        END,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, branch, name, slug, region_code, description,
      seo_title, seo_description, created_at, updated_at, deleted_at,
      deleted_by, delete_reason
  `) as InstitutionRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export async function softDeleteInstitution(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_institutions
    SET deleted_at = now(), deleted_by = ${actorTenantUserId},
        delete_reason = ${reason}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

/**
 * Restore is NOT a plain `deleted_at = NULL` update, because the partial
 * unique index released the slug when the row was deleted: another institution
 * may have taken it in the meantime. The statement therefore refuses when a
 * live row already holds the slug, and the caller turns that into a 409 rather
 * than letting the index raise a raw constraint violation.
 */
export async function restoreInstitution(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<{ restored: boolean; slugTaken: boolean }> {
  const rows = (await tx`
    UPDATE awcms_blog_institutions AS target
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        updated_at = now()
    WHERE target.tenant_id = ${tenantId} AND target.id = ${id}
      AND target.deleted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM awcms_blog_institutions AS live
        WHERE live.tenant_id = target.tenant_id
          AND live.slug = target.slug
          AND live.deleted_at IS NULL
      )
    RETURNING target.id
  `) as { id: string }[];

  if (rows.length > 0) {
    return { restored: true, slugTaken: false };
  }

  // Distinguish "already live / never existed" from "slug taken by a live
  // row": both leave the UPDATE matching nothing, and answering 404 for the
  // second would send an operator hunting for a row that is right there.
  const conflicting = (await tx`
    SELECT 1 AS present
    FROM awcms_blog_institutions AS target
    JOIN awcms_blog_institutions AS live
      ON live.tenant_id = target.tenant_id
     AND live.slug = target.slug
     AND live.deleted_at IS NULL
    WHERE target.tenant_id = ${tenantId} AND target.id = ${id}
      AND target.deleted_at IS NOT NULL
    LIMIT 1
  `) as { present: number }[];

  return { restored: false, slugTaken: conflicting.length > 0 };
}

/**
 * Hard delete of a soft-deleted institution, together with the join rows that
 * point at it.
 *
 * The join DELETE is load-bearing rather than tidy, the same way it is in
 * `purgeBlogPost`: `awcms_blog_post_institutions.institution_id` is a real
 * foreign key, so leaving those rows behind does not orphan them — it makes
 * this DELETE fail outright.
 *
 * Refuses a LIVE institution. Purging one would silently strip the
 * classification from every article that names it, and an operator who meant
 * to soft-delete would have no way back. `deleted_at IS NOT NULL` in the
 * predicate is what forces delete-then-purge, matching the two-step posts and
 * pages already require (`canPurgePost`/`canPurgePage`).
 *
 * Returns how many article links went with it, so the audit event can record
 * the blast radius rather than just the fact.
 */
export async function purgeInstitution(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<{ purged: boolean; articleLinksRemoved: number }> {
  const target = (await tx`
    SELECT id FROM awcms_blog_institutions
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
  `) as { id: string }[];

  if (target.length === 0) {
    return { purged: false, articleLinksRemoved: 0 };
  }

  const removed = (await tx`
    DELETE FROM awcms_blog_post_institutions
    WHERE tenant_id = ${tenantId} AND institution_id = ${id}
    RETURNING id
  `) as { id: string }[];

  const rows = await tx`
    DELETE FROM awcms_blog_institutions
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
    RETURNING id
  `;

  return { purged: rows.length > 0, articleLinksRemoved: removed.length };
}

/**
 * Post <-> institution assignment. Full-replace semantics and an embedded
 * `institutionIds?: string[]` on the post payload, exactly like
 * `syncPostTermAssignments` — an article names its institutions the same way
 * it names its terms, and giving the two relations different shapes would make
 * the post endpoint's contract arbitrary.
 */
export async function syncPostInstitutionAssignments(
  tx: Bun.SQL,
  tenantId: string,
  postId: string,
  institutionIds: readonly string[]
): Promise<void> {
  await tx`
    DELETE FROM awcms_blog_post_institutions
    WHERE tenant_id = ${tenantId} AND post_id = ${postId}
  `;

  for (const institutionId of institutionIds) {
    await tx`
      INSERT INTO awcms_blog_post_institutions
        (tenant_id, post_id, institution_id)
      VALUES (${tenantId}, ${postId}, ${institutionId})
    `;
  }
}

export async function fetchPostInstitutionIds(
  tx: Bun.SQL,
  tenantId: string,
  postId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT institution_id FROM awcms_blog_post_institutions
    WHERE tenant_id = ${tenantId} AND post_id = ${postId}
  `) as { institution_id: string }[];

  return rows.map((row) => row.institution_id);
}

/**
 * The same assignments for a WHOLE page of posts — one query, not one per post.
 * The institution twin of `fetchPostTermIdsForPosts`, and the same reasoning:
 * see that function's note on why the build feed carries these at all.
 *
 * `tx.array(...)` rather than interpolating the array, for the reason recorded
 * on `countExistingInstitutions` below.
 */
export async function fetchPostInstitutionIdsForPosts(
  tx: Bun.SQL,
  tenantId: string,
  postIds: readonly string[]
): Promise<Map<string, string[]>> {
  const byPost = new Map<string, string[]>();

  if (postIds.length === 0) {
    return byPost;
  }

  const rows = (await tx`
    SELECT post_id, institution_id FROM awcms_blog_post_institutions
    WHERE tenant_id = ${tenantId}
      AND post_id = ANY(${tx.array([...postIds], "uuid")})
  `) as { post_id: string; institution_id: string }[];

  for (const row of rows) {
    const existing = byPost.get(row.post_id);

    if (existing) {
      existing.push(row.institution_id);
    } else {
      byPost.set(row.post_id, [row.institution_id]);
    }
  }

  return byPost;
}

/**
 * Used before `syncPostInstitutionAssignments` to reject an `institutionIds`
 * list naming an id that does not exist, belongs to another tenant, or is
 * soft-deleted — a bare FK violation would otherwise surface as a raw 500.
 *
 * `tx.array(...)` rather than interpolating the array directly: Bun's tagged
 * template delivers a plain JS array as a comma-joined string, which Postgres
 * rejects as `22P02` on a `uuid[]` comparison.
 */
export async function countExistingInstitutions(
  tx: Bun.SQL,
  tenantId: string,
  institutionIds: readonly string[]
): Promise<number> {
  if (institutionIds.length === 0) {
    return 0;
  }

  const rows = (await tx`
    SELECT count(*)::int AS count FROM awcms_blog_institutions
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND id = ANY(${tx.array([...institutionIds], "uuid")})
  `) as { count: number }[];

  return rows[0]?.count ?? 0;
}
