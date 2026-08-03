/**
 * ADR-0042 edge cache — unit tests for the pure core.
 *
 * The emphasis is deliberately lopsided: most of these assert that something is
 * NOT cached. A bug that fails to cache a cacheable page costs latency; a bug
 * that caches an uncacheable one serves one tenant's data to another. So the
 * negative space is what gets the coverage.
 */
import { describe, expect, test } from "bun:test";

import {
  decideCacheability,
  hasIdentityCookie,
  IDENTITY_COOKIE_PREFIX
} from "../src/lib/edge-cache/cacheability";
import { loadEdgeCacheConfig } from "../src/lib/edge-cache/config";
import { createPressureTracker } from "../src/lib/edge-cache/pressure";
import { applyEdgeCacheHeaders } from "../src/lib/edge-cache/response-headers";
import {
  matchPublicCacheSurface,
  PUBLIC_CACHE_SURFACES
} from "../src/lib/edge-cache/surface-registry";
import {
  buildBanExpression,
  buildSurrogateKey,
  buildSurrogateKeyHeader,
  escapeForBanRegex,
  UnsafeSurrogateKeyError
} from "../src/lib/edge-cache/surrogate-keys";
import { publishEdgeCacheTenant } from "../src/lib/edge-cache/publish-tenant";
import { extractTenantCodeFromPath } from "../src/lib/edge-cache/tenant-key";

const ON_CONFIG = loadEdgeCacheConfig({ EDGE_CACHE_MODE: "on" });
const TENANT = "11111111-1111-4111-8111-111111111111";

function decide(
  overrides: Partial<Parameters<typeof decideCacheability>[0]> = {}
) {
  return decideCacheability({
    config: ON_CONFIG,
    method: "GET",
    requestHeaders: new Headers(),
    responseStatus: 200,
    responseHeaders: new Headers(),
    surface: PUBLIC_CACHE_SURFACES[0]!,
    tenantId: TENANT,
    searchParams: new URLSearchParams(),
    effectiveTtlSeconds: 60,
    ...overrides
  });
}

describe("cacheability — fail-closed", () => {
  test("caches a clean anonymous GET on a declared surface", () => {
    const decision = decide();

    expect(decision.cacheable).toBe(true);
  });

  test("mode off disables the subsystem entirely", () => {
    const decision = decide({
      config: loadEdgeCacheConfig({})
    });

    expect(decision).toEqual({ cacheable: false, reason: "mode_off" });
  });

  test("an undeclared path is never cached (allow-list, not deny-list)", () => {
    expect(decide({ surface: null })).toEqual({
      cacheable: false,
      reason: "surface_not_declared"
    });
  });

  test.each([["POST"], ["PUT"], ["DELETE"], ["PATCH"]])(
    "%s is never cached",
    (method) => {
      expect(decide({ method })).toMatchObject({
        cacheable: false,
        reason: "method_not_cacheable"
      });
    }
  );

  test("an Authorization header makes the response per-principal", () => {
    expect(
      decide({
        requestHeaders: new Headers({ authorization: "Bearer x" })
      })
    ).toMatchObject({ cacheable: false, reason: "authorization_header" });
  });

  test("an identity cookie makes the response per-principal", () => {
    expect(
      decide({
        requestHeaders: new Headers({ cookie: "awcms_session=abc" })
      })
    ).toMatchObject({ cacheable: false, reason: "identity_cookie" });
  });

  test("a non-identity cookie does NOT block caching", () => {
    // Analytics cookies are same-origin noise, not identity. Blocking on them
    // would disable the cache for most real visitors.
    expect(
      decide({ requestHeaders: new Headers({ cookie: "_ga=GA1.2.3" }) })
    ).toMatchObject({ cacheable: true });
  });

  test("a response that sets a cookie is never cached", () => {
    expect(
      decide({
        responseHeaders: new Headers({ "set-cookie": "awcms_session=abc" })
      })
    ).toMatchObject({ cacheable: false, reason: "response_sets_cookie" });
  });

  test.each([["private"], ["no-store"], ["no-cache"], ["private, max-age=0"]])(
    "route-declared Cache-Control %s wins over the surface profile",
    (value) => {
      expect(
        decide({ responseHeaders: new Headers({ "cache-control": value }) })
      ).toMatchObject({
        cacheable: false,
        reason: "response_declares_private"
      });
    }
  );

  test("Vary: * is never cached", () => {
    expect(
      decide({ responseHeaders: new Headers({ vary: "*" }) })
    ).toMatchObject({
      cacheable: false,
      reason: "response_varies_on_everything"
    });
  });

  test.each([[500], [502], [401], [403], [302]])(
    "status %i is not cached",
    (status) => {
      expect(decide({ responseStatus: status })).toMatchObject({
        cacheable: false,
        reason: "status_not_cacheable"
      });
    }
  );

  test("an unresolved tenant is never cached — the object could not be purged", () => {
    expect(decide({ tenantId: null })).toMatchObject({
      cacheable: false,
      reason: "tenant_unresolved"
    });
  });

  test("a declared query parameter is allowed", () => {
    // PUBLIC_CACHE_SURFACES[0] is blog-index, which declares `page`.
    expect(
      decide({ searchParams: new URLSearchParams({ page: "2" }) })
    ).toMatchObject({ cacheable: true });
  });

  test("an undeclared query parameter makes the request uncacheable", () => {
    // Without this bound, /blog/acme?x=1..N is unlimited cache entries and any
    // stranger can evict the hot objects one cheap request at a time.
    expect(
      decide({ searchParams: new URLSearchParams({ utm_source: "x" }) })
    ).toMatchObject({ cacheable: false, reason: "query_not_allowed" });
  });

  test("the TTL is clamped to the configured ceiling", () => {
    const decision = decide({
      config: loadEdgeCacheConfig({
        EDGE_CACHE_MODE: "on",
        EDGE_CACHE_MAX_TTL_SECONDS: "30"
      }),
      effectiveTtlSeconds: 9_999
    });

    expect(decision).toMatchObject({ cacheable: true, ttlSeconds: 30 });
  });
});

