/**
 * A query budget on a WRITE path (Issue #599, performance round).
 *
 * ## Why this file exists at all
 *
 * The four budget suites this repo already has — public reads, admin reads, the
 * sitemap builder, the middleware — all measure READS. That is not an oversight
 * so much as where the attention went: a read path is hit constantly, so its
 * cost is felt. A write path is hit once per save, so a per-item query inside it
 * looks like nothing.
 *
 * It stops looking like nothing the moment a bulk importer becomes the caller.
 * `syncPostTermAssignments` issued one `INSERT` PER TERM, which is a handful of
 * statements when an editor saves an article and roughly 48,000 of them when
 * `blog:legacy:import` files a 23,906-article archive. The read side of exactly
 * this relationship was already fixed for the same reason — see
 * `fetchPostTermIdsForPosts`, "three round trips per page, not fifty-one" — and
 * the write side simply had nobody counting.
 *
 * ## The budget is EXACT, and the fixture is deliberately larger than it
 *
 * Two statements: one `DELETE` for the previous set, one `INSERT ... unnest`
 * for the new one. Exact rather than a ceiling, because the whole point is that
 * the number does not move with the number of terms — a `toBeLessThanOrEqual`
 * would pass a regression that added one query per term as long as the fixture
 * stayed small.
 *
 * The fixture assigns 12 terms. With a per-term `INSERT` that is 13 queries
 * against a budget of 2, so the old shape cannot pass by accident.
 *
 * ## Correctness is asserted alongside the count
 *
 * A budget on its own is satisfied by a function that writes nothing. Every
 * case below checks the rows that actually landed, because "fast" and "wrote
 * the right thing" are different claims and this change is only allowed to make
 * one of them different.
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
import { syncPostTermAssignments } from "../../src/modules/blog-content/application/blog-taxonomy-directory";

const TENANT = "f7777777-7777-4777-8777-777777777777";
const AUTHOR = "f7000000-0000-4000-8000-000000000001";

/** More than the budget by an order of magnitude, so a per-item query cannot hide. */
const TERM_COUNT = 12;

/** One `DELETE` for the old set, one `INSERT ... unnest` for the new one. */
const ASSIGNMENT_QUERY_BUDGET = 2;

async function seedFixtures(): Promise<string[]> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'term-budget', 'Term Budget Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'term-budget@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;

  await admin`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale)
    VALUES (${TENANT}, ${AUTHOR}, 'Filed', 'filed', '{}'::jsonb, '',
            'published', 'public', 'id')
  `;

  const terms = (await admin`
    INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
    SELECT ${TENANT}, 'category', 'Kategori ' || n, 'kategori-' || n
    FROM generate_series(1, ${TERM_COUNT}) AS n
    RETURNING id
  `) as { id: string }[];

  return terms.map((row) => row.id);
}

async function postId(): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT id FROM awcms_blog_posts WHERE tenant_id = ${TENANT} AND slug = 'filed'
  `) as { id: string }[];

  return rows[0]!.id;
}

async function assignedTermIds(id: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT term_id FROM awcms_blog_post_terms
    WHERE tenant_id = ${TENANT} AND post_id = ${id}
    ORDER BY term_id
  `) as { term_id: string }[];

  return rows.map((row) => row.term_id);
}

const suite = integrationEnabled ? describe : describe.skip;

suite("filing a post costs the same whether it has one term or twelve", () => {
  let termIds: string[] = [];

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    termIds = await seedFixtures();
  });

  test("twelve terms cost two queries, and all twelve land", async () => {
    const id = await postId();
    const runtime = getRuntimeSql();

    const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        syncPostTermAssignments(counting, TENANT, id, termIds)
      )
    );

    expect(queries).toBe(ASSIGNMENT_QUERY_BUDGET);
    expect(await assignedTermIds(id)).toEqual([...termIds].sort());
  });

  test("one term costs the same two queries", async () => {
    const id = await postId();
    const runtime = getRuntimeSql();

    const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        syncPostTermAssignments(counting, TENANT, id, [termIds[0]!])
      )
    );

    // The number does not move with the input. That is the whole property.
    expect(queries).toBe(ASSIGNMENT_QUERY_BUDGET);
    expect(await assignedTermIds(id)).toEqual([termIds[0]!]);
  });

  test("filing nothing skips the INSERT entirely", async () => {
    const id = await postId();
    const runtime = getRuntimeSql();

    const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
      countQueries(tx, (counting) =>
        syncPostTermAssignments(counting, TENANT, id, [])
      )
    );

    // An empty `unnest` would be a legal statement and a wasted round trip.
    expect(queries).toBe(1);
    expect(await assignedTermIds(id)).toEqual([]);
  });

  test("it REPLACES the set rather than adding to it", async () => {
    const id = await postId();
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT, (tx) =>
      syncPostTermAssignments(tx, TENANT, id, termIds.slice(0, 4))
    );
    await withTenantOrThrow(runtime, TENANT, (tx) =>
      syncPostTermAssignments(tx, TENANT, id, termIds.slice(8))
    );

    // The batched INSERT must not turn a replace into an append: the second
    // call's terms are the only ones that should remain.
    expect(await assignedTermIds(id)).toEqual([...termIds.slice(8)].sort());
  });
});
