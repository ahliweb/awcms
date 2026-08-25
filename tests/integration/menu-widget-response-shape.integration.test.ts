/**
 * The `BlogMenu`/`BlogWidget` schemas held to the rows the code actually
 * returns, against a real PostgreSQL (Issue #597 item 6).
 *
 * ## Why this exists
 *
 * `GET /api/v1/blog/menus` and `GET /api/v1/blog/widgets` were documented as
 * returning an array of bare `object`. That is not a wrong shape — it is NO
 * shape, and it promises a consumer nothing: any field could be renamed or
 * dropped and the frozen consumer contract would still pass, because everything
 * is a subset of "object".
 *
 * Writing the schemas out fixes the promise and creates a new way to be wrong:
 * a document that names a field the endpoint does not return. This repo has
 * shipped that one before — the post list was documented as `BlogPost` while it
 * returned a summary, and a client that believed the document published a whole
 * site of empty articles with nothing failing.
 *
 * So the assertion runs the other way from a normal test. It reads the SCHEMA
 * out of the bundled spec, seeds real rows, calls the same functions the routes
 * call, and requires every `required` property to be present on the object that
 * comes back. The document cannot claim a field the code does not produce.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import { readFileSync } from "node:fs";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { parse as parseYaml } from "yaml";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  fetchMenuItems,
  fetchMenuItemsForMenus,
  listMenus
} from "../../src/modules/blog-content/application/menu-directory";
import { listWidgets } from "../../src/modules/blog-content/application/widget-directory";

const TENANT = "f5555555-5555-4555-8555-555555555555";

type AnyRecord = Record<string, unknown>;

/** The `required` list of one component schema in the BUNDLED spec. */
function requiredOf(schemaName: string): string[] {
  const bundle = parseYaml(
    readFileSync("openapi/awcms-public-api.openapi.yaml", "utf8")
  ) as AnyRecord;

  const components = bundle.components as AnyRecord;
  const schemas = components.schemas as Record<string, AnyRecord>;
  const schema = schemas[schemaName];

  if (!schema) {
    throw new Error(
      `${schemaName} is not in the bundle — regenerate with \`bun run openapi:bundle\`.`
    );
  }

  return (schema.required as string[] | undefined) ?? [];
}

async function seedTenant(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'menu-shape-tenant', 'Menu Shape Tenant')
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("menu and widget response shapes match their schemas", () => {
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

  test("every required BlogMenu property is on the row the route returns", async () => {
    const admin = getAdminSql();
    const menu = (await admin`
      INSERT INTO awcms_blog_menus (tenant_id, key, name)
      VALUES (${TENANT}, 'main', 'Menu Utama')
      RETURNING id
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_blog_menu_items
        (tenant_id, menu_id, label, link_type, url, sort_order)
      VALUES (${TENANT}, ${menu[0]!.id}, 'Beranda', 'url', 'https://example.test/', 1)
    `;

    const runtime = getRuntimeSql();
    const assembled = await withTenantOrThrow(runtime, TENANT, async (tx) => {
      // Exactly what `src/pages/api/v1/blog/menus/index.ts` assembles — the
      // BATCHED read it uses since Issue #721, not the per-menu one it used to.
      // This block is a hand-copy of the route, so it can drift from it; it
      // caught its own drift once, when `itemsTruncated` became required and
      // the copy did not have it.
      const menus = await listMenus(tx, TENANT);
      const first = menus[0]!;
      const itemsByMenu = await fetchMenuItemsForMenus(
        tx,
        TENANT,
        menus.map((menu) => menu.id)
      );
      const page = itemsByMenu.get(first.id);

      return {
        ...first,
        items: page?.items ?? [],
        itemsTruncated: page?.truncated ?? false
      };
    });

    const row = assembled as unknown as AnyRecord;

    for (const property of requiredOf("BlogMenu")) {
      expect(
        Object.hasOwn(row, property),
        `BlogMenu declares "${property}" required, and the endpoint does not return it`
      ).toBe(true);
    }

    // `items` is the field the whole schema exists for: a menu without it is a
    // name, and a template cannot render navigation from a name.
    expect(Array.isArray(row.items)).toBe(true);
    expect((row.items as unknown[]).length).toBe(1);
  });

  test("every required BlogMenuItem property is on the item", async () => {
    const admin = getAdminSql();
    const menu = (await admin`
      INSERT INTO awcms_blog_menus (tenant_id, key, name)
      VALUES (${TENANT}, 'main', 'Menu Utama')
      RETURNING id
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_blog_menu_items
        (tenant_id, menu_id, label, link_type, url, sort_order)
      VALUES (${TENANT}, ${menu[0]!.id}, 'Beranda', 'url', 'https://example.test/', 1)
    `;

    const runtime = getRuntimeSql();
    const items = (
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        fetchMenuItems(tx, TENANT, menu[0]!.id)
      )
    ).items;

    const item = items[0]! as unknown as AnyRecord;

    for (const property of requiredOf("BlogMenuItem")) {
      expect(
        Object.hasOwn(item, property),
        `BlogMenuItem declares "${property}" required, and the endpoint does not return it`
      ).toBe(true);
    }
  });

  test("items come back in sortOrder, not insertion order", async () => {
    // A menu rendered in the order rows happened to be written is navigation
    // that reorders itself when an editor edits an unrelated item.
    const admin = getAdminSql();
    const menu = (await admin`
      INSERT INTO awcms_blog_menus (tenant_id, key, name)
      VALUES (${TENANT}, 'main', 'Menu Utama')
      RETURNING id
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_blog_menu_items
        (tenant_id, menu_id, label, link_type, url, sort_order)
      VALUES
        (${TENANT}, ${menu[0]!.id}, 'Ketiga', 'url', 'https://example.test/c', 3),
        (${TENANT}, ${menu[0]!.id}, 'Pertama', 'url', 'https://example.test/a', 1),
        (${TENANT}, ${menu[0]!.id}, 'Kedua', 'url', 'https://example.test/b', 2)
    `;

    const runtime = getRuntimeSql();
    const items = (
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        fetchMenuItems(tx, TENANT, menu[0]!.id)
      )
    ).items;

    expect(items.map((item) => item.label)).toEqual([
      "Pertama",
      "Kedua",
      "Ketiga"
    ]);
  });

  test("every required BlogWidget property is on the row", async () => {
    await getAdminSql()`
      INSERT INTO awcms_blog_widgets (tenant_id, position, title, body_text, sort_order)
      VALUES (${TENANT}, 'sidebar', 'Tentang Kami', 'Teks biasa.', 1)
    `;

    const runtime = getRuntimeSql();
    const widgets = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listWidgets(tx, TENANT)
    );

    const row = widgets[0]! as unknown as AnyRecord;

    for (const property of requiredOf("BlogWidget")) {
      expect(
        Object.hasOwn(row, property),
        `BlogWidget declares "${property}" required, and the endpoint does not return it`
      ).toBe(true);
    }
  });

  test("an INACTIVE widget is still returned — the schema says so", async () => {
    // The document states it, so a consumer will rely on it. If the endpoint
    // ever starts hiding them, this fails here rather than in a build that
    // quietly loses half a sidebar.
    await getAdminSql()`
      INSERT INTO awcms_blog_widgets (tenant_id, position, title, body_text, is_active)
      VALUES (${TENANT}, 'sidebar', 'Dimatikan', '', false)
    `;

    const runtime = getRuntimeSql();
    const widgets = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listWidgets(tx, TENANT)
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.isActive).toBe(false);
  });
});
