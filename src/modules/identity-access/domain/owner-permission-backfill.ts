/**
 * Which catalog permissions may be back-filled onto a tenant's `owner` role.
 *
 * ## The gap this closes
 *
 * A tenant's `owner` role is seeded with EVERY permission that exists at the
 * moment the tenant is created (`platform-bootstrap.ts`:
 * `INSERT … SELECT id FROM awcms_permissions`). Permission-seed migrations that
 * run LATER extend the global catalog only — they do not touch
 * `awcms_role_permissions`. So every tenant created before a module shipped is
 * missing that module's permissions, and its owner gets `403 ACCESS_DENIED` on
 * a feature the release notes say is available. It has happened once per
 * permission-seed migration since `sql/061`.
 *
 * ## Why "grant everything missing" would be WRONG
 *
 * An admin may deliberately narrow the owner role — that is what
 * `DELETE FROM awcms_role_permissions` in the role admin surface is for.
 * A backfill that grants every missing permission would silently resurrect
 * exactly the grants someone chose to remove, and an authorization change
 * nobody asked for is worse than the gap it fixes.
 *
 * ## The rule
 *
 * Grant only permissions whose CATALOG ROW IS NEWER than the role itself. Those
 * could not have been part of the original seed and therefore cannot be a
 * deliberate removal — they never existed to be removed. Anything older that is
 * missing was taken away on purpose and stays away.
 *
 * The comparison is strictly greater-than: a permission created in the same
 * instant as the role WAS part of the seed (bootstrap runs both in one
 * transaction), so `>=` would re-grant a deliberate removal on the tenant that
 * happened to be created by that very migration.
 */

export type CatalogPermissionRecord = {
  id: string;
  key: string;
  createdAt: Date;
};

export type OwnerRoleRecord = {
  roleId: string;
  createdAt: Date;
};

export type BackfillSelection = {
  /** Permissions to INSERT — newer than the role and not already granted. */
  grant: CatalogPermissionRecord[];
  /**
   * Missing, but OLDER than the role: presumed deliberately removed. Reported
   * so an operator can see them, never granted. Silence here would make the
   * two cases indistinguishable in the output.
   */
  skippedAsDeliberate: CatalogPermissionRecord[];
};

export function selectBackfillablePermissions(
  role: OwnerRoleRecord,
  catalog: readonly CatalogPermissionRecord[],
  grantedPermissionIds: ReadonlySet<string>
): BackfillSelection {
  const grant: CatalogPermissionRecord[] = [];
  const skippedAsDeliberate: CatalogPermissionRecord[] = [];

  for (const permission of catalog) {
    if (grantedPermissionIds.has(permission.id)) continue;

    if (permission.createdAt.getTime() > role.createdAt.getTime()) {
      grant.push(permission);
    } else {
      skippedAsDeliberate.push(permission);
    }
  }

  return { grant, skippedAsDeliberate };
}
