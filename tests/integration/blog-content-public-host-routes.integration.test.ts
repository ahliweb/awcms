/**
 * Integration tests for the HOST-RESOLVED public content family `/news/**`
 * (ADR-0059) against a real PostgreSQL under the ephemeral-database harness.
 * These prove what a typecheck and the pure base-path test cannot:
 *
 *   1. **The gate resolves by host, and only by host.** A request whose `Host`
 *      maps to tenant A's verified domain serves tenant A's content; an unknown
 *      host, a `blog_content` disabled for that tenant, and a tenant that
 *      switched `publicRouteMode` to `disabled` all produce the SAME `null` the
 *      routes turn into one generic 404.
 *   2. **Cross-tenant isolation.** Tenant A's host never resolves tenant B's
 *      post, even when both tenants publish the identical slug.
 *   3. **The never-advertise-a-404 invariant (ADR-0059 §C), end to end.** The
 *      `<loc>` a sitemap emits for a tenant is fetched back through the SAME
 *      gate and functions the `/news/{slug}` route uses, and it resolves to the
 *      post. Flip the tenant to `disabled` and the sitemap switches to the
 *      ADR-0009 base path, which the legacy resolver then resolves. Switch BOTH
 *      families off and the sitemap carries no content URL at all.
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../src/lib/tenant/public-tenant-resolver";
import { createBlogTerm } from "../../src/modules/blog-content/application/blog-taxonomy-directory";
import {
  fetchPublicBlogPostBySlug,
  fetchPublicTermBySlug,
  listPublicBlogPostsByTermId
} from "../../src/modules/blog-content/application/public-blog-directory";
import { withHostResolvedBlogTenant } from "../../src/modules/blog-content/application/public-host-route-tenant-resolution";
import { isLegacyTenantRouteEnabled } from "../../src/modules/blog-content/application/public-route-settings";
import { updateModuleSettings } from "../../src/modules/module-management/application/module-settings";
import { disableTenantModule } from "../../src/modules/module-management/application/tenant-module-lifecycle";
import { buildSitemapPagePayload } from "../../src/modules/seo-distribution/application/seo-discovery-service";
import { resolveEnabledSeoProviders } from "../../src/modules/seo-distribution/presentation/discovery-providers";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOST_A = "tenant-a.example.com";
const HOST_B = "tenant-b.example.com";
const NOW = new Date("2026-08-03T00:00:00.000Z");
const PUBLISHED_AT = new Date("2026-06-01T00:00:00.000Z");

/** Host-based resolution — the mode the whole family is written for (ADR-0010). */
const HOST_ENV = {
  PUBLIC_TENANT_RESOLUTION_MODE: "host_default"
} as NodeJS.ProcessEnv;

function requestFor(host: string, path: string): Request {
  return new Request(`https://${host}${path}`, { headers: { host } });
}

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
    VALUES (${tenantId}, ${host}, ${host}, 'custom_domain', 'active', true)
  `;
}

async function seedPost(
  tx: Bun.SQL,
  tenantId: string,
  slug: string,
  title: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, published_at)
    VALUES (
      ${tenantId}, ${ACTOR}, ${title}, ${slug}, '{}'::jsonb, 'body',
      'published', 'public', 'en', ${PUBLISHED_AT}
    )
  `;
}

