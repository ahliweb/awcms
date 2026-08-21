/**
 * `?view=full` carries `termIds` and `institutionIds` — against a real
 * PostgreSQL (Issue #597 item 1).
 *
 * ## Why this needs a database, and why it needs more than one post
 *
 * The failure this guards is not "the field is missing" — that a type checker
 * would catch. It is the two ways a batched lookup goes wrong while still
 * returning well-formed data:
 *
 *   1. **Assignments attached to the wrong post.** One query returns rows for a
 *      whole page and the code groups them by `post_id`; grouping by position,
 *      or by a map keyed off the wrong column, produces a feed where every
 *      article has categories and some of them belong to a different article.
 *      Nothing fails, and the site publishes with articles filed under other
 *      articles' categories. So the fixture gives each post a DIFFERENT number
 *      of terms and asserts per post, not in aggregate.
 *   2. **A post with none reading as "not fetched".** `undefined` and `[]` are
 *      the same thing to a consumer that writes `post.termIds?.length`, and the
 *      difference decides whether an unfiled article is reported or silently
 *      dropped from every archive.
 *
 * The traversal is exercised across a page boundary as well, because a batched
 * lookup that only ever sees page one is a defect no single-page test can see.
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
import { listBlogPostsFullPage } from "../../src/modules/blog-content/application/blog-post-directory";

const TENANT = "f3333333-3333-4333-8333-333333333333";
const OTHER_TENANT = "f4444444-4444-4444-8444-444444444444";
const AUTHOR = "f3000000-0000-4000-8000-000000000001";

const POST_COUNT = 6;

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'feed-tenant', 'Feed Tenant'),
           (${OTHER_TENANT}, 'other-tenant', 'Other Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'feed@example.test', 'x')
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
    SELECT ${TENANT}, ${AUTHOR}, 'Post ' || n, 'post-' || n, '{}'::jsonb, '',
           'published', 'public', 'id'
    FROM generate_series(1, ${POST_COUNT}) AS n
  `;
}

async function seedTerms(count: number): Promise<string[]> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
    SELECT ${TENANT}, 'category', 'Kategori ' || n, 'kategori-' || n
    FROM generate_series(1, ${count}) AS n
    RETURNING id
  `) as { id: string }[];

  return rows.map((row) => row.id);
}

async function postIdBySlug(slug: string): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT id FROM awcms_blog_posts
    WHERE tenant_id = ${TENANT} AND slug = ${slug}
  `) as { id: string }[];

  return rows[0]!.id;
}

async function assign(
  postId: string,
  termIds: readonly string[]
): Promise<void> {
  const admin = getAdminSql();

  for (const termId of termIds) {
    await admin`
      INSERT INTO awcms_blog_post_terms (tenant_id, post_id, term_id)
      VALUES (${TENANT}, ${postId}, ${termId})
    `;
  }
}

async function readFeed(limit = 100) {
  const runtime = getRuntimeSql();

  return withTenantOrThrow(runtime, TENANT, (tx) =>
    listBlogPostsFullPage(tx, TENANT, { limit })
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("build feed carries classifications", () => {
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

  test("each post gets ITS OWN terms, not the page's", async () => {
    const terms = await seedTerms(4);

    // Deliberately uneven and deliberately overlapping: a grouping bug that
    // pairs assignments with posts by position would still produce plausible
    // counts if every post had the same number.
    await assign(await postIdBySlug("post-1"), [terms[0]!]);
    await assign(await postIdBySlug("post-2"), [
      terms[0]!,
      terms[1]!,
      terms[2]!
    ]);
    await assign(await postIdBySlug("post-3"), [terms[3]!]);

    const page = await readFeed();
    const bySlug = new Map(page.items.map((item) => [item.slug, item]));

    expect([...bySlug.get("post-1")!.termIds].sort()).toEqual(
      [terms[0]!].sort()
    );
    expect([...bySlug.get("post-2")!.termIds].sort()).toEqual(
      [terms[0]!, terms[1]!, terms[2]!].sort()
    );
    expect([...bySlug.get("post-3")!.termIds].sort()).toEqual(
      [terms[3]!].sort()
    );
  });

  test("a post with no assignments gets [], never undefined", async () => {
    await seedTerms(1);

    const page = await readFeed();

    for (const item of page.items) {
      expect(Array.isArray(item.termIds)).toBe(true);
      expect(Array.isArray(item.institutionIds)).toBe(true);
    }

    expect(page.items.every((item) => item.termIds.length === 0)).toBe(true);
  });

  test("institutions come back too", async () => {
    const admin = getAdminSql();
    const institutions = (await admin`
      INSERT INTO awcms_blog_institutions (tenant_id, name, slug, branch)
      VALUES (${TENANT}, 'DPRD Contoh', 'dprd-contoh', 'legislative')
      RETURNING id
    `) as { id: string }[];

    const postId = await postIdBySlug("post-1");
    await admin`
      INSERT INTO awcms_blog_post_institutions (tenant_id, post_id, institution_id)
      VALUES (${TENANT}, ${postId}, ${institutions[0]!.id})
    `;

    const page = await readFeed();
    const post = page.items.find((item) => item.slug === "post-1")!;

    expect(post.institutionIds).toEqual([institutions[0]!.id]);
    // The other classification must not have picked up the institution id.
    expect(post.termIds).toEqual([]);
  });

  test("an assignment row belonging to ANOTHER tenant never appears", async () => {
    // `awcms_blog_post_terms`' foreign keys are plain `REFERENCES ... (id)`,
    // NOT composite on `(tenant_id, id)` — so a row naming this tenant's post
    // while carrying another tenant's `tenant_id` is insertable at the database
    // level. It must not reach the feed, and the lookup's own `tenant_id`
    // predicate is what stops it rather than the foreign key.
    const terms = await seedTerms(1);
    const postId = await postIdBySlug("post-1");

    await getAdminSql()`
      INSERT INTO awcms_blog_post_terms (tenant_id, post_id, term_id)
      VALUES (${OTHER_TENANT}, ${postId}, ${terms[0]!})
    `;

    const page = await readFeed();
    const post = page.items.find((item) => item.slug === "post-1")!;

    expect(post.termIds).toEqual([]);
  });

  test("the classifications survive the cursor onto page two", async () => {
    const terms = await seedTerms(2);
    await assign(await postIdBySlug("post-6"), [terms[0]!]);
    await assign(await postIdBySlug("post-1"), [terms[1]!]);

    const first = await readFeed(3);
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();

    const runtime = getRuntimeSql();
    const second = await withTenantOrThrow(runtime, TENANT, (tx) =>
      listBlogPostsFullPage(tx, TENANT, {
        limit: 3,
        cursor: decodeKeysetCursor(first.nextCursor!)
      })
    );

    const all = [...first.items, ...second.items];
    const assigned = all.filter((item) => item.termIds.length > 0);

    // One on each page — a batched lookup wired only into the first page would
    // return an empty list here and nothing would fail.
    expect(assigned.map((item) => item.slug).sort()).toEqual([
      "post-1",
      "post-6"
    ]);
  });

  test("an empty page asks nothing and returns nothing", async () => {
    await getAdminSql()`
      UPDATE awcms_blog_posts SET deleted_at = now() WHERE tenant_id = ${TENANT}
    `;

    const page = await readFeed();

    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });
});
