/**
 * A query budget on the THIRD post-assignment write path, and the one that
 * looked hardest.
 *
 * `syncPostTermAssignments` and `syncPostInstitutionAssignments` are already
 * pinned at two statements each. `syncMenuItems` had the same one-INSERT-per-
 * item shape and two complications that made it look like it needed a design
 * decision rather than a substitution:
 *
 * 1. `awcms_blog_menu_items.parent_item_id` is a SELF-REFERENCING FK, and the
 *    loop inserted roots before children so "a child's FK to its parent is
 *    always satisfied by the time it's inserted";
 * 2. it returns its rows, and Postgres does not specify the order `RETURNING`
 *    emits.
 *
 * Both dissolved. The FK is `NOT DEFERRABLE`, which is checked by an AFTER ROW
 * trigger firing at the end of the STATEMENT — so one multi-row INSERT
 * satisfies a child referencing a parent in the same statement whatever their
 * order. And every column the statement writes is caller-supplied, so
 * `RETURNING` read back exactly what was sent and could simply go.
 *
 * The FK half was settled by a direct probe against Postgres with the child
 * listed FIRST — the arrangement that must fail if checking were per-row.
 * That probe is NOT reproducible through this function, which filters roots and
 * children before inserting, so no test here should be read as proving it.
 * Saying so explicitly because the reverse-order case below looks like it
 * proves that and does not: it passed under the per-item loop too.
 *
 * ## What this file has to prove that the other two budgets do not
 *
 * The other two write join-table rows nobody reads back in the same call. This
 * one RETURNS what it wrote, and it now builds that answer from the INPUT
 * rather than from the database. That is only safe if the input really is what
 * lands — so the cases below read the table back and compare, instead of
 * trusting the function's own return value to describe itself.
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
  syncMenuItems
} from "../../src/modules/blog-content/application/menu-directory";
import type { MenuItemInput } from "../../src/modules/blog-content/domain/menu-policy";

const TENANT = "fa000000-0000-4000-8000-000000000001";
const MENU = "fa000000-0000-4000-8000-000000000002";

/** One `DELETE` for the old set, one `INSERT ... jsonb_to_recordset` for the new one. */
const SYNC_QUERY_BUDGET = 2;

