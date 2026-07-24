/**
 * Sitemap protocol serialization (ADR-0038 §4) — sitemap INDEX
 * (`<sitemapindex>`) + child URL sets (`<urlset>`), with reciprocal `hreflang`
 * alternates (`xhtml:link`) and published image references (`image:image`).
 * Pure: no I/O.
 *
 * ## Escape, never reject (inherited contract)
 *
 * Every text/URL value is XML-escaped via `escapeXmlText` (strip the XML-1.0-illegal
 * C0 control chars, then the five XML predefined entities). Per the frozen `seo_facts` guard behavior, tenant
 * content is NEUTRALIZED by escaping, never rejected — a `<loc>` whose slug
 * contains `<`/`&` renders escaped, it never terminates an element. The values
 * here are already server-derived (host from `tenant_domain`, paths from the
 * provider), so this escaping is defense-in-depth against stored-markup injection.
 */
import { escapeXmlText } from "../../../lib/html/escape";
import {
  SITEMAP_MAX_CHILD_PAGES,
  SITEMAP_URLS_PER_PAGE
} from "./discovery-limits";

/** One child-sitemap entry in the index. */
export type SitemapIndexChild = {
  /** Absolute URL of the child sitemap (e.g. `https://host/sitemap-1.xml`). */
  loc: string;
  /** ISO-8601 `<lastmod>`, or `null` when unknown. */
  lastmod: string | null;
};

/** A reciprocal locale alternate for one URL (absolute href). */
export type SitemapAlternate = {
  /** BCP-47 tag or `"x-default"`. */
  hreflang: string;
  href: string;
};

/** One `<url>` entry in a child sitemap. */
export type SitemapUrlEntry = {
  /** Absolute canonical URL. */
  loc: string;
  lastmod: string | null;
  changefreq?: string;
  /** 0.0–1.0. */
  priority?: number;
  alternates: readonly SitemapAlternate[];
  /** Absolute image URLs (already resolved same-tenant/verified). */
  images: readonly string[];
};

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * How many child sitemaps the index advertises for `count` eligible URLs —
 * `ceil(count / perPage)`, but ALWAYS at least 1 (so `/sitemap-1.xml` always
 * exists, even for an empty site) and never more than `SITEMAP_MAX_CHILD_PAGES`
 * (the amplification ceiling — a tenant beyond it has its sitemap truncated).
 */
export function sitemapPageCount(
  count: number,
  perPage: number = SITEMAP_URLS_PER_PAGE
): number {
  const pages = Math.ceil(Math.max(0, count) / perPage);
  return Math.min(Math.max(1, pages), SITEMAP_MAX_CHILD_PAGES);
}

/** Render a `<sitemapindex>` listing the child sitemaps. */
export function renderSitemapIndex(
  children: readonly SitemapIndexChild[]
): string {
  const entries = children.map((child) => {
    const lastmod =
      child.lastmod !== null
        ? `\n    <lastmod>${escapeXmlText(child.lastmod)}</lastmod>`
        : "";
    return `  <sitemap>\n    <loc>${escapeXmlText(
      child.loc
    )}</loc>${lastmod}\n  </sitemap>`;
  });

  return `${XML_DECLARATION}
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</sitemapindex>
`;
}

function renderUrlEntry(entry: SitemapUrlEntry): string {
  const parts: string[] = [`    <loc>${escapeXmlText(entry.loc)}</loc>`];

  if (entry.lastmod !== null) {
    parts.push(`    <lastmod>${escapeXmlText(entry.lastmod)}</lastmod>`);
  }
  if (entry.changefreq !== undefined) {
    parts.push(
      `    <changefreq>${escapeXmlText(entry.changefreq)}</changefreq>`
    );
  }
  if (entry.priority !== undefined) {
    parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
  }
  for (const alt of entry.alternates) {
    parts.push(
      `    <xhtml:link rel="alternate" hreflang="${escapeXmlText(
        alt.hreflang
      )}" href="${escapeXmlText(alt.href)}" />`
    );
  }
  for (const image of entry.images) {
    parts.push(
      `    <image:image><image:loc>${escapeXmlText(
        image
      )}</image:loc></image:image>`
    );
  }

  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

/** Render a `<urlset>` (one child sitemap page) with hreflang + image extensions. */
export function renderUrlset(urls: readonly SitemapUrlEntry[]): string {
  const entries = urls.map(renderUrlEntry);

  return `${XML_DECLARATION}
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join("\n")}
</urlset>
`;
}
