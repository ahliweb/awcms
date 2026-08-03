/**
 * The allow-list of public surfaces that may be cached at the edge — ADR-0042 §5.
 *
 * This registry is the *entire* answer to "what is cacheable". If a path is not
 * matched here it is never cached, no matter how public it looks. Adding an
 * entry is a deliberate, reviewable act; forgetting to add one costs performance
 * and nothing else.
 *
 * ## Why these, and pointedly not the others
 *
 * Included are the anonymous, tenant-scoped, content-derived GET surfaces whose
 * bodies are a pure function of published content plus tenant configuration —
 * exactly the responses that today re-run the same database work for every
 * visitor, which is what ADR-0042 exists to stop.
 *
 * Excluded, each for a specific reason rather than by oversight:
 *
 * - **`/search` and `/blog/{tenantCode}/search`** — the response varies on a
 *   free-text query. The key space is unbounded, so caching them converts a
 *   cheap request into cache-fill pressure and lets a stranger evict the useful
 *   entries by walking random queries. Site search has its own index; that is
 *   the right place to make it fast.
 * - **`/theming/preview/{token}` and `/theming/preview-tokens/{token}.css`** —
 *   the URL carries a bearer token for unpublished theme state. Caching
 *   token-scoped previews at a shared edge is precisely the disclosure this
 *   subsystem must not create.
 * - **`/login`** — authentication surface; it also sets cookies, so
 *   `decideCacheability` would refuse it anyway. Belt and braces.
 * - **`/[...path]`** — the catch-all that resolves `seo_distribution` redirects
 *   and records 404 observations. Caching it would both suppress the 404
 *   observation (a product feature) and hold a redirect that an editor has since
 *   changed. Left to the origin on purpose.
 * - **Every `/api/v1/**` route** — including the six unauthenticated ones.
 *   `analyticsCollect` is a write, and the search endpoints are query-driven.
 *   The public comments list is a genuine candidate and is a documented
 *   follow-up, not an omission.
 *
 * ## Host-resolved surfaces (ADR-0061)
 *
 * Two families here resolve their tenant from the request rather than from a
 * path segment — the `/news/**` content routes (ADR-0059) and the root
 * discovery routes (ADR-0038) — so middleware cannot derive it from the URL and
 * source (2) in `tenant-key.ts` does not apply. Their routes publish
 * `locals.edgeCacheTenantId` instead, via `publishEdgeCacheTenant`, and only on
 * the path that actually serves the resource; see that file for why the timing
 * of the publish is a disclosure question rather than a style question.
 *
 * Two properties had to hold before these entries were safe, and both are
 * asserted rather than assumed:
 *
 * - **The edge keys on `Host`.** `/news/hello-world` and `/sitemap.xml` are the
 *   same path for every tenant, so a cache that keys on path alone would serve
 *   one tenant's article — or one tenant's entire URL inventory — to another's
 *   visitors. `infra/varnish/default.vcl`'s `vcl_hash` hashes `req.http.host`
 *   explicitly (and does not `return (lookup)`, so builtin `req.url` hashing
 *   still runs). `tests/edge-cache.test.ts` asserts both halves.
 * - **An unpublished tenant fails closed.** `requiresTenant` is true for every
 *   one of them, so any request whose tenant did not resolve — or whose route
 *   chose not to publish — is refused with `tenant_unresolved` rather than
 *   cached under a guessed key.
 *
 * ### Discovery bodies have TWO authors, and that shapes invalidation
 *
 * The `seo-*` surfaces below are owned by `seo_distribution`, which is right for
 * ownership (it owns the routes and the config that shapes them) and incomplete
 * for invalidation: their bodies are aggregated from every `seo_facts` provider,
 * so publishing a post changes `/sitemap.xml` and `/feed.xml` without touching
 * anything `seo_distribution` writes.
 *
 * A module purge tags `t:<tenant>:m:<moduleKey>`, so `blog_content`'s existing
 * publish purge cannot reach an object tagged `m:seo_distribution`. Left there,
 * `/blog/{code}/feed.xml` would be purged on publish while `/feed.xml` — the
 * same content, the host-resolved spelling — sat stale until TTL, an asymmetry
 * nothing would report. `enqueueModuleContentPurge` closes it by ALSO purging
 * the modules that declare a `consumes` dependency on the changing module and
 * own a declared surface. That is read from the module registry, so
 * `blog_content` never names `seo_distribution`; the consumer's own `consumes`
 * declaration is what wires it.
 *
 * The path-scoped blog feed and sitemap below (`/blog/{tenantCode}/feed.xml`,
 * `/blog/{tenantCode}/sitemap-blog.xml`) remain covered separately, so tenants
 * on the ADR-0009 path-scoped surface keep the caching they already had.
 */

