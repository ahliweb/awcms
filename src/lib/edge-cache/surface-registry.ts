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
 * The root discovery routes (ADR-0038) resolve their tenant from the request
 * rather than from a path segment, so middleware cannot derive it from the URL
 * and source (2) in `tenant-key.ts` does not apply. They publish
 * `locals.edgeCacheTenantId` instead, via `publishEdgeCacheTenant`, and only on
 * the path that actually serves the resource; see that file for why the timing
 * of the publish is a disclosure question rather than a style question.
 *
 * ADR-0061 declared a SECOND host-resolved family here — the `/news/**` content
 * routes ADR-0059 built. [ADR-0071](../../../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
 * then removed those routes from this repo entirely (`/news/**` is
 * `awcms-astro`'s vocabulary), and the three `news-*` entries outlived them by
 * several days. They were INERT rather than dangerous — nothing served those
 * paths, and `requiresTenant` made an unpublished tenant fail closed — but an
 * inert entry is worse than no entry: it is a declaration that a shared cache
 * MAY store something, kept alive with a rationale explaining why it is safe,
 * for a route nobody can read. `edge-cache:surfaces:check` now refuses a
 * surface whose owning module declares no route that could serve it.
 *
 * Two properties had to hold before these entries were safe, and both are
 * asserted rather than assumed:
 *
 * - **The edge keys on `Host`.** `/sitemap.xml` is the same path for every
 *   tenant, so a cache that keys on path alone would serve one tenant's entire
 *   URL inventory to another's visitors. `infra/varnish/default.vcl`'s `vcl_hash` hashes `req.http.host`
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

import { splitPublicLocalePath } from "../i18n/public-locale-path";

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
  /**
   * Whether this surface's canonical URL carries a locale segment (ADR-0098).
   *
   * True for the surfaces that render interface chrome a human reads: their
   * bodies differ by the reader's language, and since the edge keys on the URL
   * alone, that difference MUST be in the URL or the cache misdelivers. False
   * for the machine surfaces — a sitemap, a robots policy and a stylesheet
   * contain no interface language, and `/feed.xml` already carries its locale
   * as an allow-listed query parameter, which is the same key in a different
   * spelling.
   *
   * `src/lib/i18n/public-locale-path.ts` owns the path patterns, and
   * `edge-cache:surfaces:check` fails when the two disagree — so a new cacheable
   * HTML surface cannot be added without deciding this.
   */
  localePrefixed: boolean;
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
    localePrefixed: true,
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
    localePrefixed: true,
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
    localePrefixed: true,
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
    localePrefixed: false,
    rationale:
      "Per-tenant blog feed and sitemap; content-derived, anonymous, identical for every reader."
  },
  {
    key: "seo-robots",
    moduleKey: "seo_distribution",
    pattern: /^\/robots\.txt$/,
    ttlSeconds: 600,
    requiresTenant: true,
    allowedQueryParams: [],
    localePrefixed: false,
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
    localePrefixed: false,
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
    localePrefixed: false,
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
    localePrefixed: false,
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

  const direct =
    specificFirst.find((surface) => surface.pattern.test(pathname)) ?? null;

  if (direct) {
    return direct;
  }

  /**
   * ADR-0098: the canonical URL of an HTML surface carries a locale segment, so
   * `/id/blog/acme` must resolve to `blog-index`. Patterns stay written against
   * the BARE path — the prefix is a property of the URL, not of the surface —
   * and are retried once against the stripped path.
   *
   * This retry is what makes the prefixed URL cacheable at all. Without it every
   * `/en/…` and `/id/…` request would miss the registry, be stamped
   * `private, no-store`, and the ADR would have moved the locale into the key
   * while turning the entire public surface uncacheable — a regression that
   * reads as a caching bug rather than a routing one.
   *
   * The `localePrefixed` guard is why `/en/robots.txt` and `/id/sitemap.xml` do
   * NOT resolve here: those surfaces have no prefixed spelling and nothing
   * serves one, so declaring a cacheable alias for them would let the edge store
   * a 404 under a name the origin never blesses. Every guard above still applies
   * — traversal and reserved segments are checked against the FULL path, before
   * either attempt.
   */
  const { locale, pathname: bare } = splitPublicLocalePath(pathname);

  if (!locale) {
    return null;
  }

  const prefixed =
    specificFirst.find((surface) => surface.pattern.test(bare)) ?? null;

  return prefixed?.localePrefixed ? prefixed : null;
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
