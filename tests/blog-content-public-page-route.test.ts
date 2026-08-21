/**
 * `/blog/{tenantCode}/pages/{slug}` — the public route for `awcms_blog_pages`
 * (Issue #594).
 *
 * Three properties, none of which a handler unit test would reach:
 *
 * 1. **A draft cannot leak.** The predicate is asserted on the SQL text, because
 *    the failure it guards against is a missing clause, and a missing clause is
 *    invisible to any test that only feeds the query rows it already filtered.
 * 2. **The route is gated like its six siblings.** `isLegacyTenantRouteEnabled`
 *    is the first statement inside the transaction in every existing public blog
 *    route; a new one that omits it serves content for tenants that switched the
 *    legacy family off, and nothing else in the repo would notice.
 * 3. **The three files that must agree about this path do agree.** The route
 *    exists, the edge cache declares it cacheable, and the i18n layer prefixes
 *    it — get any one of those wrong and the symptom is a cache serving one
 *    language to every reader, or a page that 404s only when the cache is on.
 *
 * Source assertions run over COMMENT-STRIPPED text. This repo has shipped a
 * source assertion that passed on a sentence in a docblock rather than on the
 * code it described.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { matchPublicCacheSurface } from "../src/lib/edge-cache/surface-registry";
import {
  buildHreflangAlternates,
  requiresPublicLocalePrefix,
  resolvePublicLocaleRoute
} from "../src/lib/i18n/public-locale-path";

const ROUTE = "src/pages/blog/[tenantCode]/pages/[slug].ts";
const DIRECTORY =
  "src/modules/blog-content/application/public-blog-directory.ts";
const SITEMAP = "src/pages/blog/[tenantCode]/sitemap-blog.xml.ts";

async function source(path: string): Promise<string> {
  return stripComments(await readFile(path, "utf8"));
}

/** Collapses whitespace so a multi-line SQL template can be matched as prose. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

describe("the public page query cannot serve an unpublished page", () => {
  test("the detail predicate carries every exclusion the post predicate does", async () => {
    const sql = flat(await source(DIRECTORY));
    const fetchBody = sql.slice(
      sql.indexOf("FROM awcms_blog_pages WHERE tenant_id")
    );

    // Proves the slice found something — an empty haystack would make every
    // `toContain` below pass while asserting nothing.
    expect(fetchBody.length).toBeGreaterThan(0);

    expect(fetchBody).toContain("status = 'published'");
    expect(fetchBody).toContain("visibility IN ('public', 'unlisted')");
    expect(fetchBody).toContain("deleted_at IS NULL");
    expect(fetchBody).toContain("published_at IS NOT NULL");
    expect(fetchBody).toContain("published_at <= now()");
  });

  test("the sitemap listing is strict `public`, so unlisted stays out of listings", async () => {
    const sql = flat(await source(DIRECTORY));
    const listBody = sql.slice(sql.indexOf("SELECT title, slug, locale"));

    expect(listBody.length).toBeGreaterThan(0);
    expect(listBody).toContain("visibility = 'public'");
    expect(listBody).not.toContain("visibility IN ('public', 'unlisted')");
    expect(listBody).toContain("status = 'published'");
    expect(listBody).toContain("deleted_at IS NULL");
    expect(listBody).toContain("published_at <= now()");
  });

  test("the sitemap emits page URLs under the reserved segment", async () => {
    const sitemap = await source(SITEMAP);

    expect(sitemap).toContain("listPublicBlogPagesForSitemap");
    expect(sitemap).toContain("${channelPath}/pages/${page.slug}");
  });
});

describe("the route is gated like every other public blog route", () => {
  test("`isLegacyTenantRouteEnabled` is the first statement in the transaction", async () => {
    const route = await source(ROUTE);
    const transactionStart = route.indexOf("async (tx) => {");

    expect(transactionStart).toBeGreaterThan(-1);

    const afterOpen = route.slice(transactionStart + "async (tx) => {".length);
    const firstStatement = afterOpen.trim().split("\n")[0] ?? "";

    expect(firstStatement).toContain("isLegacyTenantRouteEnabled");
  });

  test("every not-found reason answers with the same generic 404", async () => {
    const route = await source(ROUTE);

    // Missing param, unknown tenant, legacy family off, no such page: four
    // distinguishable reasons, one indistinguishable answer. A route that
    // differentiated them would confirm which tenants exist to anyone asking.
    expect(route.split("notFoundHtmlResponse()").length - 1).toBe(4);
    expect(route).toContain("serverErrorHtmlResponse()");
    expect(route).not.toContain("error.stack");
  });

  test("the body is rendered through the whitelist renderer, never raw", async () => {
    const route = await source(ROUTE);

    expect(route).toContain("renderContentJsonToHtml(");
    expect(route).not.toContain("set:html");
    expect(route).not.toContain("page.contentText}");
  });

  test("an unlisted page renders noindex", async () => {
    const route = await source(ROUTE);

    expect(route).toContain("resolveRobotsMetaContent(page.visibility)");
  });
});

describe("the cache and the locale layer agree about this path", () => {
  const PATH = "/blog/acme/pages/pedoman-media-siber";

  test("the path is a declared cacheable surface", () => {
    expect(matchPublicCacheSurface(PATH)?.key).toBe("blog-page");
  });

  test("it is locale-prefixed, like every other page a human reads", () => {
    expect(requiresPublicLocalePrefix(PATH)).toBe(true);
    expect(matchPublicCacheSurface(PATH)?.localePrefixed).toBe(true);
    expect(resolvePublicLocaleRoute(PATH).action).toBe("redirect");
    expect(resolvePublicLocaleRoute(`/id${PATH}`)).toMatchObject({
      action: "serve",
      locale: "id",
      servePathname: PATH
    });
  });

  test("its hreflang set names the prefixed spellings, not the bare alias", () => {
    const alternates = buildHreflangAlternates(PATH, "id");

    expect(alternates.map((alternate) => alternate.pathname)).toContain(
      `/id${PATH}`
    );
    expect(
      alternates.find((alternate) => alternate.hreflang === "x-default")
        ?.pathname
    ).toBe(`/id${PATH}`);
  });

  test("the surface does not widen into anything deeper or into admin", () => {
    // `[^/]+` rather than `.*` is the whole reason these hold.
    expect(matchPublicCacheSurface("/blog/acme/pages/a/b")).toBeNull();
    expect(matchPublicCacheSurface("/blog/acme/pages")).not.toMatchObject({
      key: "blog-page"
    });
    expect(matchPublicCacheSurface("/blog/../admin/pages/x")).toBeNull();
    expect(matchPublicCacheSurface("/blog/%2e%2e/pages/x")).toBeNull();
  });
});