/** A declared cacheable public surface. */
export type PublicCacheSurface = {
  /** Stable identifier; also the `s:` component of the surrogate key. */
  key: string;
  /** Owning module, used for module-scoped invalidation. `null` for core surfaces. */
  moduleKey: string | null;
  /** Matches the request pathname. */
  pattern: RegExp;
  /**
   * Requested `Surrogate-Control: max-age` for this surface, before the
   * auto-activation ramp and before the global ceiling clamp.
   */
  ttlSeconds: number;
  /**
   * When true, a response whose tenant could not be resolved is NOT cached.
   * Every tenant-scoped surface sets this: an untagged object cannot be
   * invalidated by any surrogate key, so it would go stale permanently.
   */
  requiresTenant: boolean;
  /**
   * Query parameters this surface may be cached WITH. Any other parameter makes
   * the request uncacheable.
   *
   * This exists because the edge keys on the full URL, query string included.
   * Without a bound, `/blog/acme?x=1`, `?x=2`, … are unlimited distinct cache
   * entries, so any stranger can evict the genuinely hot objects — and pay for
   * it with one cheap request each. An allow-list turns an unbounded key space
   * into a small finite one.
   */
  allowedQueryParams: readonly string[];
  /** Why this surface is safe to cache — kept next to the declaration on purpose. */
  rationale: string;
};

/**
 * Patterns are anchored and use explicit character classes rather than `.*`, so
 * a path cannot smuggle its way into a more permissive surface. `[^/]+`
 * deliberately excludes `/` so `/blog/a/b/c` cannot match a two-segment surface.
 */
export const PUBLIC_CACHE_SURFACES: readonly PublicCacheSurface[] = [
  {
    key: "blog-index",
    moduleKey: "blog_content",
    pattern: /^\/blog\/[^/]+\/?$/,
    ttlSeconds: 120,
    requiresTenant: true,
    allowedQueryParams: ["page"],
    rationale:
      "Published-post listing for one tenant (ADR-0009 path-scoped). Shorter TTL than discovery because an editor expects a new post to appear promptly even if a purge is missed."
  },
  {
    key: "blog-post",
    moduleKey: "blog_content",
    pattern: /^\/blog\/[^/]+\/[^/]+$/,
    ttlSeconds: 300,
    requiresTenant: true,
    allowedQueryParams: [],
    rationale:
      "A single published post. Purged by resource key on update/unpublish, so the TTL is only the fallback."
  },
  {
    key: "blog-taxonomy",
    moduleKey: "blog_content",
    pattern: /^\/blog\/[^/]+\/(category|tag)\/[^/]+$/,
    ttlSeconds: 120,
    requiresTenant: true,
    allowedQueryParams: ["page"],
    rationale:
      "Published-post listing filtered by a taxonomy term; same reasoning as the index."
  },
  {
    key: "blog-discovery",
    moduleKey: "blog_content",
    pattern: /^\/blog\/[^/]+\/(feed\.xml|sitemap-blog\.xml)$/,
    ttlSeconds: 300,
    requiresTenant: true,
    allowedQueryParams: [],
    rationale:
      "Per-tenant blog feed and sitemap; content-derived, anonymous, identical for every reader."
  },
  {
    key: "news-index",
    moduleKey: "blog_content",
    pattern: /^\/news\/?$/,
    ttlSeconds: 120,
    requiresTenant: true,
    allowedQueryParams: ["page"],
    rationale:
      "Host-resolved published-post listing (ADR-0059). Same body, same reasoning and the same TTL as `blog-index`; the ONE difference is that its tenant arrives from the request rather than from a path segment."
  },
  {
    key: "news-taxonomy",
    moduleKey: "blog_content",
    pattern: /^\/news\/(category|tag)\/[^/]+$/,
    ttlSeconds: 120,
    requiresTenant: true,
    allowedQueryParams: ["page"],
    rationale:
      "Host-resolved listing filtered by a taxonomy term; the `blog-taxonomy` counterpart. Declared before `news-post` matters only to a reader — `matchPublicCacheSurface` orders specific-first by pattern length, and a test pins that."
  },
  {
    key: "news-post",
    moduleKey: "blog_content",
    pattern: /^\/news\/[^/]+$/,
    ttlSeconds: 300,
    requiresTenant: true,
    allowedQueryParams: [],
    rationale:
      "A single published post at its host-resolved URL — the page every canonical, `<loc>` and feed link points at once the family is live. Purged by the same `blog_content` module purge that already covers `blog-post`."
  },
  {
    key: "seo-robots",
    moduleKey: "seo_distribution",
    pattern: /^\/robots\.txt$/,
    ttlSeconds: 600,
    requiresTenant: true,
    allowedQueryParams: [],
    rationale:
      "The tenant's crawl policy at its verified primary domain root. Derived from config rather than content — it changes only when an operator edits SEO settings, which enqueues the module purge — so it carries the longest TTL here alongside theming tokens."
  },
  {
    key: "seo-sitemap",
    moduleKey: "seo_distribution",
    pattern: /^\/sitemap(-\d+)?\.xml$/,
    ttlSeconds: 300,
    requiresTenant: true,
    allowedQueryParams: [],
    rationale:
      "The sitemap index and its bounded child pages. Identical for every anonymous reader and rebuilt from a content roll-up on each request today, which is the single most repeated piece of database work on the public surface."
  },
  {
    key: "seo-feed",
    moduleKey: "seo_distribution",
    pattern: /^\/(feed\.xml|atom\.xml|feed\.json)$/,
    ttlSeconds: 300,
    requiresTenant: true,
    allowedQueryParams: ["locale"],
    rationale:
      "RSS, Atom and JSON syndication of the latest published items. `locale` is the only permitted parameter and it is already validated to a short BCP-47-ish shape by `parseDiscoveryLocaleParam`, so the key space stays small and finite."
  },
  {
    key: "theming-tokens",
    moduleKey: "theming",
    pattern: /^\/theming\/[^/]+\/tokens\.css$/,
    ttlSeconds: 600,
    requiresTenant: true,
    allowedQueryParams: [],
    rationale:
      "Published design tokens for a tenant. Changes only on theme publish, which enqueues a module purge — the longest TTL here because it is the most stable and the most frequently re-fetched."
  }
];

