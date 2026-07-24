/**
 * `robots.txt` serialization (ADR-0038 §4). Pure: turns the tenant's
 * server-derived host + resolved SEO config into a bounded, injection-free
 * robots.txt body.
 *
 * ## Safe by construction — no tenant-authored directive lines
 *
 * A tenant CANNOT inject arbitrary robots.txt lines. The only tenant inputs that
 * shape this file are structured booleans (`siteNoindex`, `sitemapEnabled`); the
 * directive lines themselves are fixed strings chosen here. This is the
 * "robots directives within safe bounds" the ADR requires: raw per-path rules
 * are deliberately NOT tenant-editable (that would be a line-injection surface on
 * the operator's shared robots.txt), so there is no user string to escape here at
 * all. The absolute `Sitemap:` URL is built only from the SERVER-DERIVED primary
 * host (never the request `Host`), and only when one is verified.
 */

export type RobotsRenderInput = {
  /** Tenant's verified primary host (server-derived from `tenant_domain`), or `null` when there is none. */
  primaryHost: string | null;
  /** Tenant-wide noindex switch (`default_robots_noindex`) — when true, disallow all crawling. */
  siteNoindex: boolean;
  /** Whether to advertise the sitemap (config `sitemap_enabled`). */
  sitemapEnabled: boolean;
};

/**
 * Render the robots.txt body. Two mutually-exclusive shapes:
 *
 * - **Whole-site noindex** (`siteNoindex`): `Disallow: /` for all agents and NO
 *   sitemap advertised — a site kept out of the index has nothing to crawl.
 * - **Normal**: crawlable, with `/admin/` and `/api/` disallowed (non-public
 *   surfaces), plus a `Sitemap:` line pointing at the absolute
 *   `https://{primaryHost}/sitemap.xml` when a verified host exists AND sitemaps
 *   are enabled. Without a verified host the `Sitemap:` line is omitted (the
 *   directive requires an absolute URL and we never invent a host — offline-lan
 *   safe, ADR-0038 §5.4).
 */
export function renderRobotsTxt(input: RobotsRenderInput): string {
  const lines: string[] = ["User-agent: *"];

  if (input.siteNoindex) {
    lines.push("Disallow: /");
    return lines.join("\n") + "\n";
  }

  // Keep crawlers out of the non-public surfaces regardless of tenant config.
  lines.push("Disallow: /admin/");
  lines.push("Disallow: /api/");

  if (input.sitemapEnabled && input.primaryHost !== null) {
    lines.push("");
    lines.push(`Sitemap: https://${input.primaryHost}/sitemap.xml`);
  }

  return lines.join("\n") + "\n";
}
