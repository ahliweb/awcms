import {
  MAX_MENU_ITEMS,
  type MenuItemInput,
  type MenuLinkType
} from "../domain/menu-policy";

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
 * within the batch and nests at most one level deep).
 *
 * ## Cost: 2 queries, whatever the item count
 *
 * It was one `INSERT` per item — the third instance of the shape
 * `syncPostTermAssignments` and `syncPostInstitutionAssignments` already had
 * fixed, and the one that looked hardest because of the self-FK.
 *
 * The roots-before-children ordering was there so "a child's FK to its parent
 * is always satisfied by the time it's inserted", which is true of separate
 * statements and NOT the constraint it appears to be for one. The FK is
 * `NOT DEFERRABLE`, and a `NOT DEFERRABLE` foreign key is checked by an AFTER
 * ROW trigger that fires at the end of the STATEMENT, not after each row — so a
 * single multi-row `INSERT` satisfies a child that references a parent in the
 * same statement regardless of their order within it. Verified against a real
 * Postgres with the child listed FIRST, which is the arrangement that must fail
 * if the checking were per-row.
 *
 * The order is preserved anyway, because it is what this function RETURNS and
 * changing that would be a silent API change riding along with a performance
 * fix.
 *
 * ## Why the rows come from the input rather than from `RETURNING`
 *
 * Every column this statement writes is caller-supplied — `MenuItemInput`
 * carries all seven, and `tenantId`/`menuId` are parameters. The table has no
 * user triggers and no `DEFAULT` can apply to a column that is always given a
 * value, so a `RETURNING` clause here reads back exactly what was just sent.
 * Dropping it removes the only reason this function would have needed to care
 * about the order `RETURNING` emits, which Postgres does not specify.
 *
 * The integration test asserts the returned views against a fresh read of the
 * table, so "the input equals what landed" is checked rather than assumed.
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
  const ordered = [...roots, ...children];

  if (ordered.length === 0) {
    return [];
  }

  const rows = ordered.map((item, index) => ({
    ordinal: index,
    id: item.id,
    tenant_id: tenantId,
    menu_id: menuId,
    parent_item_id: item.parentItemId,
    label: item.label,
    link_type: item.linkType,
    target_id: item.targetId,
    url: item.url,
    sort_order: item.sortOrder
  }));

  // `jsonb_to_recordset` rather than `unnest`: this row has four nullable
  // columns, and a Bun.SQL array cannot carry NULL — it writes the literal
  // string `'null'` without throwing. JSON `null` maps to SQL NULL natively.
  await tx`
    INSERT INTO awcms_blog_menu_items
      (id, tenant_id, menu_id, parent_item_id, label, link_type, target_id, url, sort_order)
    SELECT entry.id, entry.tenant_id, entry.menu_id, entry.parent_item_id,
           entry.label, entry.link_type, entry.target_id, entry.url,
           entry.sort_order
    FROM jsonb_to_recordset(${rows}::jsonb) AS entry (
      ordinal integer,
      id uuid,
      tenant_id uuid,
      menu_id uuid,
      parent_item_id uuid,
      label text,
      link_type text,
      target_id uuid,
      url text,
      sort_order integer
    )
    ORDER BY entry.ordinal
  `;

  return ordered.map((item) =>
    toItemView({
      id: item.id,
      tenant_id: tenantId,
      menu_id: menuId,
      parent_item_id: item.parentItemId,
      label: item.label,
      link_type: item.linkType,
      target_id: item.targetId,
      url: item.url,
      sort_order: item.sortOrder
    })
  );
}

/**
 * One menu's items, plus whether the read hit its bound (Issue #721).
 *
 * `truncated` is not decoration and not pagination metadata. `syncMenuItems`
 * has FULL-REPLACE semantics, so a client that reads a menu, edits it and
 * writes it back sends exactly what it was shown — and a read that quietly
 * stopped at the cap would make that round trip DELETE every item past it. A
 * bare `LIMIT` on this query would therefore have converted an unbounded read
 * into silent data loss. The flag is the reason the bound is safe to add: a
 * caller can see that what it holds is not the whole menu, before it writes.
 *
 * For everything written after `MAX_MENU_ITEMS` began being enforced the flag
 * is always `false`; it can only be `true` for a menu stored before it.
 */