describe("identity cookie detection", () => {
  test("matches on the prefix regardless of position in the header", () => {
    expect(hasIdentityCookie("_ga=1; awcms_tenant_id=x; other=2")).toBe(true);
    expect(hasIdentityCookie("_ga=1; other=2")).toBe(false);
    expect(hasIdentityCookie(null)).toBe(false);
  });

  test("the real session cookie names still match the prefix rule", async () => {
    // Couples the guard to reality without importing the auth module (which
    // pulls in the database client). If someone renames the session cookie to
    // something outside the prefix, this fails and the guard is fixed with it —
    // otherwise the rename would silently make admin responses cacheable.
    const source = await Bun.file("src/lib/auth/ssr-session.ts").text();
    const names = [...source.matchAll(/COOKIE_NAME = "([^"]+)"/g)].map(
      (match) => match[1]!
    );

    expect(names.length).toBeGreaterThanOrEqual(2);

    for (const name of names) {
      expect(name.startsWith(IDENTITY_COOKIE_PREFIX)).toBe(true);
    }
  });
});

describe("surrogate keys", () => {
  test("builds the documented key shapes", () => {
    expect(buildSurrogateKey({ kind: "tenant", tenantId: "abc" })).toBe(
      "t:abc"
    );
    expect(
      buildSurrogateKey({
        kind: "resource",
        tenantId: "abc",
        resourceType: "blog_post",
        resourceId: "42"
      })
    ).toBe("t:abc:r:blog_post:42");
  });

  test.each([[".*"], ["a|b"], ["a b"], ["a/b"], ["a:b"], [""], ["(x)"]])(
    "rejects the unsafe segment %p rather than rewriting it",
    (segment) => {
      expect(() =>
        buildSurrogateKey({ kind: "tenant", tenantId: segment })
      ).toThrow(UnsafeSurrogateKeyError);
    }
  );

  test("the header is deduplicated and order-stable", () => {
    const header = buildSurrogateKeyHeader([
      { kind: "tenant", tenantId: "b" },
      { kind: "tenant", tenantId: "a" },
      { kind: "tenant", tenantId: "b" }
    ]);

    expect(header).toBe("t:a t:b");
  });

  test("the ban expression anchors on token boundaries", () => {
    // Without the boundaries, banning t:abc would also ban t:abcdef — a
    // different tenant's entire cache.
    expect(buildBanExpression("t:abc")).toBe(
      "obj.http.Surrogate-Key ~ (^|[[:space:]])t:abc([[:space:]]|$)"
    );
  });

  test("the ban expression contains no literal whitespace in its regex", () => {
    // Varnish splits a ban expression on whitespace into
    // `<field> <operator> <argument>`. A literal space inside the regex — which
    // is what `(^| )` is — makes the token count wrong and Varnish rejects the
    // ban with `Wrong number of arguments`.
    //
    // Nothing else catches this. The VCL's BAN handler returns 200 regardless,
    // so the origin marks the purge delivered and the object stays cached until
    // its TTL. Invalidation silently never happens. That is exactly what
    // shipped, and it was only found by running Varnish in front of staging.
    const expression = buildBanExpression("t:abc");
    const [field, operator, ...rest] = expression.split(/\s+/);

    expect(field).toBe("obj.http.Surrogate-Key");
    expect(operator).toBe("~");
    expect(rest).toHaveLength(1);
  });
});

