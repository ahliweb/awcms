import type { TaxonomyType } from "../domain/taxonomy-policy";
import type {
  CreateBlogTermInput,
  UpdateBlogTermInput
} from "../domain/blog-term-validation";
import { boundedPageSize } from "../../_shared/offset-pagination";
import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";

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
  limit?: number;
};

export const DEFAULT_TERM_LIST_LIMIT = 100;
export const MAX_TERM_LIST_LIMIT = 200;

/**
 * The admin taxonomy screen's list: name ascending, bounded, no cursor.
 *
 * Alphabetical order is what a human scanning a table wants, and it is
 * precisely what makes this unsuitable for a caller that needs EVERY term —
 * a name is editable, so it cannot key a cursor, and the bound then truncates
 * in the one direction nobody notices. {@link listBlogTermsPage} is the
 * traversal; this stays as it was for the screens that only ever want a page.
 */
export async function listBlogTerms(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListBlogTermsFilter = {}
): Promise<BlogTermView[]> {
  const limit = boundedPageSize(
    filter.limit,
    DEFAULT_TERM_LIST_LIMIT,
    MAX_TERM_LIST_LIMIT
  );

  const rows = (await tx`
    SELECT id, tenant_id, taxonomy_type, parent_id, name, slug, description,
      created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_terms
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${filter.taxonomyType ?? null}::text IS NULL OR taxonomy_type = ${filter.taxonomyType ?? null})
    ORDER BY name ASC
    LIMIT ${limit}
  `) as BlogTermRow[];

  return rows.map(toView);
}

/**
 * The same list as a stable traversal — `created_at DESC, id DESC`, with a
 * cursor, so a caller can walk to the end and know it got there.
 *
 * ## Why the alphabetical list was not enough
 *
 * `listBlogTerms` answers a tenant with three thousand tags by returning the
 * alphabetically-first hundred and saying nothing about the rest. Nothing
 * fails: the caller gets `200`, a well-formed array, and a vocabulary that is
 * silently missing everything past roughly the letter B. A static build that
 * generates one archive page per tag then generates a hundred pages, and every
 * article filed under a later tag links to a page that was never built.
 *
 * Ordering by `created_at` rather than `name` is not a preference. A term can
 * be renamed at any time, and a rename moves it across a page boundary — so a
 * cursor over `name` skips or repeats terms and neither side can tell.
 * `created_at` is immutable, which is the whole reason it is the key here and
 * in `listBlogPostsPage`.
 */
