/**
 * Author display-name lookup for the admin UI (Issue #543 §Post List/§Post
 * Editor — "author" column/field). A blog post/page only stores
 * `author_tenant_user_id` (a bare id, `blog-post-directory.ts`/
 * `blog-page-directory.ts` intentionally stay pure to their own table).
 * Resolving that id to a human-readable name means joining
 * `awcms_tenant_users` -> `awcms_identities` -> `awcms_profiles`
 * (`display_name`) — the exact join `identity-access/application/
 * user-directory.ts`'s `fetchTenantUsersWithRoles` already does for
 * `/admin/access-users`, but that function also loads role assignments and
 * is gated by `identity_access.user_management.read`, a permission a blog
 * editor need not hold just to see who authored a post. This file is a
 * narrower, purpose-built read: tenant-scoped, bounded to the ids actually
 * requested, no role data, and usable by anyone who can already read blog
 * posts/pages (author names of content they can already see is not new
 * information exposure).
 */

export type AuthorLookupRow = {
  tenant_user_id: string;
  display_name: string;
};

/**
 * Returns a `Map<tenantUserId, displayName>` covering every id in
 * `tenantUserIds` that still resolves to an active tenant-user row (a
 * deleted/orphaned author id is simply absent from the map — callers should
 * fall back to a placeholder, never throw).
 */
export async function fetchAuthorDisplayNames(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserIds: readonly string[]
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(tenantUserIds)];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = (await tx`
    SELECT tu.id AS tenant_user_id, p.display_name
    FROM awcms_tenant_users tu
    JOIN awcms_identities i
      ON i.id = tu.identity_id AND i.tenant_id = tu.tenant_id
    JOIN awcms_profiles p
      ON p.id = i.profile_id AND p.tenant_id = tu.tenant_id
    WHERE tu.tenant_id = ${tenantId}
      AND tu.id = ANY(${tx.array([...uniqueIds], "uuid")})
  `) as AuthorLookupRow[];

  return new Map(rows.map((row) => [row.tenant_user_id, row.display_name]));
}