describe("the shipped VCL agrees with the origin", () => {
  test("default.vcl builds the same ban expression shape", async () => {
    // A file-level assertion on purpose: the runtime ban expression is built by
    // the VCL (the origin only sends the key in a header), so a divergence
    // between these two is invisible to every other test in this suite — and
    // its symptom is silent staleness rather than an error.
    const vcl = await Bun.file("infra/varnish/default.vcl").text();
    const banCall = vcl
      .split("\n")
      .find((line) => line.trim().startsWith("ban("));

    expect(banCall).toBeDefined();
    expect(banCall).toContain("(^|[[:space:]])");
    expect(banCall).toContain("([[:space:]]|$)");
    // The bug, stated as the thing that must never come back.
    expect(banCall).not.toContain("(^| )");
    expect(banCall).not.toContain("( |$)");
  });

  test("the compose overlay names an image that exists on Docker Hub", async () => {
    // `varnishcache/varnish` is not a Docker Hub repository; the earlier value
    // failed with `pull access denied` for anyone who tried to adopt the file.
    const compose = await Bun.file(
      "infra/varnish/docker-compose.varnish.yml"
    ).text();

    expect(compose).toMatch(/^\s*image:\s*varnish:\d+\.\d+\s*$/m);
  });

  test("regex metacharacters are escaped for the ban expression", () => {
    expect(escapeForBanRegex("a.*b")).toBe("a\\.\\*b");
  });

  test("vcl_hash keys on Host AND still reaches the builtin's req.url hashing", async () => {
    // This is the prerequisite for declaring the host-resolved `/news/**`
    // surfaces (ADR-0061 §2), and it is TWO properties, not one:
    //
    // 1. `Host` is hashed. `/news/hello-world` is the same path for every
    //    tenant, so a cache keyed on path alone serves one tenant's article to
    //    another's visitors. That is not a staleness bug; it is the disclosure
    //    the whole subsystem exists to prevent.
    // 2. The custom `vcl_hash` does NOT `return (lookup)`. In Varnish a custom
    //    subroutine that returns terminates the chain, so `builtin.vcl`'s
    //    `vcl_hash` — the one that hashes `req.url` — never runs, and every path
    //    on one host collapses onto a single cache entry. Adding that return
    //    looks like a harmless completion of the subroutine.
    const vcl = await Bun.file("infra/varnish/default.vcl").text();
    const hashBody = vcl.split("sub vcl_hash {")[1]?.split("\n}")[0] ?? "";

    expect(hashBody).toContain("hash_data(req.http.host)");
    expect(hashBody).not.toContain("return (lookup)");
    expect(hashBody).not.toContain("return(lookup)");
  });
});

