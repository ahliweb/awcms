/**
 * Per-tenant sidebar arrangement: read, save, reset (Issue #260).
 *
 * The default model is computed from `listModules()`; this layer only ever
 * reads and writes the tenant's DELTA against it (`sql/071`). A tenant with no
 * rows renders exactly the code default, which is what makes a newly added
 * module's nav entry appear everywhere without a data migration.
 */
import {
  applySidebarOverrides,
  applySidebarTypeOverrides,
  buildDefaultSidebarModel,
  composeSidebarSections,
  type ComposedType,
  type SidebarArrangement,
  type SidebarItemOverride,
  type SidebarTypeOverride
} from "../domain/sidebar-menu";
import { listModules } from "../..";
import { fetchTenantModuleEntries } from "./tenant-module-lifecycle";

type TypeRow = {
  type_key: string;
  label_override: string | null;
  position: number;
  hidden: boolean;
};

type ItemRow = {
  entry_key: string;
  type_key: string | null;
  position: number;
  label_override: string | null;
  hidden: boolean;
};

export async function fetchSidebarArrangement(
  tx: Bun.SQL,
  tenantId: string
): Promise<SidebarArrangement> {
  // Sequential, never Promise.all: `tx` is one reserved connection.
  const typeRows = (await tx`
    SELECT type_key, label_override, position, hidden
    FROM awcms_sidebar_menu_types
    WHERE tenant_id = ${tenantId}
    ORDER BY position, type_key
  `) as TypeRow[];
  const itemRows = (await tx`
    SELECT entry_key, type_key, position, label_override, hidden
    FROM awcms_sidebar_menu_items
    WHERE tenant_id = ${tenantId}
    ORDER BY position, entry_key
  `) as ItemRow[];

  return {
    types: typeRows.map((row) => ({
      typeKey: row.type_key,
      labelOverride: row.label_override,
      position: row.position,
      hidden: row.hidden
    })),
    items: itemRows.map((row) => ({
      entryKey: row.entry_key,
      typeKey: row.type_key,
      position: row.position,
      labelOverride: row.label_override,
      hidden: row.hidden
    }))
  };
}

/**
 * Replace this tenant's whole arrangement.
 *
 * DELETE-then-INSERT rather than upsert, on purpose: the payload IS the
 * arrangement, so a row the client omitted must disappear. An upsert would
 * leave orphaned overrides behind — a hidden item the operator un-hid in the
 * UI would stay hidden because nothing removed its row.
 *
 * Both statements run inside the caller's transaction, so a tenant is never
 * observable with its old rows deleted and its new ones not yet written.
 */
export async function saveSidebarArrangement(
  tx: Bun.SQL,
  tenantId: string,
  arrangement: SidebarArrangement
): Promise<void> {
  await tx`DELETE FROM awcms_sidebar_menu_types WHERE tenant_id = ${tenantId}`;
  await tx`DELETE FROM awcms_sidebar_menu_items WHERE tenant_id = ${tenantId}`;

  for (const type of arrangement.types) {
    await tx`
      INSERT INTO awcms_sidebar_menu_types
        (tenant_id, type_key, label_override, position, hidden)
      VALUES (${tenantId}, ${type.typeKey}, ${type.labelOverride},
              ${type.position}, ${type.hidden})
    `;
  }

  for (const item of arrangement.items) {
    await tx`
      INSERT INTO awcms_sidebar_menu_items
        (tenant_id, entry_key, type_key, position, label_override, hidden)
      VALUES (${tenantId}, ${item.entryKey}, ${item.typeKey}, ${item.position},
              ${item.labelOverride}, ${item.hidden})
    `;
  }
}

/** Drop every override, returning the tenant to the code default. */
export async function resetSidebarArrangement(
  tx: Bun.SQL,
  tenantId: string
): Promise<void> {
  await tx`DELETE FROM awcms_sidebar_menu_types WHERE tenant_id = ${tenantId}`;
  await tx`DELETE FROM awcms_sidebar_menu_items WHERE tenant_id = ${tenantId}`;
}

export type SidebarEditorModel = {
  /** Every entry the tenant MAY arrange — the code default, ignoring permissions and overrides. */
  entries: {
    entryKey: string;
    path: string;
    moduleKey: string;
    moduleName: string;
    defaultTypeKey: string;
    defaultLabel: string;
  }[];
  arrangement: SidebarArrangement;
};

/**
 * What the editor screen needs: the full code-derived entry set plus the
 * tenant's current overrides.
 *
 * Deliberately UNFILTERED by permission and by tenant-disabled module. The
 * editor arranges the menu; it does not preview one operator's view of it, and
 * hiding an entry from the arranger would silently make it unarrangeable —
 * which reads as data loss the moment somebody else can see it.
 */
export function buildSidebarEditorModel(
  arrangement: SidebarArrangement
): SidebarEditorModel {
  return {
    entries: buildDefaultSidebarModel(listModules()).map((entry) => ({
      entryKey: entry.path,
      path: entry.path,
      moduleKey: entry.moduleKey,
      moduleName: entry.moduleName,
      defaultTypeKey: entry.typeKey,
      defaultLabel: entry.labelKey
    })),
    arrangement
  };
}

/**
 * The rendered sidebar for one caller: code default -> tenant overrides ->
 * permission and tenant-disable filtering -> section ordering.
 *
 * The order of those steps is the contract. Overrides are applied FIRST so a
 * relabelled or re-bucketed entry still passes through the same
 * `composeSidebarSections` filtering every entry does — an override can never
 * be a way around `requiredPermission` or a disabled module.
 */
export async function fetchRenderedSidebar(
  tx: Bun.SQL,
  tenantId: string,
  options: {
    grantedPermissionKeys: ReadonlySet<string>;
    currentPath?: string;
  }
): Promise<ComposedType[]> {
  const arrangement = await fetchSidebarArrangement(tx, tenantId);
  const disabledModuleKeys = new Set(
    (await fetchTenantModuleEntries(tx, tenantId))
      .filter((entry) => !entry.tenantEnabled)
      .map((entry) => entry.moduleKey)
  );

  const sections = composeSidebarSections(
    applySidebarOverrides(buildDefaultSidebarModel(listModules()), arrangement),
    {
      grantedPermissionKeys: options.grantedPermissionKeys,
      tenantDisabledModuleKeys: disabledModuleKeys,
      currentPath: options.currentPath
    }
  );

  return applySidebarTypeOverrides(sections, arrangement);
}

export type { SidebarArrangement, SidebarItemOverride, SidebarTypeOverride };