export type BlogMenuItemsPage = {
  items: BlogMenuItemView[];
  truncated: boolean;
};

/**
 * Items for MANY menus in one round trip (Issue #721).
 *
 * `GET /api/v1/blog/menus` embeds each menu's items, and did it with one query
 * per menu inside the request transaction — `1 + N`, N up to the 100
 * `listMenus` returns. The loop was written sequentially on purpose (one
 * Postgres connection serves one query at a time, so `Promise.all` over `tx`
 * deadlocks rather than parallelising), which made the cost 100 SERIAL round
 * trips holding a pooled connection and a work-class slot for their whole
 * duration. The fix is not concurrency; it is asking once.
 *
 * Worth naming why the earlier sweep missed it: that scan looked for a tagged
 * template `await` inside a loop body, and this call site is
 * `await fetchMenuItems(tx, …)` — a plain function call. Matching the SQL
 * SYNTAX rather than the query made every N+1 that goes through a helper
 * invisible to it.
 *
 * ## The bound is per menu, which is why there is a window function
 *
 * A single `LIMIT` across the whole result set would spend the entire budget on
 * the first menu and return nothing for the rest, and the truncation could not
 * be attributed to any particular menu. `row_number()` partitioned by `menu_id`
 * bounds each menu independently and still costs one query. Reading
 * `MAX_MENU_ITEMS + 1` rows per partition is what makes `truncated` knowable:
 * with exactly the cap there is no way to tell "full" from "overflowing".
 *
 * `ORDER BY sort_order, id` — `sort_order` is not unique (nothing constrains
 * two siblings from sharing one), so ordering by it alone left equal-ordered
 * items in whatever order the scan produced, varying between identical calls.
 * That was survivable while the read was unbounded and is not once a bound can
 * cut the list: an arbitrary order makes an arbitrary 200 of 250 items.
 */
export async function fetchMenuItemsForMenus(
  tx: Bun.SQL,
  tenantId: string,
  menuIds: readonly string[]
): Promise<Map<string, BlogMenuItemsPage>> {
  const byMenu = new Map<string, BlogMenuItemsPage>();
  const unique = [...new Set(menuIds)];

  if (unique.length === 0) {
    return byMenu;
  }

  // `tx.array(...)` rather than interpolating the array: Bun's tagged template
  // delivers a plain JS array as a comma-joined string, which PostgreSQL
  // rejects as `22P02` against a `uuid[]`.
  const rows = (await tx`
    SELECT id, tenant_id, menu_id, parent_item_id, label, link_type, target_id, url, sort_order
    FROM (
      SELECT id, tenant_id, menu_id, parent_item_id, label, link_type,
             target_id, url, sort_order,
             row_number() OVER (
               PARTITION BY menu_id ORDER BY sort_order ASC, id ASC
             ) AS row_index
      FROM awcms_blog_menu_items
      WHERE tenant_id = ${tenantId}
        AND menu_id = ANY(${tx.array(unique, "uuid")})
    ) ranked
    WHERE ranked.row_index <= ${MAX_MENU_ITEMS + 1}
    ORDER BY ranked.menu_id ASC, ranked.sort_order ASC, ranked.id ASC
  `) as BlogMenuItemRow[];

  for (const row of rows) {
    const page = byMenu.get(row.menu_id);

    if (page) {
      page.items.push(toItemView(row));
    } else {
      byMenu.set(row.menu_id, { items: [toItemView(row)], truncated: false });
    }
  }

  // The `+ 1` row is the probe, never part of the answer.
  for (const page of byMenu.values()) {
    if (page.items.length > MAX_MENU_ITEMS) {
      page.items.length = MAX_MENU_ITEMS;
      page.truncated = true;
    }
  }

  return byMenu;
}

/** One menu's items. Delegates to {@link fetchMenuItemsForMenus} so the single-menu and list paths cannot drift to different bounds or a different order. */
export async function fetchMenuItems(
  tx: Bun.SQL,
  tenantId: string,
  menuId: string
): Promise<BlogMenuItemsPage> {
  const byMenu = await fetchMenuItemsForMenus(tx, tenantId, [menuId]);

  return byMenu.get(menuId) ?? { items: [], truncated: false };
}