describe("surface registry", () => {
  test.each([
    ["/blog/acme", "blog-index"],
    ["/blog/acme/", "blog-index"],
    ["/blog/acme/hello-world", "blog-post"],
    ["/blog/acme/category/news", "blog-taxonomy"],
    ["/blog/acme/tag/bun", "blog-taxonomy"],
    ["/blog/acme/feed.xml", "blog-discovery"],
    ["/blog/acme/sitemap-blog.xml", "blog-discovery"],
    ["/theming/acme/tokens.css", "theming-tokens"],
    // The host-resolved family (ADR-0061) — no tenant segment, so the patterns
    // are one segment shorter than their `/blog/{tenantCode}` counterparts.
    ["/news", "news-index"],
    ["/news/", "news-index"],
    ["/news/hello-world", "news-post"],
    ["/news/category/announcements", "news-taxonomy"],
    ["/news/tag/bun", "news-taxonomy"],
    // Root discovery (ADR-0061 §B).
    ["/robots.txt", "seo-robots"],
    ["/sitemap.xml", "seo-sitemap"],
    ["/sitemap-1.xml", "seo-sitemap"],
    ["/sitemap-42.xml", "seo-sitemap"],
    ["/feed.xml", "seo-feed"],
    ["/atom.xml", "seo-feed"],
    ["/feed.json", "seo-feed"]
  ])("%s resolves to %s", (path, expected) => {
    expect(matchPublicCacheSurface(path)?.key).toBe(expected);
  });

  test.each([
    ["/admin"],
    ["/admin/users"],
    ["/api/v1/health"],
    ["/login"],
    ["/search"],
    ["/blog/acme/search"],
    ["/theming/preview/tok"],
    ["/theming/preview-tokens/tok.css"],
    ["/blog/../admin"],
    ["/blog/%2E%2E/admin"],
    // `/news/..` — not `/news/../admin` — is the shape that satisfies
    // `news-post` on its face, because the host-resolved patterns carry no
    // tenant segment. The traversal guard is the only thing that stops it.
    ["/news/.."],
    ["/news/%2E%2E"],
    ["/news/category/.."],
    ["/news/search"],
    // Shapes `Number()` would coerce but `^\d+$` — and the surface pattern —
    // must not. The route file documents the same list.
    ["/sitemap-1e3.xml"],
    ["/sitemap-0x10.xml"],
    ["/sitemap-abc.xml"],
    ["/sitemap-.xml"],
    ["/feed.rss"]
  ])("%s is not cacheable", (path) => {
    expect(matchPublicCacheSurface(path)).toBeNull();
  });

  test("the more specific blog discovery pattern beats the generic post pattern", () => {
    // Both `blog-post` and `blog-discovery` match /blog/acme/feed.xml; the
    // ordering rule is what makes the TTL and module key correct.
    expect(matchPublicCacheSurface("/blog/acme/feed.xml")?.moduleKey).toBe(
      "blog_content"
    );
    expect(matchPublicCacheSurface("/blog/acme/feed.xml")?.key).toBe(
      "blog-discovery"
    );
  });

  test("the news taxonomy pattern beats the generic news post pattern", () => {
    // `/news/category/x` satisfies neither `news-post` (three segments) nor a
    // careless reading of the ordering rule — but `/news/category` DOES satisfy
    // `news-post`, and a future two-segment taxonomy shape would collide. Pin
    // the resolution that matters today so a reordering is loud.
    expect(matchPublicCacheSurface("/news/category/x")?.key).toBe(
      "news-taxonomy"
    );
    expect(matchPublicCacheSurface("/news/category/x")?.ttlSeconds).toBe(120);
    // Two segments: Astro routes this to `[slug].ts`, which 404s for the slug
    // "category". Cached as a post 404, which is correct and purgeable.
    expect(matchPublicCacheSurface("/news/category")?.key).toBe("news-post");
  });

  test("a feed caches with ?locale= but not with anything else", () => {
    const surface = matchPublicCacheSurface("/feed.xml")!;

    expect(
      decide({ surface, searchParams: new URLSearchParams({ locale: "id" }) })
    ).toMatchObject({ cacheable: true });
    expect(
      decide({
        surface,
        searchParams: new URLSearchParams({ utm_source: "x" })
      })
    ).toMatchObject({ cacheable: false, reason: "query_not_allowed" });
  });

  test("robots.txt is not cached alongside the sitemap it advertises", () => {
    // Same owner, different TTLs and different surrogate keys on purpose: robots
    // is config-derived and stable, the sitemap is content-derived. Merging them
    // into one entry would give the volatile body the stable body's TTL.
    expect(matchPublicCacheSurface("/robots.txt")?.ttlSeconds).toBe(600);
    expect(matchPublicCacheSurface("/sitemap.xml")?.ttlSeconds).toBe(300);
    expect(matchPublicCacheSurface("/robots.txt")?.key).not.toBe(
      matchPublicCacheSurface("/sitemap.xml")?.key
    );
  });

  test("every host-resolved surface requires a tenant, so an unpublished one is refused", () => {
    // The whole safety argument for the host-resolved families rests on this:
    // middleware cannot derive the tenant from the URL, so a route that does not
    // publish must fall through to `tenant_unresolved` rather than be cached
    // under a guessed key. That is also what keeps an out-of-range
    // `/sitemap-99999.xml` from filling the cache: its builder returns null, so
    // nothing is published and nothing is stored.
    for (const surface of PUBLIC_CACHE_SURFACES.filter(
      (entry) => entry.key.startsWith("news-") || entry.key.startsWith("seo-")
    )) {
      expect(surface.requiresTenant).toBe(true);
      expect(
        decide({ surface, tenantId: null, effectiveTtlSeconds: 60 })
      ).toEqual({
        cacheable: false,
        reason: "tenant_unresolved"
      });
    }
  });
});

