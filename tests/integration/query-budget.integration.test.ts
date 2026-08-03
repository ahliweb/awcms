/**
 * Query budgets on the hot public read paths — recommendation #6 of
 * `docs/awcms/repo-assessment-2026-08-04.md` §5.
 *
 * No ADR: this adds no standing rule and no gate to `bun run check`. It is test
 * infrastructure, and the assessment classified it that way deliberately —
 * inventing an ADR for it would dilute what an ADR means here.
 *
 * These are the endpoints the edge cache exists to front, which is exactly why
 * their query count matters: a cache MISS pays the full cost, and auto-activation
 * only engages once the origin is already under pressure. An N+1 here turns a
 * traffic spike into an outage rather than into a slow page.
 *
 * ## Why a count, and why these fixtures are deliberately large
 *
 * An N+1 is invisible to every other kind of test: the rows are right, the
 * assertions pass, the response is byte-identical. Only the number of round
 * trips differs.
 *
 * And a bound asserted against a one-row fixture proves nothing — a per-item
 * query and a constant-query implementation both issue about one. So each case
 * below seeds **more items than its budget allows**, which is what makes the
 * assertion bite: if the implementation ever starts doing work per item, the
 * count blows straight through the ceiling.
 *
 * The budgets are CEILINGS, not targets. Tightening one when an implementation
 * improves is welcome. Loosening one should be an argued change, because the
 * entire value of the file is that it fails when per-item work appears.
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
  listPublicBlogPosts,
  listPublicBlogPostsForFeed
} from "../../src/modules/blog-content/application/public-blog-directory";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PUBLISHED_AT = new Date("2026-06-01T00:00:00.000Z");

/** Comfortably more than any budget below, so per-item work cannot hide. */
const SEEDED_POSTS = 40;

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("query budgets — hot public read paths", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();

    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT}, 'budget', 'Budget Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `;

    // One statement, many rows — seeding in a loop would itself be the N+1 this
    // file exists to catch, and would dominate the runtime.
    //
    // `generate_series`, not a bound array: Bun.SQL interpolates `${array}` as
    // comma-joined TEXT, which Postgres rejects as a malformed array literal
    // (22P02). Every other bulk-seed in this suite uses the same idiom for the
    // same reason.
    await getAdminSql()`
      INSERT INTO awcms_blog_posts
        (tenant_id, author_tenant_user_id, title, slug, content_json,
         content_text, status, visibility, locale, published_at)
      SELECT ${TENANT}, ${ACTOR}, 'Post ' || n, 'post-' || n, '{}'::jsonb, 'body',
             'published', 'public', 'en', ${PUBLISHED_AT}
      FROM generate_series(1, ${SEEDED_POSTS}) AS n
    `;
  });

  test(`the public post listing is constant-query across ${SEEDED_POSTS} posts`, async () => {
    const { result, queries } = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) =>
        countQueries(tx, (counting) =>
          listPublicBlogPosts(counting, TENANT, { page: 1, pageSize: 20 })
        )
    );

    expect(result.items.length).toBe(20);
    // One page query plus at most a count/has-next probe. Twenty posts on the
    // page means an N+1 would land at 20+.
    expect(queries).toBeLessThanOrEqual(3);
  });

  test("paging deeper does not cost more queries", async () => {
    // The shape that regresses quietly: an implementation that walks pages, or
    // re-resolves something per page, stays correct and gets slower with depth.
    const countFor = async (page: number): Promise<number> =>
      (
        await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) =>
          countQueries(tx, (counting) =>
            listPublicBlogPosts(counting, TENANT, { page, pageSize: 10 })
          )
        )
      ).queries;

    expect(await countFor(4)).toBe(await countFor(1));
  });

  test(`the feed builder is constant-query across ${SEEDED_POSTS} posts`, async () => {
    // The feed is the single most-repeated query on the public surface — it is
    // rebuilt on every discovery request that misses the edge cache.
    const { result, queries } = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) =>
        countQueries(tx, (counting) =>
          listPublicBlogPostsForFeed(counting, TENANT)
        )
    );

    // Bounded by the module's own FEED_ITEM_LIMIT, not by a caller argument.
    expect(result.length).toBeGreaterThan(0);
    expect(queries).toBeLessThanOrEqual(3);
  });

  test("the counter sees each query, so a budget of 0 is unreachable", async () => {
    // Guards the instrument itself. A Proxy that silently stopped counting —
    // by losing its `apply` trap, say — would make every budget above pass
    // vacuously and read exactly the same in CI.
    const { queries } = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) =>
        countQueries(tx, async (counting) => {
          await counting`SELECT 1`;
          await counting`SELECT 2`;
          await counting`SELECT 3`;
        })
    );

    expect(queries).toBe(3);
  });
});
