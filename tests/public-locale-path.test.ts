/**
 * ADR-0098 — the cache key carries the locale, and it carries it in the PATH.
 *
 * Pure: no database, no network, no filesystem. Every assertion here is about a
 * string going in and a decision coming out, which is the property the ADR's
 * security argument rests on — if this file ever needs a request to make its
 * assertions, a header has entered the cache key.
 */
import { describe, expect, test } from "bun:test";

import {
  decideCacheability,
  variesOnForbiddenHeader
} from "../src/lib/edge-cache/cacheability";
import { loadEdgeCacheConfig } from "../src/lib/edge-cache/config";
import {
  PUBLIC_CACHE_SURFACES,
  matchPublicCacheSurface
} from "../src/lib/edge-cache/surface-registry";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locales";
import {
  buildHreflangAlternates,
  buildLocalisedPublicUrls,
  carryLocaleThroughRedirect,
  requiresPublicLocalePrefix,
  resolvePublicLocaleRoute,
  splitPublicLocalePath,
  stripPublicLocalePrefix,
  withPublicLocalePrefix
} from "../src/lib/i18n/public-locale-path";

describe("splitPublicLocalePath", () => {
  test("splits a supported locale segment off the front", () => {
    expect(splitPublicLocalePath("/id/blog/acme")).toEqual({
      locale: "id",
      pathname: "/blog/acme"
    });
    expect(splitPublicLocalePath("/en/blog/acme/my-post")).toEqual({
      locale: "en",
      pathname: "/blog/acme/my-post"
    });
  });

  test("a bare locale is the site root in that locale", () => {
    expect(splitPublicLocalePath("/id")).toEqual({
      locale: "id",
      pathname: "/"
    });
  });

  test("leaves a path with no locale segment untouched", () => {
    expect(splitPublicLocalePath("/blog/acme")).toEqual({
      locale: null,
      pathname: "/blog/acme"
    });
  });

  /**
   * The failure this guards is a tenant code or slug that merely STARTS with a
   * locale. Stripping `/entrepreneurship` down to `trepreneurship` would 404 a
   * real page, and the 404 would look like missing content rather than a
   * routing bug.
   */
  test("only strips a WHOLE segment, never a prefix of one", () => {
    expect(splitPublicLocalePath("/entrepreneurship/blog")).toEqual({
      locale: null,
      pathname: "/entrepreneurship/blog"
    });
    expect(splitPublicLocalePath("/blog/indonesia/post")).toEqual({
      locale: null,
      pathname: "/blog/indonesia/post"
    });
    expect(splitPublicLocalePath("/ends")).toEqual({
      locale: null,
      pathname: "/ends"
    });
  });

  test("an unsupported language segment is not a locale", () => {
    expect(splitPublicLocalePath("/es/blog/acme").locale).toBeNull();
    expect(splitPublicLocalePath("/fr/blog/acme").locale).toBeNull();
  });
});

describe("withPublicLocalePrefix", () => {
  test("prefixes a bare path", () => {
    expect(withPublicLocalePrefix("/blog/acme", "id")).toBe("/id/blog/acme");
  });

  /**
   * Decision 4 allows exactly one canonical URL per (resource, locale).
   * `/id/en/blog/acme` would be a second name for one document, so prefixing is
   * a REPLACE rather than a push.
   */
  test("replaces an existing prefix instead of nesting one", () => {
    expect(withPublicLocalePrefix("/en/blog/acme", "id")).toBe("/id/blog/acme");
    expect(
      withPublicLocalePrefix(withPublicLocalePrefix("/blog/a", "en"), "en")
    ).toBe("/en/blog/a");
  });

  test("round-trips with the splitter for every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const prefixed = withPublicLocalePrefix("/blog/acme/post", locale);

      expect(splitPublicLocalePath(prefixed)).toEqual({
        locale,
        pathname: "/blog/acme/post"
      });
      expect(stripPublicLocalePrefix(prefixed)).toBe("/blog/acme/post");
    }
  });
});

describe("requiresPublicLocalePrefix", () => {
  test("the HTML blog surfaces are prefixed", () => {
    expect(requiresPublicLocalePrefix("/blog/acme")).toBe(true);
    expect(requiresPublicLocalePrefix("/blog/acme/my-post")).toBe(true);
    expect(requiresPublicLocalePrefix("/blog/acme/category/news")).toBe(true);
    expect(requiresPublicLocalePrefix("/blog/acme/tag/launch")).toBe(true);
  });

  /**
   * Machine surfaces and `private, no-store` surfaces are NOT prefixed, each
   * for a reason stated in the module header. `robots.txt` is the sharpest: a
   * crawler will not follow a redirect to find it.
   */
  test("machine and uncacheable surfaces are not", () => {
    expect(requiresPublicLocalePrefix("/robots.txt")).toBe(false);
    expect(requiresPublicLocalePrefix("/sitemap.xml")).toBe(false);
    expect(requiresPublicLocalePrefix("/feed.xml")).toBe(false);
    expect(requiresPublicLocalePrefix("/blog/acme/feed.xml")).toBe(false);
    expect(requiresPublicLocalePrefix("/blog/acme/sitemap-blog.xml")).toBe(
      false
    );
    expect(requiresPublicLocalePrefix("/blog/acme/search")).toBe(false);
    expect(requiresPublicLocalePrefix("/admin/users")).toBe(false);
    expect(requiresPublicLocalePrefix("/login")).toBe(false);
  });

  test("answers for the RESOURCE, so a prefixed spelling agrees", () => {
    expect(requiresPublicLocalePrefix("/id/blog/acme")).toBe(true);
    expect(requiresPublicLocalePrefix("/en/robots.txt")).toBe(false);
  });
});

