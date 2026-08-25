/**
 * The READ side of the menu item paths (Issue #721) — a query budget, a bound,
 * and the reason the bound needed a flag to be safe to add.
 *
 * `menu-item-sync-budget.integration.test.ts` pinned the WRITE at two
 * statements. The read next to it stayed at one query per menu:
 * `GET /api/v1/blog/menus` called `fetchMenuItems` in a loop over everything
 * `listMenus` returned, so up to 100 SERIAL round trips inside the request
 * transaction, each holding the pooled connection and its work-class slot.
 *
 * ## Why the earlier N+1 sweep did not see it
 *
 * That sweep looked for a tagged-template `await` inside a loop body. This call
 * site is `await fetchMenuItems(tx, …)` — a plain function call — so matching
 * the SQL SYNTAX rather than the query hid every N+1 routed through a helper.
 * Nothing about the loop was subtle; the scanner was looking for backticks.
 *
 * ## The bound could not simply be a `LIMIT`
 *
 * `syncMenuItems` REPLACES the whole item set. A client that reads a menu,
 * edits it and saves it back sends exactly what it was shown, so a read that
 * quietly stopped at the cap would make that round trip DELETE everything past
 * it — a bare `LIMIT` would have turned an unbounded read into silent data
 * loss. `truncated` is what makes the bound safe, and the cases below assert it
 * rather than assuming it.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { countQueries } from "./query-budget";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  fetchMenuItems,
  fetchMenuItemsForMenus
} from "../../src/modules/blog-content/application/menu-directory";
import { MAX_MENU_ITEMS } from "../../src/modules/blog-content/domain/menu-policy";

const TENANT = "fb000000-0000-4000-8000-000000000001";

/** One `menu_id = ANY(…)` read, whatever the menu count. */
const READ_QUERY_BUDGET = 1;

/**
 * Twelve menus, so the old per-menu shape costs 12 queries against a budget of
 * 1 and a regression cannot hide behind a one-menu fixture.
 */
const MENU_COUNT = 12;

function menuId(n: number): string {
  return `fb000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
}

async function seedTenant(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'menu-read-budget', 'Menu Read Budget Tenant')
  `;
}