export async function listBlogTermsPage(
  tx: Bun.SQL,
  tenantId: string,
  options: {
    taxonomyType?: TaxonomyType;
    limit?: number;
    cursor?: KeysetCursor | null;
  } = {}
): Promise<{ items: BlogTermView[]; nextCursor: string | null }> {
  const limit = boundedPageSize(
    options.limit,
    DEFAULT_TERM_LIST_LIMIT,
    MAX_TERM_LIST_LIMIT
  );

  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const taxonomyType = options.taxonomyType ?? null;

  const rows = (await tx`
    SELECT id, tenant_id, taxonomy_type, parent_id, name, slug, description,
      created_at, updated_at, deleted_at, deleted_by, delete_reason,
      ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_blog_terms
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${taxonomyType}::text IS NULL OR taxonomy_type = ${taxonomyType})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as (BlogTermRow & { created_at_cursor: string })[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { items: rows.map(toView), nextCursor };
}

export type TagLinkCandidateRow = {
  id: string;
  name: string;
  slug: string;
  /** Assignments to non-deleted posts. The ordering key, not a reported figure. */
  usageCount: number;
};

/**
 * The tags most likely to appear in an article's prose, most-used first
 * (Issue #648).
 *
 * ## Why automatic tag linking gets its own query
 *
 * It used to call `listBlogTerms(tx, tenantId, { taxonomyType: "tag" })`, whose
 * bound was chosen for an admin table: `ORDER BY name ASC`, a hundred rows. On
 * a tenant with more than a hundred tags that silently reduced the feature to
 * the alphabetically-first hundred — so whether a tag ever got linked was
 * decided by its first letter, and nothing anywhere said so. An editor asking
 * "why was `Sepak Bola` not linked?" got no answer: the tag exists, it is
 * enabled, it is spelled correctly, and it happens to start with S.
 *
 * ## Why a bound still exists
 *
 * `createInternalTagLinkEngine` compiles ONE alternation regex from every
 * candidate. Handing it several thousand literals means a very large regex
 * compiled on a public post render, so removing the bound is not the fix. The
 * defect was that the bound was inherited by accident, degraded alphabetically,
 * and was invisible.
 *
 * All three are addressed: the bound is named and lives with the feature
 * (`MAX_INTERNAL_TAG_LINK_CANDIDATES`), the ordering is by how many posts
 * actually carry the tag — the tags most likely to occur in prose — and the
 * caller learns whether it was hit.
 *
 * Assignments to soft-deleted posts are excluded, so a tag left on five hundred
 * deleted articles does not outrank one in daily use.
 */
export async function listTagLinkCandidates(
  tx: Bun.SQL,
  tenantId: string,
  limit: number
): Promise<TagLinkCandidateRow[]> {
  const rows = (await tx`
    SELECT t.id, t.name, t.slug, count(p.id)::int AS usage_count
    FROM awcms_blog_terms t
    LEFT JOIN awcms_blog_post_terms pt
      ON pt.tenant_id = t.tenant_id AND pt.term_id = t.id
    LEFT JOIN awcms_blog_posts p
      ON p.tenant_id = pt.tenant_id AND p.id = pt.post_id AND p.deleted_at IS NULL
    WHERE t.tenant_id = ${tenantId}
      AND t.deleted_at IS NULL
      AND t.taxonomy_type = 'tag'
    GROUP BY t.id, t.name, t.slug
    ORDER BY count(p.id) DESC, t.name ASC
    LIMIT ${limit}
  `) as { id: string; name: string; slug: string; usage_count: number }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    usageCount: row.usage_count
  }));
}

/** How many non-deleted tags this tenant has. Answers "was the candidate list capped?". */
export async function countTags(
  tx: Bun.SQL,
  tenantId: string
): Promise<number> {
  const rows = (await tx`
    SELECT count(*)::int AS count
    FROM awcms_blog_terms
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND taxonomy_type = 'tag'
  `) as { count: number }[];

  return rows[0]?.count ?? 0;
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

/**
 * The same assignments for a WHOLE page of posts — one query, not one per post.
 *
 * `listBlogPostsFullPage` left `termIds` out of the build feed precisely
 * because the per-post fetch above "would cost one extra query per post". That
 * reasoning was right about the per-post fetch and wrong about the conclusion:
 * a page of fifty posts needs one query with fifty ids in it, which is what
 * this is. The alternative it produced — a feed that never says which category
 * an article is in — meant no consumer could build a category archive at all.
 *
 * `tx.array(...)` rather than interpolating the array: Bun's tagged template
 * delivers a plain JS array as a comma-joined string, which PostgreSQL rejects
 * as `22P02` against a `uuid[]`.
 *
 * Posts with no assignments are simply absent from the map; callers default
 * them to `[]` rather than `undefined`, because "this article has no
 * categories" and "this payload does not carry categories" are different facts
 * and a consumer cannot act on the second if it looks like the first.
 */
export async function fetchPostTermIdsForPosts(
  tx: Bun.SQL,
  tenantId: string,
  postIds: readonly string[]
): Promise<Map<string, string[]>> {
  const byPost = new Map<string, string[]>();

  if (postIds.length === 0) {
    return byPost;
  }

  const rows = (await tx`
    SELECT post_id, term_id FROM awcms_blog_post_terms
    WHERE tenant_id = ${tenantId}
      AND post_id = ANY(${tx.array([...postIds], "uuid")})
  `) as { post_id: string; term_id: string }[];

  for (const row of rows) {
    const existing = byPost.get(row.post_id);

    if (existing) {
      existing.push(row.term_id);
    } else {
      byPost.set(row.post_id, [row.term_id]);
    }
  }

  return byPost;
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
