/**
 * Three round trips the request path paid for and threw away — findings B2, B3
 * and B4 of the 17 August 2026 audit round.
 *
 * They are one PR because they are one habit: a caller re-derives something the
 * caller above it already had. What they cost individually is small; what makes
 * them worth a test is that each is invisible to every other kind of check —
 * the page renders, the feed validates, the assertions pass, and the only
 * evidence is a query nobody needed.
 *
 * ## B2, and it was worse than the finding said
 *
 * `isLegacyTenantRouteEnabled` went through the merged settings reader, which
 * also reads `awcms_blog_settings` and then discards that row. One wasted round
 * trip on every anonymous page view of all seven `/blog/{tenantCode}/*` routes —
 * 100% of them on a default deployment, where the edge cache is off.
 *
 * **Two of the seven paid for it twice.** `feed.xml.ts` and
 * `sitemap-blog.xml.ts` call `isLegacyTenantRouteEnabled` and then call
 * `fetchBlogSettings` themselves for `rssEnabled`/`sitemapEnabled`. So
 * `awcms_blog_settings` was read, discarded, and read again.
 *
 * ## B3 — the tenant id the route resolved and dropped
 *
 * Asserted as source placement rather than behaviour, and deliberately so: the
 * rule in `publish-tenant.ts` is about WHERE the call sits, not what it
 * returns. Publishing before the missing-resource branch would annotate a
 * "no such post" 404 differently from an "unknown tenant" 404, answering from a
 * single request the question the routes' generic-404 shape exists to withhold.
 * A behavioural test sees a cache header; only placement sees the disclosure.
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
import { stripComments } from "../../scripts/lib/source-text";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  fetchEffectivePublicRouteSettings,
  isLegacyTenantRouteEnabled
} from "../../src/modules/blog-content/application/public-route-settings";

const TENANT = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";

const BLOG_ROUTES = [
  "src/pages/blog/[tenantCode]/index.ts",
  "src/pages/blog/[tenantCode]/search.ts",
  "src/pages/blog/[tenantCode]/feed.xml.ts",
  "src/pages/blog/[tenantCode]/sitemap-blog.xml.ts",
  "src/pages/blog/[tenantCode]/category/[slug].ts",
  "src/pages/blog/[tenantCode]/tag/[slug].ts",
  "src/pages/blog/[tenantCode]/pages/[slug].ts",
  "src/pages/blog/[tenantCode]/[slug].ts"
];

async function seed(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'b2-reads', 'B2 Reads', 'active')
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("wasted reads on the public and admin paths", () => {
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

  test("B2: the gate every /blog route calls costs ONE query", async () => {
    const { result, queries } = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      (tx) =>
        countQueries(tx, (counting) =>
          isLegacyTenantRouteEnabled(counting, TENANT)
        ),
      { workClass: "interactive" }
    );

    // It used to be two: the module settings row it uses, and the blog settings
    // row it threw away.
    expect(queries).toBe(1);
    // NON-VACUOUS: the answer is still the answer, not a short-circuit.
    expect(result).toBe(true);
  });

  test("B2: the MERGED reader still reads both, because it uses both", async () => {
    // The saving must come from the narrow caller, not from the merged reader
    // quietly dropping a field somebody depends on.
    const { result, queries } = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      (tx) =>
        countQueries(tx, (counting) =>
          fetchEffectivePublicRouteSettings(counting, TENANT)
        ),
      { workClass: "interactive" }
    );

    expect(queries).toBe(2);
    expect(result.legacyTenantRouteEnabled).toBe(true);
    expect(typeof result.rssEnabled).toBe("boolean");
    expect(typeof result.sitemapEnabled).toBe("boolean");
  });

  test("B3: every /blog route publishes its tenant, and only on the serving path", async () => {
    for (const route of BLOG_ROUTES) {
      const source = await Bun.file(route).text();

      const publishAt = source.indexOf("publishEdgeCacheTenant(locals,");
      expect(publishAt).toBeGreaterThan(-1);

      // The rule from `publish-tenant.ts`: resolve, gate, produce, publish LAST.
      // Every 404 branch must be above it, and the one response that serves the
      // resource below it.
      const lastNotFound = Math.max(
        source.lastIndexOf("return notFoundHtmlResponse()"),
        source.lastIndexOf("return notFoundXmlResponse()")
      );
      const serves = source.lastIndexOf("return new Response(");

      expect(lastNotFound).toBeGreaterThan(-1);
      expect(serves).toBeGreaterThan(-1);
      expect(publishAt).toBeGreaterThan(lastNotFound);
      expect(publishAt).toBeLessThan(serves);
    }
  });

  test("B4: the admin layout no longer opens a transaction for one column", async () => {
    // Comments stripped FIRST. Both this file's B4 assertions failed on their
    // first run by matching the corrective comment that explains the removal —
    // which is finding D2 in miniature, caught by the shared stripper D2 landed.
    const layout = stripComments(
      await Bun.file("src/layouts/AdminLayout.astro").text()
    );

    // The exact statement it used to run, on every `/admin/*` render, against a
    // row `readTenantDisplayDefaults` already had open one transaction earlier.
    expect(layout).not.toContain("SELECT tenant_name FROM awcms_tenants");
    expect(layout).toContain("ssr.display.tenantName");
  });

  test("B4: the session's single tenant read carries all three columns", async () => {
    // One primary-key read, three columns. The alternative this replaced was
    // two reads of the same row in two different transactions.
    const source = stripComments(
      await Bun.file("src/lib/auth/ssr-session.ts").text()
    );
    const query = source.slice(
      source.indexOf("async function readTenantDisplayDefaults"),
      source.indexOf("export const SESSION_COOKIE_NAME")
    );

    expect(query).toContain(
      "SELECT default_locale, default_theme, tenant_name"
    );
    expect((query.match(/FROM awcms_tenants/g) ?? []).length).toBe(1);
  });

  test("B4: a circuit-open render still falls back rather than showing `undefined`", async () => {
    // The shape check in the layout keyed on `tenantName`, which this change
    // moved to the session. Keying on a field the block no longer returns would
    // test for something never present and silently skip every assignment —
    // sync indicator, disabled modules, sidebar arrangement, all of it.
    const layout = stripComments(
      await Bun.file("src/layouts/AdminLayout.astro").text()
    );

    expect(layout).toContain('"syncActive" in chrome');
    expect(layout).not.toContain('"tenantName" in chrome');
    expect(layout).toContain('ssr.display.tenantName?.trim() || "Tenant"');
  });
});