/** `count` items on `menu`, each with a distinct `sort_order`. */
async function seedMenu(id: string, key: string, count: number): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_blog_menus (id, tenant_id, key, name)
    VALUES (${id}, ${TENANT}, ${key}, ${key})
  `;

  if (count === 0) {
    return;
  }

  await admin`
    INSERT INTO awcms_blog_menu_items
      (tenant_id, menu_id, label, link_type, url, sort_order)
    SELECT ${TENANT}, ${id}, ${key} || ' ' || n, 'url',
           'https://example.test/' || n, n
    FROM generate_series(1, ${count}) AS n
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("reading menu items costs one query and is bounded per menu", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant();
  });

  test("twelve menus cost ONE query, and every item lands under its own menu", async () => {
    for (let n = 0; n < MENU_COUNT; n += 1) {
      await seedMenu(menuId(n), `menu-${n}`, n + 1);
    }

    const runtime = getRuntimeSql();
    const ids = Array.from({ length: MENU_COUNT }, (_, n) => menuId(n));

    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        fetchMenuItemsForMenus(counting, TENANT, ids)
      )
    );

    expect(queries).toBe(READ_QUERY_BUDGET);

    // Grouping is the part a single query has to get right that twelve queries
    // got right for free: menu n must hold exactly its own n + 1 items, and
    // none of anybody else's.
    for (let n = 0; n < MENU_COUNT; n += 1) {
      const page = result.get(menuId(n));

      expect(page?.items).toHaveLength(n + 1);
      expect(page?.truncated).toBe(false);

      for (const item of page!.items) {
        expect(item.menuId).toBe(menuId(n));
        expect(item.label.startsWith(`menu-${n} `)).toBe(true);
      }
    }
  });

  test("one menu costs the same one query", async () => {
    await seedMenu(menuId(0), "solo", 5);

    const runtime = getRuntimeSql();

    const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        fetchMenuItemsForMenus(counting, TENANT, [menuId(0)])
      )
    );

    // The number does not move with the input. That is the whole property.
    expect(queries).toBe(READ_QUERY_BUDGET);
  });

  test("no menu ids costs NO query", async () => {
    const runtime = getRuntimeSql();

    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        fetchMenuItemsForMenus(counting, TENANT, [])
      )
    );

    // A tenant with no menus must not pay a round trip to be told so.
    expect(queries).toBe(0);
    expect(result.size).toBe(0);
  });

  test("a menu with no items is ABSENT from the map, not an empty entry", async () => {
    await seedMenu(menuId(0), "empty", 0);

    const runtime = getRuntimeSql();
    const result = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchMenuItemsForMenus(tx, TENANT, [menuId(0)])
    );

    // The caller supplies `[]`. Documented here so a future reader does not
    // "fix" the absence by materialising empty entries in the query.
    expect(result.has(menuId(0))).toBe(false);
  });

  test("exactly MAX_MENU_ITEMS is returned whole and NOT flagged", async () => {
    await seedMenu(menuId(0), "at-cap", MAX_MENU_ITEMS);

    const runtime = getRuntimeSql();
    const page = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchMenuItems(tx, TENANT, menuId(0))
    );

    // The boundary belongs to the un-flagged side: a full menu that reports
    // itself truncated would tell a client not to save a set that is complete.
    expect(page.items).toHaveLength(MAX_MENU_ITEMS);
    expect(page.truncated).toBe(false);
  });

  test("one item over the cap is flagged, and the extra item is NOT returned", async () => {
    await seedMenu(menuId(0), "over-cap", MAX_MENU_ITEMS + 1);

    const runtime = getRuntimeSql();
    const page = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchMenuItems(tx, TENANT, menuId(0))
    );

    expect(page.items).toHaveLength(MAX_MENU_ITEMS);
    expect(page.truncated).toBe(true);

    // The probe row is a probe. Returning `MAX_MENU_ITEMS + 1` items would put
    // the caller one over a limit its own writes are refused for.
    expect(page.items.at(-1)!.sortOrder).toBe(MAX_MENU_ITEMS);
  });

  test("the bound is PER MENU, not one budget shared across the batch", async () => {
    await seedMenu(menuId(0), "over-a", MAX_MENU_ITEMS + 1);
    await seedMenu(menuId(1), "over-b", MAX_MENU_ITEMS + 1);

    const runtime = getRuntimeSql();
    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        fetchMenuItemsForMenus(counting, TENANT, [menuId(0), menuId(1)])
      )
    );

    expect(queries).toBe(READ_QUERY_BUDGET);

    // A plain `LIMIT` would have spent the whole allowance on whichever menu
    // sorted first and returned nothing for the second. This is the assertion
    // that the window function is partitioned rather than global.
    for (const id of [menuId(0), menuId(1)]) {
      expect(result.get(id)?.items).toHaveLength(MAX_MENU_ITEMS);
      expect(result.get(id)?.truncated).toBe(true);
    }
  });

  test("items sharing a sort_order come back in the SAME order every time", async () => {
    // `sort_order` is not unique — nothing stops two siblings sharing one — so
    // ordering by it alone left equal-ordered items in whatever order the scan
    // produced. Survivable while the read was unbounded; not once a bound can
    // cut the list, because an arbitrary order makes an arbitrary 200 of 250.
    const admin = getAdminSql();

    await admin`
      INSERT INTO awcms_blog_menus (id, tenant_id, key, name)
      VALUES (${menuId(0)}, ${TENANT}, 'ties', 'Ties')
    `;
    await admin`
      INSERT INTO awcms_blog_menu_items
        (tenant_id, menu_id, label, link_type, url, sort_order)
      SELECT ${TENANT}, ${menuId(0)}, 'Item ' || n, 'url',
             'https://example.test/' || n, 1
      FROM generate_series(1, 40) AS n
    `;

    const runtime = getRuntimeSql();
    const first = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchMenuItems(tx, TENANT, menuId(0))
    );
    const second = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchMenuItems(tx, TENANT, menuId(0))
    );

    expect(first.items.map((item) => item.id)).toEqual(
      second.items.map((item) => item.id)
    );

    // And the tiebreaker is the declared one, so the order is predictable from
    // the data rather than merely repeatable on this machine today.
    const ids = first.items.map((item) => item.id);
    expect(ids).toEqual([...ids].sort());
  });

  test("another tenant's menu is not readable through the batch read", async () => {
    const admin = getAdminSql();
    const other = "fb000000-0000-4000-8000-0000000000ff";

    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${other}, 'menu-read-other', 'Other Tenant')
    `;
    await admin`
      INSERT INTO awcms_blog_menus (id, tenant_id, key, name)
      VALUES (${menuId(9)}, ${other}, 'theirs', 'Theirs')
    `;
    await admin`
      INSERT INTO awcms_blog_menu_items
        (tenant_id, menu_id, label, link_type, url, sort_order)
      VALUES (${other}, ${menuId(9)}, 'Theirs', 'url', 'https://example.test/x', 1)
    `;

    const runtime = getRuntimeSql();
    const result = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchMenuItemsForMenus(tx, TENANT, [menuId(9)])
    );

    // Batching widened the WHERE clause from one id to a list, which is exactly
    // the shape that leaks if the tenant predicate is dropped. RLS and the
    // explicit `tenant_id =` both have to hold.
    expect(result.size).toBe(0);
  });
});