describe("edge-cache tenant publication", () => {
  test("publishes a resolved tenant onto locals", () => {
    const locals: { edgeCacheTenantId?: string | null } = {};

    publishEdgeCacheTenant(locals, TENANT);

    expect(locals.edgeCacheTenantId).toBe(TENANT);
  });

  test.each([[null], [undefined], [""]])(
    "an absent tenant id (%p) leaves locals untouched rather than clearing it",
    (tenantId) => {
      const locals: { edgeCacheTenantId?: string | null } = {};

      publishEdgeCacheTenant(locals, tenantId as string | null | undefined);

      expect(locals.edgeCacheTenantId).toBeUndefined();
    }
  );

  test("a missing locals object is tolerated, not thrown on", () => {
    // ADR-0042's standing rule: no fault in the cache layer may turn a working
    // public page into a 500. A caller outside a request context is a fault of
    // exactly that shape.
    expect(() => publishEdgeCacheTenant(undefined, TENANT)).not.toThrow();
    expect(() => publishEdgeCacheTenant(null, TENANT)).not.toThrow();
  });
});

describe("tenant code extraction", () => {
  test.each([
    ["/blog/acme", "acme"],
    ["/blog/acme/post", "acme"],
    ["/theming/acme/tokens.css", "acme"]
  ])("%s yields %s", (path, expected) => {
    expect(extractTenantCodeFromPath(path)).toBe(expected);
  });

  test.each([["/admin/x"], ["/blog/"], ["/blog/a b/x"], ["/api/v1/blog/x"]])(
    "%s yields null",
    (path) => {
      expect(extractTenantCodeFromPath(path)).toBeNull();
    }
  );
});

describe("auto-activation pressure ramp", () => {
  const autoConfig = loadEdgeCacheConfig({
    EDGE_CACHE_MODE: "auto",
    EDGE_CACHE_AUTO_REQUEST_RATE_THRESHOLD: "10",
    EDGE_CACHE_AUTO_WINDOW_SECONDS: "60",
    EDGE_CACHE_AUTO_LATENCY_THRESHOLD_MS: "250"
  });

  test("advertises no TTL at rest — the origin serves fresh data", () => {
    const tracker = createPressureTracker(autoConfig);

    tracker.record(5, 1_000);

    expect(tracker.effectiveTtlSeconds(300, 1_000)).toBe(0);
  });

  test("engages once sustained request rate crosses the threshold", () => {
    const tracker = createPressureTracker(autoConfig);

    // 600 requests inside a 60s window = 10 rps = exactly the threshold.
    for (let index = 0; index < 600; index += 1) {
      tracker.record(5, 1_000 + index);
    }

    expect(tracker.sample(1_600).activated).toBe(true);
    expect(tracker.effectiveTtlSeconds(300, 1_600)).toBeGreaterThan(0);
  });

  test("high latency alone engages the ramp even at low request rate", () => {
    const tracker = createPressureTracker(autoConfig);

    tracker.record(5_000, 1_000);

    expect(tracker.sample(1_000).activated).toBe(true);
  });

  test("the ramp reaches the full declared TTL at twice the threshold", () => {
    const tracker = createPressureTracker(autoConfig);

    for (let index = 0; index < 1_200; index += 1) {
      tracker.record(1, 1_000 + index);
    }

    expect(tracker.effectiveTtlSeconds(300, 2_200)).toBe(300);
  });

  test("stays engaged through the cooldown so the TTL does not flap", () => {
    const tracker = createPressureTracker(autoConfig);

    for (let index = 0; index < 1_200; index += 1) {
      tracker.record(1, 1_000 + index);
    }

    // The latch is set BY `sample()`, so it has to be read while the load is
    // still in the window — which is what the serving path does on every
    // request in auto mode. See the note on `sample()` in pressure.ts.
    expect(tracker.sample(2_200).activated).toBe(true);

    // Well past the observation window: the observations have aged out, so the
    // ratio is now 0, yet activation must still hold. That is the hysteresis.
    const insideCooldown = 2_200 + 90_000;

    expect(tracker.sample(insideCooldown).pressureRatio).toBe(0);
    expect(tracker.sample(insideCooldown).activated).toBe(true);
  });

  test("disengages once the cooldown lapses", () => {
    const tracker = createPressureTracker(autoConfig);

    for (let index = 0; index < 1_200; index += 1) {
      tracker.record(1, 1_000 + index);
    }

    tracker.sample(2_200);

    const afterCooldown = 2_200 + 60_000 * 4;

    expect(tracker.sample(afterCooldown).activated).toBe(false);
    expect(tracker.effectiveTtlSeconds(300, afterCooldown)).toBe(0);
  });

  test("mode `on` ignores pressure entirely and is therefore predictable", () => {
    const tracker = createPressureTracker(ON_CONFIG);

    expect(tracker.effectiveTtlSeconds(120, 1_000)).toBe(120);
  });

  test("pressure can never widen what is cacheable, only how long", () => {
    // The structural guarantee: even at extreme load, an admin-shaped request
    // is still refused. Pressure is not an input to `decideCacheability`.
    const tracker = createPressureTracker(autoConfig);

    for (let index = 0; index < 10_000; index += 1) {
      tracker.record(9_000, 1_000 + index);
    }

    expect(
      decide({
        config: autoConfig,
        requestHeaders: new Headers({ cookie: "awcms_session=abc" }),
        effectiveTtlSeconds: tracker.effectiveTtlSeconds(300, 2_000)
      })
    ).toMatchObject({ cacheable: false, reason: "identity_cookie" });
  });
});

