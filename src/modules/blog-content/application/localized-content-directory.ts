/**
 * Multilingual content linking (Issue #542 §Multilingual Content: "Support
 * locale-based content storage and retrieval... Content slug uniqueness
 * must remain tenant + locale aware"). The per-locale storage/retrieval
 * itself and the tenant+locale+slug uniqueness were already true since
 * Issue #537 (`awcms_blog_posts.locale` + the partial unique index) —
 * this file only adds the ability to *link* several locale-variants of one
 * logical post together via the optional `translation_group_id` column
 * (migration 029). Deliberately a standalone one-column
 * `UPDATE`/`SELECT` pair rather than folding into `blog-post-directory.ts`'s
 * `createBlogPost`/`updateBlogPost` — those already have a wide column
 * list touched by every prior issue in this epic; a single narrow function
 * here is lower-risk than threading one more optional field through every
 * `RETURNING` clause in that file.
 */
export type PostTranslationSummary = {
  id: string;
  title: string;
  slug: string;
  locale: string;
};

type PostTranslationRow = {
  id: string;
  title: string;
  slug: string;
  locale: string;
};

/** Sets (or clears, with `null`) the translation group for a post. Returns `false` if the post doesn't exist for this tenant (not-deleted). */
export async function setPostTranslationGroup(
  tx: Bun.SQL,
  tenantId: string,
  postId: string,
  translationGroupId: string | null
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_posts
    SET translation_group_id = ${translationGroupId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${postId} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

/** Every non-deleted post sharing a `translationGroupId`, one row per locale. */
export async function fetchPostTranslations(
  tx: Bun.SQL,
  tenantId: string,
  translationGroupId: string
): Promise<PostTranslationSummary[]> {
  const rows = (await tx`
    SELECT id, title, slug, locale
    FROM awcms_blog_posts
    WHERE tenant_id = ${tenantId} AND translation_group_id = ${translationGroupId}
      AND deleted_at IS NULL
    ORDER BY locale ASC
  `) as PostTranslationRow[];

  return rows;
}