describe("resolvePublicLocaleRoute", () => {
  test("a prefixed URL serves, and the PATH names the locale", () => {
    const route = resolvePublicLocaleRoute("/id/blog/acme/my-post");

    expect(route.action).toBe("serve");

    if (route.action !== "serve") {
      throw new Error("expected serve");
    }

    expect(route.locale).toBe("id");
    expect(route.servePathname).toBe("/blog/acme/my-post");
  });

  test("a bare URL redirects, and the caller supplies the locale", () => {
    const route = resolvePublicLocaleRoute("/blog/acme");

    expect(route.action).toBe("redirect");

    if (route.action !== "redirect") {
      throw new Error("expected redirect");
    }

    expect(route.target("id")).toBe("/id/blog/acme");
    expect(route.target("en")).toBe("/en/blog/acme");
  });

  test("everything else is ignored, prefixed or not", () => {
    expect(resolvePublicLocaleRoute("/robots.txt").action).toBe("ignore");
    expect(resolvePublicLocaleRoute("/admin/users").action).toBe("ignore");
    expect(resolvePublicLocaleRoute("/api/v1/health").action).toBe("ignore");
    // A prefixed spelling of a non-prefixed surface is simply not a URL this
    // site has — it must not be quietly accepted as a second name for one.
    expect(resolvePublicLocaleRoute("/en/robots.txt").action).toBe("ignore");
    expect(resolvePublicLocaleRoute("/id/blog/acme/search").action).toBe(
      "ignore"
    );
  });
});

describe("carryLocaleThroughRedirect", () => {
  test("carries the reader's locale onto an internal prefixed target", () => {
    expect(carryLocaleThroughRedirect("/blog/acme/new-slug", "id")).toBe(
      "/id/blog/acme/new-slug"
    );
  });

  test("preserves query and fragment", () => {
    expect(carryLocaleThroughRedirect("/blog/acme?page=2", "id")).toBe(
      "/id/blog/acme?page=2"
    );
    expect(carryLocaleThroughRedirect("/blog/acme#top", "en")).toBe(
      "/en/blog/acme#top"
    );
  });

  /**
   * A rule pointing at another host is a deliberate exit from this site, and a
   * protocol-relative `//evil.test/x` is an ABSOLUTE URL wearing a path's
   * clothing — rewriting either would be this middleware inventing a URL on
   * somebody else's origin.
   */
  test("never touches an off-site target", () => {
    expect(carryLocaleThroughRedirect("https://elsewhere.test/x", "id")).toBe(
      "https://elsewhere.test/x"
    );
    expect(carryLocaleThroughRedirect("//elsewhere.test/x", "id")).toBe(
      "//elsewhere.test/x"
    );
  });

  test("leaves a target with no prefixed spelling alone", () => {
    expect(carryLocaleThroughRedirect("/robots.txt", "id")).toBe("/robots.txt");
    expect(carryLocaleThroughRedirect("/blog/acme/search", "id")).toBe(
      "/blog/acme/search"
    );
  });

  test("no locale means no rewrite", () => {
    expect(carryLocaleThroughRedirect("/blog/acme", null)).toBe("/blog/acme");
  });
});

describe("buildHreflangAlternates", () => {
  test("one entry per locale plus x-default", () => {
    const alternates = buildHreflangAlternates("/blog/acme/post", "id");

    expect(alternates.map((entry) => entry.hreflang)).toEqual([
      ...SUPPORTED_LOCALES,
      "x-default"
    ]);
  });

  /**
   * Decision 5. Pointing `x-default` at the bare alias would let the crawler's
   * own `Accept-Language` decide which document it indexes as the default —
   * header-driven variation reintroduced one layer up from the cache.
   */
  test("x-default names the tenant default's PREFIXED URL, not the alias", () => {
    const alternates = buildHreflangAlternates("/blog/acme/post", "id");
    const xDefault = alternates.find((entry) => entry.hreflang === "x-default");

    expect(xDefault?.pathname).toBe("/id/blog/acme/post");
    expect(
      alternates.every(
        (entry) =>
          entry.pathname.startsWith("/en/") || entry.pathname.startsWith("/id/")
      )
    ).toBe(true);
  });

  test("a non-prefixed surface has no alternates at all", () => {
    expect(buildHreflangAlternates("/robots.txt")).toEqual([]);
  });
});

