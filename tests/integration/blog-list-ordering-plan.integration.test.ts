/**
 * The blog list orderings are served by an index, not by sorting the tenant —
 * finding C1 of the 17 August 2026 audit round, `sql/143`.
 *
 * ## Why this asserts a PLAN and not a duration
 *
 * A timing assertion on shared CI hardware is a coin flip with a threshold
 * attached: it goes red for a noisy neighbour and green for a regression that
 * happens to run on a quiet machine. What actually regressed in C1 is
 * structural — the query reads every row of the tenant and then throws almost
 * all of them away — and `EXPLAIN` states that directly.
 *
 * So each case asserts three things about the plan:
 *
 *   1. the named index from `sql/143` is the access path;
 *   2. there is no `Seq Scan` on the table;
 *   3. there is no sort node — the index already supplies the order, which is
 *      the whole reason the tiebreaker column is IN the index.
 *
 * Together those make the cost O(page size). Before `sql/143`, measured against
 * 24,000 seeded posts: 24,000 rows scanned plus a top-N heapsort to return 50,
 * at 7.4 ms; after, 50 rows and 0.057 ms. The milliseconds are the machine's;
 * the row count is the defect.
 *
 * ## The deep page is the case that matters
 *
 * A first page is fast under almost any plan. The assertion worth having is the
 * RESUMED one: a cursor landing at row 10,000 still reads 50 rows. That is the
 * property a keyset cursor exists for, and it is worth nothing if the index
 * cannot supply the order.
 *
 * MUTATION PROOF: drop either index from `sql/143` → the matching case goes RED
 * with a `Seq Scan` in its plan.
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
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";

const TENANT = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";

/**
 * Enough rows that a sequential scan is clearly the worse plan, and few enough
 * that seeding is not the slowest thing in the suite. The defect is visible at
 * any size — it is O(tenant posts) — but a planner given fifty rows will
 * reasonably pick a scan, and a test that cannot distinguish "the index is
 * missing" from "the table is tiny" asserts nothing.
 */
const POST_COUNT = 3000;

async function seed(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'c1-plan', 'C1 Plan', 'active')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];

  const identity = (await admin`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'c1@example.test', 'x')
    RETURNING id
  `) as { id: string }[];

  const author = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  // `generate_series` rather than 3000 round trips: the point of this file is
  // the plan, and a fixture that takes a minute discourages running it.
  await admin.unsafe(
    `INSERT INTO awcms_blog_posts
       (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
        status, visibility, locale, created_at, updated_at, published_at)
     SELECT $1, $2, 'Judul ' || g, 'judul-' || g, $3::jsonb, 'isi',
            CASE WHEN g % 7 = 0 THEN 'draft' ELSE 'published' END,
            'public', 'id',
            now() - (g || ' minutes')::interval,
            now() - (g || ' seconds')::interval,
            now() - (g || ' minutes')::interval
     FROM generate_series(1, ${POST_COUNT}) g`,
    [TENANT, author[0]!.id, JSON.stringify({ blocks: [] })]
  );

  // Without fresh statistics the planner is choosing between a scan it has
  // measured and an index it has not, which is not the question under test.
  await admin.unsafe("ANALYZE awcms_blog_posts");
}

type Plan = { text: string; scan: string; rowsRead: number };

async function explain(
  sqlText: string,
  params: unknown[],
  on: Bun.SQL = getAdminSql()
): Promise<Plan> {
  const rows = (await on.unsafe(
    `EXPLAIN (ANALYZE, FORMAT TEXT) ${sqlText}`,
    params as never[]
  )) as Record<string, string>[];

  const text = rows.map((row) => Object.values(row)[0]).join("\n");
  const scan =
    text.match(
      /(Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan)[^\n]*/
    )?.[0] ?? "(no scan node)";

  return {
    text,
    scan: scan.trim(),
    rowsRead: Number(scan.match(/rows=([\d.]+)\.00 loops/)?.[1] ?? -1)
  };
}

/** The three properties, asserted together because each alone is satisfiable by a wrong plan. */
function expectServedByIndex(plan: Plan, indexName: string): void {
  expect(plan.scan).toContain(indexName);
  expect(plan.text).not.toContain("Seq Scan on awcms_blog_posts");
  // No sort node: the index supplies the order. A plan that scanned the index
  // and then sorted would satisfy the first two assertions and none of the
  // point.
  expect(plan.text).not.toContain("Sort Method");
  // O(page size), which is the finding restated as a number.
  expect(plan.rowsRead).toBeLessThanOrEqual(50);
}

