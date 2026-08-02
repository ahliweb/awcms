/**
 * `?locale=` on `GET /api/v1/blog/posts` against a real PostgreSQL — awcms-astro
 * ADR-0021 §2.
 *
 * ## Why this needs a database
 *
 * The failure mode of a parsed-but-unused query parameter is that everything
 * looks right: the parser accepts it, the route passes it, the response is 200,
 * and the caller gets every locale it was trying to exclude. A pure test over
 * `URLSearchParams` proves the parameter is *read*; only a real query proves it
 * *filters*. That gap is the entire risk here, and it is the same shape as the
 * `view=full` defect this endpoint already shipped once — a contract promising
 * one thing while the query returned another, with nothing failing anywhere.
 *
 * So all THREE list functions are exercised, because the route picks between
 * them by `view`/`order` and a filter wired into two of three would be invisible
 * until someone changed a query string.
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
  listBlogPosts,
  listBlogPostsFullPage,
  listBlogPostsPage
} from "../../src/modules/blog-content/application/blog-post-directory";

const TENANT = "f2222222-2222-4222-8222-222222222222";
const AUTHOR = "f2000000-0000-4000-8000-000000000001";

/** Deliberately uneven, so a filter that returns everything cannot pass by luck. */
const COUNTS: Record<string, number> = { id: 7, en: 4, "en-GB": 2 };
const TOTAL = Object.values(COUNTS).reduce((sum, n) => sum + n, 0);

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'locale-tenant', 'Locale Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'locale@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;

  for (const [locale, count] of Object.entries(COUNTS)) {
    // The slug is unique per `(tenant_id, locale, slug)`, so the same slug in
    // two locales is legal and is what a translated post actually looks like.
    await admin`
      INSERT INTO awcms_blog_posts
        (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
         status, visibility, locale)
      SELECT ${TENANT}, ${AUTHOR}, ${locale} || ' post ' || n, 'post-' || n,
             '{}'::jsonb, '', 'published', 'public', ${locale}
      FROM generate_series(1, ${count}) AS n
    `;
  }
}

const suite = integrationEnabled ? describe : describe.skip;

suite("blog post locale filter", () => {
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

  test("the admin listing filters by locale, and without one returns every locale", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      const all = await listBlogPosts(tx, TENANT, { limit: 100 });
      expect(all).toHaveLength(TOTAL);

      for (const [locale, count] of Object.entries(COUNTS)) {
        const filtered = await listBlogPosts(tx, TENANT, {
          locale,
          limit: 100
        });

        expect(filtered).toHaveLength(count);
        expect(filtered.every((post) => post.locale === locale)).toBe(true);
      }
    });
  });

  test("`en` does not match `en-GB` — this is an exact match, not a prefix", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      const en = await listBlogPosts(tx, TENANT, { locale: "en", limit: 100 });

      // A `LIKE 'en%'` implementation would return 6 here and look correct
      // until someone published a `en-GB` variant they did not want served.
      expect(en).toHaveLength(COUNTS.en!);
      expect(en.every((post) => post.locale === "en")).toBe(true);
    });
  });

  test("the stable traversal filters too, and its cursor stays within the locale", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      const seen: string[] = [];
      let cursor = undefined;

      for (let guard = 0; guard < 20; guard += 1) {
        const page = await listBlogPostsPage(tx, TENANT, {
          locale: "id",
          limit: 3,
          cursor
        });

        expect(page.items.every((post) => post.locale === "id")).toBe(true);
        seen.push(...page.items.map((post) => post.id));

        if (!page.nextCursor) break;
        cursor = decodeKeysetCursor(page.nextCursor)!;
      }

      // Paging must not leak other locales in at a page boundary — the failure
      // a filter applied to the first query but not the cursor's would produce.
      expect(seen).toHaveLength(COUNTS.id!);
      expect(new Set(seen).size).toBe(COUNTS.id!);
    });
  });

  test("the build feed (view=full) filters too — the case this exists for", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      const page = await listBlogPostsFullPage(tx, TENANT, {
        locale: "en",
        limit: 50
      });

      expect(page.items).toHaveLength(COUNTS.en!);
      expect(page.items.every((post) => post.locale === "en")).toBe(true);

      // Full rows, not summaries — filtering must not have quietly changed the
      // projection the build depends on.
      expect(page.items[0]!.contentJson).toBeDefined();
    });
  });

  test("a locale nobody published returns an empty page, not everything", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      expect(
        await listBlogPosts(tx, TENANT, { locale: "fr", limit: 100 })
      ).toEqual([]);

      const page = await listBlogPostsFullPage(tx, TENANT, { locale: "fr" });
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });
  });

  test("locale composes with status rather than replacing it", async () => {
    await getAdminSql()`
      UPDATE awcms_blog_posts SET status = 'draft'
      WHERE tenant_id = ${TENANT} AND locale = 'en' AND slug = 'post-1'
    `;

    await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      const published = await listBlogPosts(tx, TENANT, {
        locale: "en",
        status: "published",
        limit: 100
      });
      const drafts = await listBlogPosts(tx, TENANT, {
        locale: "en",
        status: "draft",
        limit: 100
      });

      expect(published).toHaveLength(COUNTS.en! - 1);
      expect(drafts).toHaveLength(1);
      // And the draft in another locale is not swept in by the status filter.
      expect(drafts[0]!.locale).toBe("en");
    });
  });
});
