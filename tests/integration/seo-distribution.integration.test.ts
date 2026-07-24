/**
 * Integration tests for `seo_distribution` (ADR-0038 discovery scope, migrations
 * sql/057 + sql/058 + sql/059) against a real PostgreSQL under the
 * ephemeral-database harness. These prove exactly the claims a typecheck cannot:
 *
 *   1. `awcms_seo_tenant_settings` is FORCE ROW LEVEL SECURITY, tenant isolated —
 *      proven under the non-superuser `awcms_app` LOGIN role: a direct SELECT with
 *      NO tenant context returns zero rows (fail-closed default GUC), and one
 *      tenant's context never sees another tenant's config row.
 *   2. A public discovery build (sitemap child page + RSS feed) returns a tenant's
 *      PUBLISHED blog facts — host server-derived from `awcms_tenant_domains`,
 *      canonical URLs absolute — and NEVER a draft/private post (the
 *      unpublished-content-leakage defense, end to end through the real
 *      `blog_content` seo-facts adapter + the discovery aggregator).
 *
 * Skipped unless a real database is configured (see tests/integration/harness.ts).
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
  appRoleActivated,
  getAdminSql,
  getAppRoleSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import {
  fetchSeoTenantSettings,
  updateSeoTenantSettings
} from "../../src/modules/seo-distribution/application/seo-config-directory";
import {
  buildFeedPayload,
  buildSitemapPagePayload,
  type SeoDiscoveryContext
} from "../../src/modules/seo-distribution/application/seo-discovery-service";
import { blogContentSeoFactsAdapter } from "../../src/modules/blog-content/application/seo-facts-port-adapter";
import { EMPTY_SEO_TENANT_SETTINGS } from "../../src/modules/seo-distribution/domain/seo-config";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-07-24T00:00:00.000Z");

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT_A}, 'tenant-a', 'Tenant A', 'active'),
      (${TENANT_B}, 'tenant-b', 'Tenant B', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedPrimaryDomain(
  tx: Bun.SQL,
  tenantId: string,
  host: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_tenant_domains
      (tenant_id, hostname, normalized_hostname, domain_type, status, is_primary)
    VALUES (${tenantId}, ${host}, ${host.toLowerCase()}, 'custom_domain', 'active', true)
  `;
}

async function seedBlogPost(
  tx: Bun.SQL,
  tenantId: string,
  opts: {
    slug: string;
    title: string;
    status: string;
    visibility: string;
    publishedAt: Date | null;
  }
): Promise<void> {
  await tx`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, published_at)
    VALUES (
      ${tenantId}, ${ACTOR}, ${opts.title}, ${opts.slug}, '{}'::jsonb, 'body',
      ${opts.status}, ${opts.visibility}, 'en', ${opts.publishedAt}
    )
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("seo_distribution module (integration)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedTenants();
  });

  test("config round-trip: write then read is tenant-scoped", async () => {
    const runtime = getRuntimeSql();
    const saved = await withTenant(runtime, TENANT_A, (tx) =>
      updateSeoTenantSettings(
        tx,
        TENANT_A,
        ACTOR,
        {
          ...EMPTY_SEO_TENANT_SETTINGS,
          siteName: "Tenant A Site",
          defaultRobotsNoindex: true,
          includedResourceTypes: ["blog_post"]
        },
        async () => {}
      )
    );
    expect(saved.siteName).toBe("Tenant A Site");
    expect(saved.defaultRobotsNoindex).toBe(true);

    const read = await withTenant(runtime, TENANT_A, (tx) =>
      fetchSeoTenantSettings(tx, TENANT_A)
    );
    expect(read.siteName).toBe("Tenant A Site");
    expect(read.includedResourceTypes).toEqual(["blog_post"]);

    // Tenant B has no row → the neutral default object, not tenant A's config.
    const readB = await withTenant(runtime, TENANT_B, (tx) =>
      fetchSeoTenantSettings(tx, TENANT_B)
    );
    expect(readB.siteName).toBeNull();
    expect(readB.defaultRobotsNoindex).toBe(false);
  });

  test("RLS FORCE: awcms_app cannot read seo_tenant_settings without tenant context, and never across tenants", async () => {
    if (!appRoleActivated) {
      // Without the awcms_app LOGIN role the FORCE-RLS proof is not meaningful
      // (the owner/superuser bypasses RLS unconditionally).
      return;
    }
    const runtime = getRuntimeSql();
    await withTenant(runtime, TENANT_A, (tx) =>
      updateSeoTenantSettings(
        tx,
        TENANT_A,
        ACTOR,
        { ...EMPTY_SEO_TENANT_SETTINGS, siteName: "A" },
        async () => {}
      )
    );

    const app = getAppRoleSql();
    // Fail-closed: no app.current_tenant_id set -> zero rows.
    const noContext = (await app`
      SELECT tenant_id FROM awcms_seo_tenant_settings
    `) as { tenant_id: string }[];
    expect(noContext).toHaveLength(0);

    // Tenant B's context sees none of tenant A's config.
    const asB = await withTenant(app, TENANT_B, async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS n FROM awcms_seo_tenant_settings
      `) as { n: number }[];
      return rows[0]!.n;
    });
    expect(asB).toBe(0);

    // Tenant A's own context DOES see its config.
    const asA = await withTenant(app, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS n FROM awcms_seo_tenant_settings
      `) as { n: number }[];
      return rows[0]!.n;
    });
    expect(asA).toBe(1);
  });

  test("public discovery build returns PUBLISHED blog facts (host-absolute) and never a draft", async () => {
    const runtime = getRuntimeSql();

    await withTenant(runtime, TENANT_A, async (tx) => {
      await seedPrimaryDomain(tx, TENANT_A, "example.com");
      await seedBlogPost(tx, TENANT_A, {
        slug: "public-post",
        title: "Public Post",
        status: "published",
        visibility: "public",
        publishedAt: new Date("2026-06-01T00:00:00.000Z")
      });
      // A draft and a private post that must NEVER appear in discovery output.
      await seedBlogPost(tx, TENANT_A, {
        slug: "draft-post",
        title: "Draft Post",
        status: "draft",
        visibility: "public",
        publishedAt: null
      });
      await seedBlogPost(tx, TENANT_A, {
        slug: "private-post",
        title: "Private Post",
        status: "published",
        visibility: "private",
        publishedAt: new Date("2026-06-01T00:00:00.000Z")
      });
    });

    const ctx = (tx: Bun.SQL): SeoDiscoveryContext => ({
      tx,
      tenantId: TENANT_A,
      tenantDisplayName: "Tenant A",
      defaultLocale: "en",
      providers: [blogContentSeoFactsAdapter],
      mediaLibrary: null,
      now: NOW
    });

    const sitemap = await withTenant(runtime, TENANT_A, (tx) =>
      buildSitemapPagePayload(ctx(tx), 1)
    );
    expect(sitemap).not.toBeNull();
    expect(sitemap!.contentType).toContain("application/xml");
    // The published post's absolute canonical URL is present.
    expect(sitemap!.body).toContain(
      "<loc>https://example.com/blog/public-post</loc>"
    );
    // The draft and private posts leak into nothing.
    expect(sitemap!.body).not.toContain("draft-post");
    expect(sitemap!.body).not.toContain("private-post");

    const rss = await withTenant(runtime, TENANT_A, (tx) =>
      buildFeedPayload(ctx(tx), "rss")
    );
    expect(rss).not.toBeNull();
    expect(rss!.contentType).toContain("application/rss+xml");
    expect(rss!.body).toContain("https://example.com/blog/public-post");
    expect(rss!.body).not.toContain("draft-post");
    expect(rss!.body).not.toContain("private-post");
  });

  test("no primary domain: sitemap/feed 404 (null), but discovery does not crash", async () => {
    const runtime = getRuntimeSql();
    await withTenant(runtime, TENANT_A, (tx) =>
      seedBlogPost(tx, TENANT_A, {
        slug: "orphan",
        title: "Orphan",
        status: "published",
        visibility: "public",
        publishedAt: new Date("2026-06-01T00:00:00.000Z")
      })
    );

    const ctx = (tx: Bun.SQL): SeoDiscoveryContext => ({
      tx,
      tenantId: TENANT_A,
      tenantDisplayName: "Tenant A",
      defaultLocale: "en",
      providers: [blogContentSeoFactsAdapter],
      mediaLibrary: null,
      now: NOW
    });

    // No verified primary host → a sitemap/feed's <loc>/<guid> MUST be absolute,
    // so the builders return null (the route maps that to a generic 404).
    const sitemap = await withTenant(runtime, TENANT_A, (tx) =>
      buildSitemapPagePayload(ctx(tx), 1)
    );
    expect(sitemap).toBeNull();

    const rss = await withTenant(runtime, TENANT_A, (tx) =>
      buildFeedPayload(ctx(tx), "rss")
    );
    expect(rss).toBeNull();
  });
});
