/**
 * Pure comparison logic for module permission sync/status. No I/O here — the
 * application layer (`application/permission-sync.ts`) reads each
 * descriptor's own `permissions` array (trusted code metadata) and the
 * current `awcms_permissions` catalog rows, then hands both to
 * `comparePermissions` to classify each one, keeping the decision testable
 * without a database.
 *
 * Deliberately read-only: this never writes to `awcms_permissions` — the
 * optional "safe sync action" is not implemented (see
 * `module-management/README.md`), so an `orphaned`/`missing` result here
 * never auto-corrects itself.
 */
export type PermissionSyncStatus =
  "synced" | "missing" | "orphaned" | "mismatched_description";

export type PermissionIdentity = {
  moduleKey: string;
  activityCode: string;
  action: string;
};

export type DescriptorPermission = PermissionIdentity & {
  description: string;
};

export type CatalogPermission = PermissionIdentity & {
  description: string | null;
};

export type PermissionSyncEntry = PermissionIdentity & {
  status: PermissionSyncStatus;
  descriptorDescription: string | null;
  catalogDescription: string | null;
};

function keyOf(permission: PermissionIdentity): string {
  return `${permission.moduleKey}.${permission.activityCode}.${permission.action}`;
}

/**
 * `synced` — declared in the descriptor, present in the catalog, same
 * description.
 * `missing` — declared in the descriptor, absent from the catalog (a
 * migration seeding it hasn't run, or was never added).
 * `orphaned` — present in the catalog, no descriptor declares it anymore
 * (never auto-deleted — an operator decides).
 * `mismatched_description` — present in both, but the descriptor's
 * description text and the catalog's stored description differ.
 */
export function comparePermissions(
  descriptorPermissions: readonly DescriptorPermission[],
  catalogPermissions: readonly CatalogPermission[]
): PermissionSyncEntry[] {
  const byKey = new Map<
    string,
    {
      identity: PermissionIdentity;
      descriptor?: DescriptorPermission;
      catalog?: CatalogPermission;
    }
  >();

  for (const descriptor of descriptorPermissions) {
    byKey.set(keyOf(descriptor), { identity: descriptor, descriptor });
  }

  for (const catalog of catalogPermissions) {
    const key = keyOf(catalog);
    const existing = byKey.get(key);

    if (existing) {
      existing.catalog = catalog;
    } else {
      byKey.set(key, { identity: catalog, catalog });
    }
  }

  return [...byKey.values()]
    .map(({ identity, descriptor, catalog }) => {
      let status: PermissionSyncStatus;

      if (descriptor && !catalog) {
        status = "missing";
      } else if (!descriptor && catalog) {
        status = "orphaned";
      } else if (descriptor!.description === catalog!.description) {
        status = "synced";
      } else {
        status = "mismatched_description";
      }

      return {
        moduleKey: identity.moduleKey,
        activityCode: identity.activityCode,
        action: identity.action,
        status,
        descriptorDescription: descriptor?.description ?? null,
        catalogDescription: catalog?.description ?? null
      };
    })
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}