/**
 * Resolve the surface for a pathname, or `null` when the path is not declared
 * cacheable.
 *
 * First match wins and the list is ordered specific-to-general, so
 * `/blog/x/feed.xml` resolves to `blog-discovery` rather than `blog-post`.
 * `matchPublicCacheSurface` is exercised by a test that asserts exactly that
 * ordering, because a reordering here would silently change TTLs and keys.
 */
export function matchPublicCacheSurface(
  pathname: string,
  surfaces: readonly PublicCacheSurface[] = PUBLIC_CACHE_SURFACES
): PublicCacheSurface | null {
  if (hasTraversalSegment(pathname) || hasReservedSegment(pathname)) {
    return null;
  }

  const specificFirst = [...surfaces].sort(
    (left, right) => right.pattern.source.length - left.pattern.source.length
  );

  return (
    specificFirst.find((surface) => surface.pattern.test(pathname)) ?? null
  );
}

/**
 * Reject any path containing a `..` segment before it reaches a pattern.
 *
 * This is load-bearing and not theoretical: `/blog/../admin` is three segments,
 * so it satisfies `^\/blog\/[^/]+\/[^/]+$` and would resolve to the `blog-post`
 * surface. In practice `new URL()` normalizes dot segments away before
 * middleware ever sees the path — but "a WHATWG URL parser upstream happens to
 * clean this for us" is a property of the current request pipeline, not an
 * invariant of this function, and a caller that passes a raw path would silently
 * get a cacheable admin URL.
 *
 * Percent-encoded forms are covered too: `%2e` never legitimately appears as a
 * whole path segment, so treating it as traversal costs nothing real.
 */
/**
 * Path segments that are never a content slug, even though they sit exactly
 * where one does.
 *
 * `/blog/{tenantCode}/search` is three segments, so it satisfies the `blog-post`
 * pattern and WOULD have been cached with a 300s TTL — while this file's header
 * claims search is excluded. The registry gate's probe list caught the
 * contradiction. Adding a reserved sub-route under `/blog/{code}/` in future
 * means adding it here, or it inherits `blog-post` caching by accident.
 */
const RESERVED_SEGMENTS = new Set(["search"]);

function hasReservedSegment(pathname: string): boolean {
  return pathname
    .split("/")
    .some((segment) => RESERVED_SEGMENTS.has(segment.toLowerCase()));
}

function hasTraversalSegment(pathname: string): boolean {
  return pathname.split("/").some((segment) => /^(\.|%2e){2}$/i.test(segment));
}