describe("response headers", () => {
  test("an uncacheable response is explicitly marked private", () => {
    // Varnish's builtin VCL would cache an unlabelled 200 for default_ttl, so
    // silence here is a disclosure. This is the assertion that guards it.
    const response = applyEdgeCacheHeaders(new Response("x"), {
      cacheable: false,
      reason: "surface_not_declared"
    });

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-edge-cache-skip")).toBe(
      "surface_not_declared"
    );
    expect(response.headers.get("surrogate-control")).toBeNull();
  });

  test("a route's own Cache-Control is never overwritten", () => {
    const response = applyEdgeCacheHeaders(
      new Response("x", { headers: { "cache-control": "public, max-age=60" } }),
      { cacheable: false, reason: "surface_not_declared" }
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  test("a cacheable response advertises Surrogate-Control and keys", () => {
    const response = applyEdgeCacheHeaders(new Response("x"), {
      cacheable: true,
      ttlSeconds: 120,
      staleWhileRevalidateSeconds: 600,
      surrogateKeys: [
        { kind: "tenant", tenantId: "abc" },
        { kind: "surface", tenantId: "abc", surface: "blog-post" }
      ]
    });

    expect(response.headers.get("surrogate-control")).toBe(
      "max-age=120, stale-while-revalidate=600"
    );
    expect(response.headers.get("surrogate-key")).toBe(
      "t:abc t:abc:s:blog-post"
    );
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
  });

  test("a zero TTL in auto mode advertises nothing but is not marked private", () => {
    // The resting state of auto mode: legitimately cacheable, just not needed
    // yet. Marking it private would poison the next request's chance to cache.
    const response = applyEdgeCacheHeaders(new Response("x"), {
      cacheable: true,
      ttlSeconds: 0,
      staleWhileRevalidateSeconds: 600,
      surrogateKeys: []
    });

    expect(response.headers.get("surrogate-control")).toBeNull();
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("x-edge-cache-skip")).toBe("auto_not_engaged");
  });

  test("an existing Vary is preserved, not clobbered", () => {
    const response = applyEdgeCacheHeaders(
      new Response("x", { headers: { vary: "Accept" } }),
      {
        cacheable: true,
        ttlSeconds: 60,
        staleWhileRevalidateSeconds: 0,
        surrogateKeys: []
      }
    );

    expect(response.headers.get("vary")).toBe("Accept, Accept-Encoding");
  });
});

describe("config validation", () => {
  test("defaults to off with no environment at all", () => {
    expect(loadEdgeCacheConfig({}).mode).toBe("off");
  });

  test("an unrecognized mode falls back to off rather than guessing", () => {
    expect(loadEdgeCacheConfig({ EDGE_CACHE_MODE: "yes-please" }).mode).toBe(
      "off"
    );
  });
});
