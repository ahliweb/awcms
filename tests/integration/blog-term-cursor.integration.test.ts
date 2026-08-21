/**
 * Cursor traversal over `awcms_blog_terms` against a real PostgreSQL
 * (Issue #597 item 1).
 *
 * ## Why a vocabulary needed its own traversal
 *
 * `listBlogTerms` ends in a bounded `LIMIT`, ordered by name, and returns an
 * array. Nothing in that answer distinguishes "this tenant has ninety tags"
 * from "this tenant has three thousand tags and you are holding the first
 * hundred". A caller generating one archive page per tag therefore builds a
 * hundred pages, green, and every article filed under a tag later in the
 * alphabet links to a page nobody generated.
 *
 * The first test below asserts that truncation deliberately, because it is
 * still the behaviour of the default list and the reason the traversal exists;
 * the rest assert the traversal actually reaches the end.
 *
 * ## Why one batch insert
 *
 * Every term is inserted by a single statement, so the rows share a
 * `created_at` down to the microsecond — the shape that reduced page two to
 * ZERO rows before Issue #158 was fixed. A term catalogue is exactly the kind
 * of table that arrives that way (a migration import, a seed), so if the
 * cursor ever loses precision again this suite loses rows and says so.
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
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { decodeKeysetCursor } from "../../src/modules/_shared/keyset-pagination";
import {
  DEFAULT_TERM_LIST_LIMIT,
  listBlogTerms,
  listBlogTermsPage
} from "../../src/modules/blog-content/application/blog-taxonomy-directory";

const TENANT = "f2222222-2222-4222-8222-222222222222";

/** Comfortably past the default bound, so the truncation is unambiguous. */
const TOTAL_TAGS = 250;
const PAGE_SIZE = 40;

async function seedTenant(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'term-cursor-tenant', 'Term Cursor Tenant')
  `;
}

/**
 * `lpad` keeps the generated names in a stable alphabetical order, which is
 * what lets the truncation test name exactly which terms survive the default
 * list and which are dropped.
 */
async function seedTags(count: number): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
    SELECT ${TENANT}, 'tag', 'Tag ' || lpad(n::text, 4, '0'), 'tag-' || lpad(n::text, 4, '0')
    FROM generate_series(1, ${count}) AS n
  `;
}

async function collectAllPages(
  taxonomyType?: "category" | "tag" | "channel" | "topic"
): Promise<string[]> {
  const runtime = getRuntimeSql();
  const seen: string[] = [];
  let cursor: string | null = null;

  for (let guard = 0; guard < 100; guard += 1) {
    const page: { items: { id: string }[]; nextCursor: string | null } =
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        listBlogTermsPage(tx, TENANT, {
          taxonomyType,
          limit: PAGE_SIZE,
          cursor: cursor ? decodeKeysetCursor(cursor) : null
        })
      );

    seen.push(...page.items.map((item) => item.id));

    if (!page.nextCursor) return seen;
    cursor = page.nextCursor;
  }

  throw new Error("cursor traversal did not terminate");
}

const suite = integrationEnabled ? describe : describe.skip;

suite("blog term cursor traversal", () => {
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

  test("the DEFAULT list truncates silently — this is what the traversal is for", async () => {
    await seedTags(TOTAL_TAGS);

    const runtime = getRuntimeSql();
    const terms = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogTerms(tx, TENANT, { taxonomyType: "tag" })
    );

    // A hundred of two hundred and fifty, and the shape of the answer — a bare
    // array — carries no field that could have told the caller so.
    expect(terms).toHaveLength(DEFAULT_TERM_LIST_LIMIT);
    expect(terms[0]!.name).toBe("Tag 0001");
    expect(terms.at(-1)!.name).toBe("Tag 0100");
    expect(terms.some((term) => term.name === "Tag 0250")).toBe(false);
  });

  test("a batch sharing one instant is traversed WITHOUT losing terms", async () => {
    await seedTags(TOTAL_TAGS);

    const seen = await collectAllPages();

    expect(seen).toHaveLength(TOTAL_TAGS);
    expect(new Set(seen).size).toBe(TOTAL_TAGS);
  });

  test("page two is not empty (the exact Issue #158 symptom)", async () => {
    await seedTags(TOTAL_TAGS);
    const runtime = getRuntimeSql();

    const first = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogTermsPage(tx, TENANT, { limit: PAGE_SIZE })
    );
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const second = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogTermsPage(tx, TENANT, {
        limit: PAGE_SIZE,
        cursor: decodeKeysetCursor(first.nextCursor!)
      })
    );

    expect(second.items).toHaveLength(PAGE_SIZE);

    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.some((item) => firstIds.has(item.id))).toBe(false);
  });

  test("the taxonomyType filter survives the cursor", async () => {
    await seedTags(PAGE_SIZE * 2);
    await getAdminSql()`
      INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
      SELECT ${TENANT}, 'category', 'Kategori ' || n, 'kategori-' || n
      FROM generate_series(1, 5) AS n
    `;

    const tags = await collectAllPages("tag");
    const categories = await collectAllPages("category");

    expect(tags).toHaveLength(PAGE_SIZE * 2);
    expect(categories).toHaveLength(5);
    // Two disjoint vocabularies: a filtered traversal that leaked across them
    // would put category pages at tag URLs.
    const tagIds = new Set(tags);
    expect(categories.some((id) => tagIds.has(id))).toBe(false);
  });

  test("soft-deleted terms never appear", async () => {
    await seedTags(PAGE_SIZE);
    await getAdminSql()`
      UPDATE awcms_blog_terms SET deleted_at = now()
      WHERE tenant_id = ${TENANT} AND slug = 'tag-0001'
    `;

    const seen = await collectAllPages();

    expect(seen).toHaveLength(PAGE_SIZE - 1);
  });

  test("the last page reports no next cursor", async () => {
    await seedTags(PAGE_SIZE - 1);

    const runtime = getRuntimeSql();
    const only = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogTermsPage(tx, TENANT, { limit: PAGE_SIZE })
    );

    expect(only.items).toHaveLength(PAGE_SIZE - 1);
    expect(only.nextCursor).toBeNull();
  });
});