/** The `<loc>` paths a sitemap would carry for this tenant, host stripped. */
async function sitemapContentPaths(tenantId: string): Promise<string[]> {
  const runtime = getRuntimeSql();

  return withTenantOrThrow(runtime, tenantId, async (tx) => {
    const { providers, mediaLibrary } = await resolveEnabledSeoProviders(
      tx as Bun.TransactionSQL,
      tenantId,
      tenantId === TENANT_A ? "tenant-a" : "tenant-b"
    );

    const payload = await buildSitemapPagePayload(
      {
        tx,
        tenantId,
        tenantDisplayName: "Tenant A",
        defaultLocale: "en",
        providers,
        mediaLibrary,
        now: NOW
      },
      1
    );

    if (!payload) {
      return [];
    }

    return [...payload.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]!).pathname
    );
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "blog_content host-resolved public routes (integration, ADR-0059)",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });
    afterAll(async () => {
      await teardownIntegrationDatabase();
    });
    beforeEach(async () => {
      await resetDatabase();
      await seedTenants();

      const runtime = getRuntimeSql();
      await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
        await seedPrimaryDomain(tx, TENANT_A, HOST_A);
        await seedPost(tx, TENANT_A, "hello-world", "Hello World");
      });
      await withTenantOrThrow(runtime, TENANT_B, async (tx) => {
        await seedPrimaryDomain(tx, TENANT_B, HOST_B);
        // The SAME slug in the other tenant — the cross-tenant probe below is
        // meaningless without it.
        await seedPost(tx, TENANT_B, "hello-world", "Tenant B's Hello World");
      });
    });

    test("a verified host serves that tenant's post, and only that tenant's", async () => {
      const runtime = getRuntimeSql();

      const fromA = await withHostResolvedBlogTenant(
        runtime,
        requestFor(HOST_A, "/news/hello-world"),
        async (tx, tenant) => {
          const post = await fetchPublicBlogPostBySlug(
            tx,
            tenant.tenantId,
            "hello-world"
          );
          return { tenantId: tenant.tenantId, title: post?.title ?? null };
        },
        HOST_ENV
      );

      expect(fromA).toEqual({ tenantId: TENANT_A, title: "Hello World" });

      const fromB = await withHostResolvedBlogTenant(
        runtime,
        requestFor(HOST_B, "/news/hello-world"),
        async (tx, tenant) => {
          const post = await fetchPublicBlogPostBySlug(
            tx,
            tenant.tenantId,
            "hello-world"
          );
          return { tenantId: tenant.tenantId, title: post?.title ?? null };
        },
        HOST_ENV
      );

      expect(fromB).toEqual({
        tenantId: TENANT_B,
        title: "Tenant B's Hello World"
      });
    });

    test("an unknown host resolves nothing (no default-tenant guess leaks in)", async () => {
      const result = await withHostResolvedBlogTenant(
        getRuntimeSql(),
        requestFor("stranger.example.net", "/news/hello-world"),
        async () => "served",
        // No PUBLIC_DEFAULT_TENANT_* set: the fallback chain has nothing to fall
        // back to, which is the deployment shape this family is used in.
        HOST_ENV
      );

      expect(result).toBeNull();
    });

    test("blog_content disabled for the tenant -> the same null, not a different error", async () => {
      const runtime = getRuntimeSql();

      await withTenantOrThrow(runtime, TENANT_A, (tx) =>
        disableTenantModule(tx, TENANT_A, "blog_content", ACTOR, "test")
      );

      const result = await withHostResolvedBlogTenant(
        runtime,
        requestFor(HOST_A, "/news/hello-world"),
        async () => "served",
        HOST_ENV
      );

      expect(result).toBeNull();
    });

    test("publicRouteMode: disabled -> the same null, while the legacy family stays up", async () => {
      const runtime = getRuntimeSql();

      await withTenantOrThrow(runtime, TENANT_A, (tx) =>
        updateModuleSettings(
          tx,
          TENANT_A,
          "blog_content",
          { publicRouteMode: "disabled" },
          ACTOR
        )
      );

      const result = await withHostResolvedBlogTenant(
        runtime,
        requestFor(HOST_A, "/news/hello-world"),
        async () => "served",
        HOST_ENV
      );

      expect(result).toBeNull();

      // The two switches are independent: turning the host-resolved family off
      // must not take `/blog/{tenantCode}` down with it.
      const legacyStillLive = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
        isLegacyTenantRouteEnabled(tx, TENANT_A)
      );
      expect(legacyStillLive).toBe(true);
    });

    test("a term archive resolves through the same gate", async () => {
      const runtime = getRuntimeSql();

      await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
        const term = await createBlogTerm(tx, TENANT_A, {
          taxonomyType: "tag",
          parentId: null,
          name: "Releases",
          slug: "releases",
          description: null
        });
        const posts = (await tx`
        SELECT id FROM awcms_blog_posts WHERE tenant_id = ${TENANT_A}
      `) as { id: string }[];
        await tx`
        INSERT INTO awcms_blog_post_terms (tenant_id, post_id, term_id)
        VALUES (${TENANT_A}, ${posts[0]!.id}, ${term.id})
      `;
      });

      const titles = await withHostResolvedBlogTenant(
        runtime,
        requestFor(HOST_A, "/news/tag/releases"),
        async (tx, tenant) => {
          const term = await fetchPublicTermBySlug(
            tx,
            tenant.tenantId,
            "tag",
            "releases"
          );
          if (!term) return null;
          const page = await listPublicBlogPostsByTermId(
            tx,
            tenant.tenantId,
            term.id,
            { page: 1 }
          );
          return page.items.map((item) => item.title);
        },
        HOST_ENV
      );

      expect(titles).toEqual(["Hello World"]);
    });

    test("INVARIANT: the URL the sitemap advertises is the URL that serves", async () => {
      // Default state — the host-resolved family is live.
      const hostPaths = await sitemapContentPaths(TENANT_A);
      expect(hostPaths).toEqual(["/news/hello-world"]);

      // Fetch the advertised path back through the gate the `/news/{slug}` route
      // uses. A 404 for a crawler would show up here as a null post.
      const slug = hostPaths[0]!.slice("/news/".length);
      const served = await withHostResolvedBlogTenant(
        getRuntimeSql(),
        requestFor(HOST_A, hostPaths[0]!),
        (tx, tenant) => fetchPublicBlogPostBySlug(tx, tenant.tenantId, slug),
        HOST_ENV
      );
      expect(served?.slug).toBe("hello-world");
    });

    test("INVARIANT: host family off -> the sitemap falls back to the path-scoped URL, which resolves", async () => {
      const runtime = getRuntimeSql();
      await withTenantOrThrow(runtime, TENANT_A, (tx) =>
        updateModuleSettings(
          tx,
          TENANT_A,
          "blog_content",
          { publicRouteMode: "disabled" },
          ACTOR
        )
      );

      expect(await sitemapContentPaths(TENANT_A)).toEqual([
        "/blog/tenant-a/hello-world"
      ]);

      // And that URL is served by the legacy resolver, path-based and
      // host-independent.
      const tenant = await resolvePublicTenantByCode(runtime, "tenant-a");
      expect(tenant?.tenantId).toBe(TENANT_A);

      const post = await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
        expect(await isLegacyTenantRouteEnabled(tx, TENANT_A)).toBe(true);
        return fetchPublicBlogPostBySlug(tx, TENANT_A, "hello-world");
      });
      expect(post?.slug).toBe("hello-world");
    });

    test("INVARIANT: both families off -> the sitemap advertises no content URL at all", async () => {
      const runtime = getRuntimeSql();
      await withTenantOrThrow(runtime, TENANT_A, (tx) =>
        updateModuleSettings(
          tx,
          TENANT_A,
          "blog_content",
          { publicRouteMode: "disabled", legacyTenantRouteEnabled: false },
          ACTOR
        )
      );

      // Not "a sitemap of broken links" and not a crash: no content URLs.
      expect(await sitemapContentPaths(TENANT_A)).toEqual([]);
    });
  }
);