const suite = integrationEnabled ? describe : describe.skip;

suite("blog list orderings are served by an index (sql/143)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seed();
  });

  test("/admin/blog — ORDER BY updated_at DESC", async () => {
    const plan = await explain(
      `SELECT id, tenant_id, title, slug, status, visibility, locale,
              published_at, updated_at, created_at
       FROM awcms_blog_posts
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 50`,
      [TENANT]
    );

    expectServedByIndex(plan, "awcms_blog_posts_tenant_updated_idx");
  });

  test("/admin/blog with the status filter the route sends", async () => {
    // The `${param}::text IS NULL OR col = ${param}` idiom every list in this
    // module uses. It is not sargable on `status`, which is exactly why the
    // index leads with `tenant_id, updated_at` and not with `status`.
    const plan = await explain(
      `SELECT id, title FROM awcms_blog_posts
       WHERE tenant_id = $1 AND deleted_at IS NULL
         AND ($2::text IS NULL OR status = $2)
       ORDER BY updated_at DESC LIMIT 50`,
      [TENANT, "published"]
    );

    expectServedByIndex(plan, "awcms_blog_posts_tenant_updated_idx");
  });

  test("GET /api/v1/blog/posts — keyset first page", async () => {
    const plan = await explain(
      `SELECT id, title FROM awcms_blog_posts
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 50`,
      [TENANT]
    );

    expectServedByIndex(plan, "awcms_blog_posts_tenant_created_keyset_idx");
  });

  test("GET /api/v1/blog/posts — keyset page RESUMED deep into the archive", async () => {
    // The case a first-page test cannot see, and the one a static build of
    // 23,906 articles spends almost all of its time in.
    const anchor = (await getAdminSql().unsafe(
      `SELECT created_at, id FROM awcms_blog_posts
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC OFFSET 2000 LIMIT 1`,
      [TENANT]
    )) as { created_at: Date; id: string }[];

    const plan = await explain(
      `SELECT id, title FROM awcms_blog_posts
       WHERE tenant_id = $1 AND deleted_at IS NULL
         AND (created_at, id) < ($2, $3)
       ORDER BY created_at DESC, id DESC LIMIT 50`,
      [TENANT, anchor[0]!.created_at, anchor[0]!.id]
    );

    expectServedByIndex(plan, "awcms_blog_posts_tenant_created_keyset_idx");
  });

  test("the index really is what makes the difference", async () => {
    // NON-VACUOUS. Every assertion above is also satisfied by a table small
    // enough that any plan reads few rows. Dropping the index inside this
    // transaction shows the plan the repository actually shipped: a scan of the
    // whole tenant plus a sort, to return fifty rows.
    //
    // Rolled back through `sql.begin` rather than `BEGIN`/`ROLLBACK` on the
    // pool: Bun.SQL refuses a raw transaction statement on a pooled client
    // (`ERR_POSTGRES_UNSAFE_TRANSACTION`), and dropping the index outside a
    // transaction would leak into every other file sharing this database —
    // the harness is ref-counted and does not recreate the schema per file.
    const admin = getAdminSql();
    let planWithoutIndex: Plan | undefined;

    try {
      await admin.begin(async (tx) => {
        await tx.unsafe("DROP INDEX awcms_blog_posts_tenant_updated_idx");

        planWithoutIndex = await explain(
          `SELECT id, title FROM awcms_blog_posts
           WHERE tenant_id = $1 AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT 50`,
          [TENANT],
          tx as unknown as Bun.SQL
        );

        // The only way out that undoes the DROP. `try`/`catch` rather than
        // `expect().rejects`, which hangs against a Bun.SQL query promise on
        // this pool harness.
        throw new Error("__rollback__");
      });
    } catch (error) {
      if ((error as Error).message !== "__rollback__") throw error;
    }

    expect(planWithoutIndex).toBeDefined();
    expect(planWithoutIndex!.text).toContain("Seq Scan on awcms_blog_posts");
    expect(planWithoutIndex!.text).toContain("Sort Method");
    expect(planWithoutIndex!.rowsRead).toBeGreaterThan(1000);

    // And the index is back, so the file leaves the database as it found it.
    const restored = await explain(
      `SELECT id, title FROM awcms_blog_posts
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 50`,
      [TENANT]
    );

    expect(restored.scan).toContain("awcms_blog_posts_tenant_updated_idx");
  });
});
