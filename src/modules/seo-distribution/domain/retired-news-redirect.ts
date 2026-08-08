/**
 * Retirement redirect for the `/news/**` family: `/news/...` → `/blog/{tenantCode}/...`.
 *
 * ## This file is the INVERSE of what stood here before
 *
 * ADR-0039 shipped `legacy-blog-redirect.ts`, which pointed `/blog/{tenantCode}`
 * at `/news` — the direction awcms-micro used, where `/news` was the canonical
 * shape. [ADR-0071](../../../../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
 * splits the family's URL vocabulary the other way: `/blog/**` is this repo's
 * permanent vocabulary and `/news/**` belongs to `ahliweb/awcms-astro`. So the
 * old direction now points at a family this repo no longer serves, and the
 * mapping is turned around rather than deleted — the four `/news/**` routes were
 * live and ON by default, and their URLs are in sitemaps and feeds this repo
 * published.
 *
 * ## Why this is not policy-gated
 *
 * The old direction had a per-tenant switch (`legacy_blog_redirect_enabled`),
 * which was correct for an OPTIONAL rewrite. This one is not optional: the
 * routes are gone, so every `/news/**` request either redirects or 404s, and a
 * 301 to the content's real address is strictly better for a reader and for a
 * crawler. A tenant cannot opt into serving a route that no longer exists.
 *
 * ## The one condition that DOES apply
 *
 * A tenant whose `legacyTenantRouteEnabled` is `false` has no `/blog/**` either
 * — it turned its public content surface off entirely. Redirecting it to
 * `/blog/{tenantCode}` would hand a reader a 301 to a guaranteed 404, which is
 * the exact failure ADR-0059 §C existed to prevent and which ADR-0071 §3
 * restates. For that tenant the honest answer is the 404 it already chose, so
 * the caller skips the redirect. "Never advertise a URL we do not serve" applies
 * to redirect targets as much as to sitemap entries.
 *
 * Path mapping only — the caller resolves the tenant from the request host,
 * supplies its `tenantCode`, and validates the final absolute URL through the
 * frozen open-redirect guard, exactly as the old direction did.
 */

/** The retired family's root. `/news` and everything under it. */
export const RETIRED_NEWS_BASE_PATH = "/news";

/**
 * Parse a `/news/...` request path into the remainder that must be carried over
 * to `/blog/{tenantCode}`, or `null` when the path is not in the retired family.
 *
 * `/news` → `""`; `/news/hello` → `"/hello"`; `/news/category/x` →
 * `"/category/x"`. `/newsletter` is NOT in the family and returns `null` — a
 * prefix match without the segment boundary would capture every path that
 * merely starts with those five letters, and this repo has shipped a
 * `newsletter` capability name since ADR-0035.
 *
 * Plain segment work, no regex backtracking — same shape as the mapping it
 * replaces.
 */
export function parseRetiredNewsPath(pathname: string): string | null {
  if (typeof pathname !== "string") return null;

  if (pathname === RETIRED_NEWS_BASE_PATH) return "";

  if (!pathname.startsWith(`${RETIRED_NEWS_BASE_PATH}/`)) return null;

  return pathname.slice(RETIRED_NEWS_BASE_PATH.length);
}

/**
 * Build the `/blog/{tenantCode}` path equivalent of a parsed retired path.
 *
 * `("acme", "")` → `/blog/acme`; `("acme", "/hello")` → `/blog/acme/hello`.
 */
export function buildLegacyBlogPath(tenantCode: string, rest: string): string {
  return `/blog/${tenantCode}${rest}`;
}
