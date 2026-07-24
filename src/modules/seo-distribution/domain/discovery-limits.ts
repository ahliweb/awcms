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
 * URLs per child sitemap. Conservative (well under the 50k protocol ceiling) so
 * a child stays small; the sitemap index maps child page N to
 * `offset = (N-1)*SITEMAP_URLS_PER_PAGE` of the provider's stable `id_asc` order.
 */
export const SITEMAP_URLS_PER_PAGE = 10000;

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
