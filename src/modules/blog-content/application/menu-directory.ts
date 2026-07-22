import type { MenuItemInput, MenuLinkType } from "../domain/menu-policy";

/** Read/write query module for `awcms_blog_menus`/`_menu_items` (Issue #542) — same "one directory, reads and writes" convention as `blog-taxonomy-directory.ts`. */
export type BlogMenuView = {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

type BlogMenuRow = {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

function toMenuView(row: BlogMenuRow): BlogMenuView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    key: row.key,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason
  };
}

export type BlogMenuItemView = {
  id: string;
  tenantId: string;
  menuId: string;
  parentItemId: string | null;
  label: string;
  linkType: MenuLinkType;
  targetId: string | null;
  url: string | null;
  sortOrder: number;
};

type BlogMenuItemRow = {
  id: string;
  tenant_id: string;
  menu_id: string;
  parent_item_id: string | null;
  label: string;
  link_type: MenuLinkType;
  target_id: string | null;
  url: string | null;
  sort_order: number;
};

function toItemView(row: BlogMenuItemRow): BlogMenuItemView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    menuId: row.menu_id,
    parentItemId: row.parent_item_id,
    label: row.label,
    linkType: row.link_type,
    targetId: row.target_id,
    url: row.url,
    sortOrder: row.sort_order
  };
}

export async function createMenu(
  tx: Bun.SQL,
  tenantId: string,
  key: string,
  name: string
): Promise<BlogMenuView> {
  const rows = (await tx`
    INSERT INTO awcms_blog_menus (tenant_id, key, name)
    VALUES (${tenantId}, ${key}, ${name})
    RETURNING id, tenant_id, key, name, created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogMenuRow[];

  return toMenuView(rows[0]!);
}

export async function fetchMenuById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<BlogMenuView | null> {
  const rows = (await tx`
    SELECT id, tenant_id, key, name, created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_menus
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `) as BlogMenuRow[];

  const row = rows[0];
  return row ? toMenuView(row) : null;
}

export async function listMenus(
  tx: Bun.SQL,
  tenantId: string
): Promise<BlogMenuView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, key, name, created_at, updated_at, deleted_at, deleted_by, delete_reason
    FROM awcms_blog_menus
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY name ASC
    LIMIT 100
  `) as BlogMenuRow[];

  return rows.map(toMenuView);
}

export async function updateMenu(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  name: string | undefined
): Promise<BlogMenuView | null> {
  const rows = (await tx`
    UPDATE awcms_blog_menus
    SET name = COALESCE(${name ?? null}, name), updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id, tenant_id, key, name, created_at, updated_at, deleted_at, deleted_by, delete_reason
  `) as BlogMenuRow[];

  return rows[0] ? toMenuView(rows[0]) : null;
}

export async function softDeleteMenu(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_blog_menus
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}

/**
 * Full replace semantics (delete all existing items for the menu, then
 * insert the given set) — same "PATCH replaces the whole sub-resource"
 * convention `syncPostTermAssignments` uses for `termIds`. Every item's
 * `id` is **client-supplied**, not `DEFAULT gen_random_uuid()` — the old
 * DB-generated ids from a previous sync are gone the moment `DELETE` runs
 * above, so `parentItemId` can only ever resolve against ids the caller
 * itself provides in this same payload (`domain/menu-policy.ts`'s
 * `validateMenuItemsInput` already checked every `parentItemId` resolves
 * within the batch and nests at most one level deep). Inserted
 * roots-before-children so a child's FK to its parent is always satisfied
 * by the time it's inserted.
 */
export async function syncMenuItems(
  tx: Bun.SQL,
  tenantId: string,
  menuId: string,
  items: readonly MenuItemInput[]
): Promise<BlogMenuItemView[]> {
  await tx`
    DELETE FROM awcms_blog_menu_items
    WHERE tenant_id = ${tenantId} AND menu_id = ${menuId}
  `;

  const roots = items.filter((item) => item.parentItemId === null);
  const children = items.filter((item) => item.parentItemId !== null);
  const inserted: BlogMenuItemRow[] = [];

  for (const item of [...roots, ...children]) {
    const rows = (await tx`
      INSERT INTO awcms_blog_menu_items
        (id, tenant_id, menu_id, parent_item_id, label, link_type, target_id, url, sort_order)
      VALUES (
        ${item.id}, ${tenantId}, ${menuId}, ${item.parentItemId}, ${item.label},
        ${item.linkType}, ${item.targetId}, ${item.url}, ${item.sortOrder}
      )
      RETURNING id, tenant_id, menu_id, parent_item_id, label, link_type, target_id, url, sort_order
    `) as BlogMenuItemRow[];

    inserted.push(rows[0]!);
  }

  return inserted.map(toItemView);
}

export async function fetchMenuItems(
  tx: Bun.SQL,
  tenantId: string,
  menuId: string
): Promise<BlogMenuItemView[]> {
  const rows = (await tx`
    SELECT id, tenant_id, menu_id, parent_item_id, label, link_type, target_id, url, sort_order
    FROM awcms_blog_menu_items
    WHERE tenant_id = ${tenantId} AND menu_id = ${menuId}
    ORDER BY sort_order ASC
  `) as BlogMenuItemRow[];

  return rows.map(toItemView);
}
