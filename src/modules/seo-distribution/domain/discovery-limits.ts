/**
 * Hard, non-configurable bounds and HTTP cache policy for the public discovery
 * / syndication surfaces (ADR-0038 §7/§9). These are the "sitemap
 * amplification" abuse controls the ADR requires: they cap what any single
 * request can produce, independent of (and always tighter than) any per-tenant
 * `feed_item_limit`/`sitemap_enabled` config. Pure constants — no I/O.
 */

/**
 * Sitemaps protocol ceilings (sitemaps.org): a single sitemap file may hold at
 * most 50,000 `<url>` entries and 50 MB uncompressed. We never approach either:
 * `SITEMAP_URLS_PER_PAGE` is well under the URL ceiling, keeping each child file
 * small and fast, and the byte ceiling is never reached at that URL count.
 */
export const SITEMAP_PROTOCOL_MAX_URLS = 50000;
export const SITEMAP_PROTOCOL_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Page size the discovery service REQUESTS from a `seo_facts` provider in one
 * `listPublicResourceFacts` call.
 *
 * `ListPublicResourceFactsOptions.pageSize` is a REQUEST, never a guarantee: the
 * port lets every provider clamp it to its own ceiling (`blog_content` clamps at
 * 200), and a clamped page is indistinguishable from a genuinely short one
 * except through `nextCursor`. So the service asks for a size providers actually
 * honor and PAGES on `nextCursor` for the rest — it never treats one response as
 * the whole window. Keep this at or below the tightest provider clamp; raising it
 * past a provider's ceiling costs nothing (the walk still terminates), lowering
 * `SITEMAP_URLS_PER_PAGE / SITEMAP_PROVIDER_REQUESTS_PER_PAGE` below it does not.
 */
export const SEO_FACTS_PROVIDER_PAGE_SIZE = 200;

/**
 * URLs per child sitemap. Conservative (well under the 50k protocol ceiling) so
 * a child stays small; the sitemap index maps child page N to
 * `offset = (N-1)*SITEMAP_URLS_PER_PAGE` of the provider's stable `id_asc` order.
 *
 * Sized against what the port can actually SERVE, not against the protocol
 * ceiling: one child page is `SITEMAP_URLS_PER_PAGE / SEO_FACTS_PROVIDER_PAGE_SIZE`
 * = 5 provider requests. The previous 10 000 was a number the port could never
 * fill — a single request returned at most one clamped page (200 rows) while the
 * index still advertised `ceil(count / 10 000)` children, so every tenant past
 * 200 eligible resources lost the remainder of its sitemap with no error
 * anywhere.
 */
export const SITEMAP_URLS_PER_PAGE = 1000;

/**
 * Hard cap on `listPublicResourceFacts` calls the service will spend filling ONE
 * provider's slice of ONE child sitemap — the bound that keeps the `nextCursor`
 * walk from becoming an unbounded query loop when a provider clamps very low (or
 * hands back a non-terminating cursor). Any provider serving at least
 * `SITEMAP_URLS_PER_PAGE / SITEMAP_PROVIDER_REQUESTS_PER_PAGE` (= 20) items per
 * request fills a complete child page within it; `blog_content` serves 200 and
 * needs 5.
 */
export const SITEMAP_PROVIDER_REQUESTS_PER_PAGE = 50;

/**
 * Hard cap on the number of child sitemaps the index will list. Bounds total
 * URLs surfaced at `SITEMAP_URLS_PER_PAGE * SITEMAP_MAX_CHILD_PAGES` so a runaway
 * tenant can never produce an unbounded index (sitemap amplification defense).
 * A tenant beyond this ceiling has its sitemap truncated (documented in the
 * operator runbook) rather than serving an unbounded response.
 */
export const SITEMAP_MAX_CHILD_PAGES = 1000;

/**
 * Public discovery HTTP cache policy. This is browser/shared-cache (CDN) level
 * caching via validators + `Cache-Control` — NOT a server-side content store.
 * The optional CDN/edge integration ADR-0038 §7 calls "opt-in, full-online-only"
 * is deliberately out of this issue's scope; when absent, behavior is unchanged
 * (offline-lan safe). Values are intentionally short so an invalidating content
 * change (publish/update/archive/delete/domain/config) is reflected quickly,
 * while `stale-while-revalidate` keeps the surface cheap under crawler load.
 */
export const DISCOVERY_CACHE_MAX_AGE_SECONDS = 300;
export const DISCOVERY_CACHE_S_MAXAGE_SECONDS = 300;
export const DISCOVERY_STALE_WHILE_REVALIDATE_SECONDS = 600;