function itemId(n: number): string {
  return `fa000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
}

/**
 * Four roots, each with two children — 12 items, so the old shape costs 13
 * queries against a budget of 2 and a per-item regression cannot hide behind a
 * small fixture.
 */
function buildItems(): MenuItemInput[] {
  const items: MenuItemInput[] = [];
  let n = 0;

  for (let root = 0; root < 4; root += 1) {
    const rootId = itemId(n);
    items.push({
      id: rootId,
      parentItemId: null,
      label: `Root ${root}`,
      linkType: "url",
      targetId: null,
      url: `/root-${root}`,
      sortOrder: n
    });
    n += 1;

    for (let child = 0; child < 2; child += 1) {
      items.push({
        id: itemId(n),
        parentItemId: rootId,
        label: `Child ${root}.${child}`,
        linkType: "url",
        targetId: null,
        url: `/root-${root}/child-${child}`,
        sortOrder: n
      });
      n += 1;
    }
  }

  return items;
}

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'menu-budget', 'Menu Budget Tenant')
  `;
  await admin`
    INSERT INTO awcms_blog_menus (id, tenant_id, key, name)
    VALUES (${MENU}, ${TENANT}, 'main', 'Main')
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("syncing a menu costs two queries, whatever the item count", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("twelve items cost two queries, and all twelve land", async () => {
    const items = buildItems();
    const runtime = getRuntimeSql();

    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        syncMenuItems(counting, TENANT, MENU, items)
      )
    );

    expect(queries).toBe(SYNC_QUERY_BUDGET);
    expect(result).toHaveLength(items.length);

    const stored = (
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        fetchMenuItems(tx, TENANT, MENU)
      )
    ).items;
    expect(stored).toHaveLength(items.length);
  });

  test("what it RETURNS is what the table holds, field for field", async () => {
    // The return value is now built from the input rather than from RETURNING.
    // That is the claim this test exists to check: if the database were to
    // store anything other than what was sent — a coercion, a default, a
    // trigger — the function would be describing itself rather than reporting.
    const items = buildItems();
    const runtime = getRuntimeSql();

    const returned = await withTenantOrThrow(runtime, TENANT, (tx) =>
      syncMenuItems(tx, TENANT, MENU, items)
    );
    const stored = (
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        fetchMenuItems(tx, TENANT, MENU)
      )
    ).items;

    const byId = (list: typeof stored) =>
      [...list].sort((left, right) => left.id.localeCompare(right.id));

    expect(byId(returned)).toEqual(byId(stored));
  });

  test("input order changes neither what lands nor what comes back", async () => {
    // NOT a test that a child can precede its parent inside the statement: the
    // function filters roots and children itself, so the caller's order never
    // reaches the INSERT and this passed under the per-item loop too.
    //
    // Said plainly because the distinction is the whole reason this change was
    // safe. The self-FK made the batch look risky; what actually removed the
    // risk is that `NOT DEFERRABLE` FKs are checked by an AFTER ROW trigger
    // firing at end of STATEMENT — verified directly against Postgres with the
    // child listed first, a probe this function cannot express. So the
    // roots-before-children ordering is no longer load-bearing for
    // CORRECTNESS; it is retained only because it is the order this function
    // returns.
    const items = buildItems();
    const reversed = [...items].reverse();
    const runtime = getRuntimeSql();

    const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        syncMenuItems(counting, TENANT, MENU, reversed)
      )
    );

    expect(queries).toBe(SYNC_QUERY_BUDGET);

    const stored = (
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        fetchMenuItems(tx, TENANT, MENU)
      )
    ).items;
    expect(stored).toHaveLength(items.length);

    // Every child still points at a real parent row.
    const ids = new Set(stored.map((item) => item.id));
    for (const item of stored) {
      if (item.parentItemId === null) continue;
      expect(ids.has(item.parentItemId)).toBe(true);
    }
  });

  test("the returned order is unchanged: roots first, then children", async () => {
    // Preserved deliberately. It is what this function returned before, and
    // changing it would be a silent API change riding along with a performance
    // fix — even though the endpoint's OTHER branch (`fetchMenuItems`, when a
    // PATCH omits `items`) already answers in `sort_order` order instead.
    const items = buildItems();
    const runtime = getRuntimeSql();

    const returned = await withTenantOrThrow(runtime, TENANT, (tx) =>
      syncMenuItems(tx, TENANT, MENU, items)
    );

    const firstChildAt = returned.findIndex(
      (item) => item.parentItemId !== null
    );
    const lastRootAt = returned.reduce(
      (last, item, index) => (item.parentItemId === null ? index : last),
      -1
    );

    expect(firstChildAt).toBeGreaterThan(lastRootAt);
    expect(returned.filter((item) => item.parentItemId === null)).toHaveLength(
      4
    );
  });

  test("one item costs the same two queries", async () => {
    const runtime = getRuntimeSql();

    const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        syncMenuItems(counting, TENANT, MENU, [buildItems()[0]!])
      )
    );

    // The number does not move with the input. That is the whole property.
    expect(queries).toBe(SYNC_QUERY_BUDGET);
  });

  test("syncing an empty menu costs ONE query and clears the items", async () => {
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      syncMenuItems(tx, TENANT, MENU, buildItems())
    );

    const { result, queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) => syncMenuItems(counting, TENANT, MENU, []))
    );

    // The DELETE still has to run, or emptying a menu would silently do
    // nothing; the INSERT must not.
    expect(queries).toBe(1);
    expect(result).toEqual([]);

    const stored = (
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        fetchMenuItems(tx, TENANT, MENU)
      )
    ).items;
    expect(stored).toEqual([]);
  });

  test("it REPLACES the set rather than adding to it", async () => {
    const runtime = getRuntimeSql();
    const items = buildItems();

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      syncMenuItems(tx, TENANT, MENU, items)
    );
    await withTenantOrThrow(runtime, TENANT, (tx) =>
      syncMenuItems(tx, TENANT, MENU, items.slice(0, 1))
    );

    const stored = (
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        fetchMenuItems(tx, TENANT, MENU)
      )
    ).items;

    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(items[0]!.id);
  });
});
