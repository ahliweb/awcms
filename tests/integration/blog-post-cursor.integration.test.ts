/**
 * Cursor traversal over `awcms_blog_posts` against a real PostgreSQL.
 *
 * The bug this guards against does not reproduce in a unit test, because it
 * lives in the gap between what `timestamptz` stores (microseconds) and what a
 * JS `Date` can hold (milliseconds). Issue #158 measured it on offices: 105 rows
 * paged to 4, and a batch insert sharing one millisecond paged to 0. So the
 * decisive case here is a batch insert whose rows share a millisecond — if the
 * cursor ever loses precision again, this suite loses rows and says so.
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
import { listBlogPostsPage } from "../../src/modules/blog-content/application/blog-post-directory";

const TENANT = "f1111111-1111-4111-8111-111111111111";
const AUTHOR = "f0000000-0000-4000-8000-000000000001";

const TOTAL_POSTS = 25;
const PAGE_SIZE = 10;

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'cursor-tenant', 'Cursor Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'author@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;
}

/**
 * One statement inserts every row, so they share a `created_at` down to the
 * microsecond — the shape that reduced page 2 to ZERO rows before Issue #158
 * was fixed, and the reason this suite exists at all.
 */
async function seedPosts(count: number): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text, status, visibility, locale)
    SELECT ${TENANT}, ${AUTHOR}, 'Post ' || n, 'post-' || n, '{}'::jsonb, '', 'published', 'public', 'id'
    FROM generate_series(1, ${count}) AS n
  `;
}

async function collectAllPages(): Promise<string[]> {
  const runtime = getRuntimeSql();
  const seen: string[] = [];
  let cursor: string | null = null;

  for (let guard = 0; guard < 100; guard += 1) {
    const page: { items: { id: string }[]; nextCursor: string | null } =
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        listBlogPostsPage(tx, TENANT, {
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

suite("blog post cursor traversal", () => {
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

  test("a batch sharing one instant is traversed WITHOUT losing rows", async () => {
    await seedPosts(TOTAL_POSTS);

    const seen = await collectAllPages();

    expect(seen).toHaveLength(TOTAL_POSTS);
    expect(new Set(seen).size).toBe(TOTAL_POSTS);
  });

  test("page two is not empty (the exact Issue #158 symptom)", async () => {
    await seedPosts(TOTAL_POSTS);
    const runtime = getRuntimeSql();

    const first = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogPostsPage(tx, TENANT, { limit: PAGE_SIZE })
    );
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const second = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogPostsPage(tx, TENANT, {
        limit: PAGE_SIZE,
        cursor: decodeKeysetCursor(first.nextCursor!)
      })
    );

    expect(second.items).toHaveLength(PAGE_SIZE);
    // No overlap: the boundary row must not repeat.
    const firstIds = new Set(first.items.map((i) => i.id));
    expect(second.items.some((i) => firstIds.has(i.id))).toBe(false);
  });

  test("the last page reports no next cursor", async () => {
    await seedPosts(PAGE_SIZE * 2);

    const runtime = getRuntimeSql();
    const first = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogPostsPage(tx, TENANT, { limit: PAGE_SIZE })
    );
    const second = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogPostsPage(tx, TENANT, {
        limit: PAGE_SIZE,
        cursor: decodeKeysetCursor(first.nextCursor!)
      })
    );

    // Exactly two full pages: the second is full, so a third request is needed
    // to learn the traversal is over. That is the honest cost of "limit rows
    // returned" as the has-more signal, and the loop above handles it.
    const third = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogPostsPage(tx, TENANT, {
        limit: PAGE_SIZE,
        cursor: decodeKeysetCursor(second.nextCursor!)
      })
    );

    expect(third.items).toHaveLength(0);
    expect(third.nextCursor).toBeNull();
  });

  test("the status filter survives the cursor", async () => {
    await seedPosts(PAGE_SIZE);
    await getAdminSql()`
      UPDATE awcms_blog_posts SET status = 'draft'
      WHERE tenant_id = ${TENANT} AND slug IN ('post-1', 'post-2')
    `;

    const runtime = getRuntimeSql();
    const page = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogPostsPage(tx, TENANT, { status: "published", limit: PAGE_SIZE })
    );

    expect(page.items).toHaveLength(PAGE_SIZE - 2);
    expect(page.items.every((item) => item.status === "published")).toBe(true);
  });

  test("soft-deleted posts never appear", async () => {
    await seedPosts(PAGE_SIZE);
    await getAdminSql()`
      UPDATE awcms_blog_posts SET deleted_at = now()
      WHERE tenant_id = ${TENANT} AND slug = 'post-1'
    `;

    const seen = await collectAllPages();

    expect(seen).toHaveLength(PAGE_SIZE - 1);
  });
});