describe("buildLocalisedPublicUrls", () => {
  test("canonical is the PREFIXED URL for the rendering locale", () => {
    const urls = buildLocalisedPublicUrls(
      "https://acme.test",
      "/blog/acme/post",
      "id",
      "en"
    );

    expect(urls.canonicalUrl).toBe("https://acme.test/id/blog/acme/post");
    expect(urls.basePath).toBe("/id/blog/acme/post");
    expect(
      urls.hreflangAlternates.find((entry) => entry.hreflang === "x-default")
        ?.href
    ).toBe("https://acme.test/en/blog/acme/post");
  });
});

describe("the surface registry and the path patterns agree", () => {
  /**
   * The two files decide `localePrefixed` with different machinery on purpose
   * (see `LOCALE_PREFIX_PROBES` in `scripts/edge-cache-surfaces-check.ts`).
   * This asserts the consequence that matters at run time: a prefixed URL for a
   * prefixed surface is CACHEABLE, and a prefixed URL for anything else is not
   * a URL at all.
   */
  test("a prefixed HTML URL resolves to its surface", () => {
    expect(matchPublicCacheSurface("/id/blog/acme")?.key).toBe("blog-index");
    expect(matchPublicCacheSurface("/en/blog/acme/my-post")?.key).toBe(
      "blog-post"
    );
    expect(matchPublicCacheSurface("/id/blog/acme/category/news")?.key).toBe(
      "blog-taxonomy"
    );
  });

  test("a prefixed MACHINE URL resolves to nothing", () => {
    expect(matchPublicCacheSurface("/en/robots.txt")).toBeNull();
    expect(matchPublicCacheSurface("/id/sitemap.xml")).toBeNull();
    expect(matchPublicCacheSurface("/en/blog/acme/feed.xml")).toBeNull();
  });

  test("the bare spelling still resolves exactly as before", () => {
    expect(matchPublicCacheSurface("/blog/acme")?.key).toBe("blog-index");
    expect(matchPublicCacheSurface("/robots.txt")?.key).toBe("seo-robots");
  });

  test("every guard survives the second matching attempt", () => {
    expect(matchPublicCacheSurface("/en/blog/../admin")).toBeNull();
    expect(matchPublicCacheSurface("/id/blog/%2e%2e/admin")).toBeNull();
    expect(matchPublicCacheSurface("/id/blog/acme/search")).toBeNull();
    expect(matchPublicCacheSurface("/en/id/blog/acme")).toBeNull();
  });

  test("exactly the HTML surfaces declare localePrefixed", () => {
    const prefixed = PUBLIC_CACHE_SURFACES.filter(
      (surface) => surface.localePrefixed
    ).map((surface) => surface.key);

    expect(prefixed.sort()).toEqual([
      "blog-index",
      // Issue #594 — a static page is interface prose (Redaksi, Pedoman Media
      // Siber), so it joins the HTML surfaces rather than the machine ones.
      "blog-page",
      "blog-post",
      "blog-taxonomy"
    ]);
  });
});

describe("decision 2 — a forbidden Vary is refused, not stripped", () => {
  const cacheableInput = (vary: string | null) => ({
    config: loadEdgeCacheConfig({ EDGE_CACHE_MODE: "on" }),
    method: "GET",
    requestHeaders: new Headers(),
    responseStatus: 200,
    responseHeaders: new Headers(
      vary
        ? { "content-type": "text/html", vary }
        : { "content-type": "text/html" }
    ),
    surface: PUBLIC_CACHE_SURFACES.find(
      (surface) => surface.key === "blog-post"
    )!,
    tenantId: "11111111-1111-1111-1111-111111111111",
    searchParams: new URLSearchParams(),
    effectiveTtlSeconds: 300
  });

  test("varies on nothing forbidden: cacheable", () => {
    expect(decideCacheability(cacheableInput(null)).cacheable).toBe(true);
    expect(
      decideCacheability(cacheableInput("Accept-Encoding")).cacheable
    ).toBe(true);
  });

  test("Vary: Cookie is refused", () => {
    const decision = decideCacheability(cacheableInput("Cookie"));

    expect(decision.cacheable).toBe(false);
    expect(decision.cacheable === false && decision.reason).toBe(
      "response_varies_on_forbidden_header"
    );
  });

  test("Vary: Accept-Language is refused", () => {
    const decision = decideCacheability(cacheableInput("accept-language"));

    expect(decision.cacheable).toBe(false);
    expect(decision.cacheable === false && decision.reason).toBe(
      "response_varies_on_forbidden_header"
    );
  });

  /**
   * The realistic spelling: a forbidden name hidden in a list next to a
   * legitimate one, in whatever casing the author happened to type.
   */
  test("a forbidden name inside a list, in any casing, is refused", () => {
    expect(variesOnForbiddenHeader("Accept-Encoding, Cookie")).toBe(true);
    expect(variesOnForbiddenHeader("ACCEPT-LANGUAGE")).toBe(true);
    expect(variesOnForbiddenHeader("  cookie  ")).toBe(true);
    expect(variesOnForbiddenHeader("Accept-Encoding")).toBe(false);
    expect(variesOnForbiddenHeader(null)).toBe(false);
    // Not a substring match: `Cookie-Policy` is a different header.
    expect(variesOnForbiddenHeader("Cookie-Policy")).toBe(false);
  });
});
