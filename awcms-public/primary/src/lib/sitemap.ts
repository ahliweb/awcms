/**
 * Sitemap generator for dynamic content from Supabase.
 * Generates XML sitemap entries for pages, blogs, and other content.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supportedLocales, defaultLocale } from "~/utils/i18n";

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
}

/**
 * Generate sitemap entries for all published pages
 */
export async function getPagesSitemapEntries(
  supabase: SupabaseClient,
  baseUrl: string,
  tenantId?: string | null,
): Promise<SitemapEntry[]> {
  let query = supabase
    .from("pages")
    .select("id, slug, updated_at, page_type")
    .eq("status", "published")
    .eq("is_active", true)
    .is("deleted_at", null);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Sitemap] Error fetching pages:", error.message);
    return [];
  }

  const pages = data || [];
  const pageIds = pages.map((page) => page.id).filter(Boolean);
  let translationMap = new Map<string, Map<string, string>>();

  if (pageIds.length > 0) {
    let translationQuery = supabase
      .from("content_translations")
      .select("content_id, locale, slug")
      .eq("content_type", "page")
      .in("content_id", pageIds);

    if (tenantId) {
      translationQuery = translationQuery.eq("tenant_id", tenantId);
    }

    const { data: translations, error: translationsError } =
      await translationQuery;

    if (translationsError) {
      console.error(
        "[Sitemap] Error fetching page translations:",
        translationsError.message,
      );
    } else {
      translationMap = (translations || []).reduce((acc, row) => {
        if (!row.content_id || !row.locale || !row.slug) return acc;
        const localeEntries =
          acc.get(row.content_id) || new Map<string, string>();
        localeEntries.set(row.locale, row.slug);
        acc.set(row.content_id, localeEntries);
        return acc;
      }, new Map<string, Map<string, string>>());
    }
  }

  return pages.flatMap((page) => {
    const localeSlugs =
      translationMap.get(page.id) || new Map<string, string>();

    return supportedLocales.map((locale) => ({
      loc: `${baseUrl}/${locale}/p/${locale === defaultLocale ? page.slug : localeSlugs.get(locale) || page.slug}`,
      lastmod: page.updated_at,
      changefreq: page.page_type === "homepage" ? "daily" : "weekly",
      priority: page.page_type === "homepage" ? 1.0 : 0.8,
    }));
  });
}

/**
 * Generate sitemap entries for all published blogs
 */
export async function getBlogsSitemapEntries(
  supabase: SupabaseClient,
  baseUrl: string,
  tenantId?: string | null,
): Promise<SitemapEntry[]> {
  let query = supabase
    .from("blogs")
    .select("id, slug, updated_at, published_at")
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Sitemap] Error fetching blogs:", error.message);
    return [];
  }

  const blogs = data || [];
  const blogIds = blogs.map((blog) => blog.id).filter(Boolean);
  let translationMap = new Map<string, Map<string, string>>();

  if (blogIds.length > 0) {
    let translationQuery = supabase
      .from("content_translations")
      .select("content_id, locale, slug")
      .eq("content_type", "article")
      .in("content_id", blogIds);

    if (tenantId) {
      translationQuery = translationQuery.eq("tenant_id", tenantId);
    }

    const { data: translations, error: translationsError } =
      await translationQuery;

    if (translationsError) {
      console.error(
        "[Sitemap] Error fetching blog translations:",
        translationsError.message,
      );
    } else {
      translationMap = (translations || []).reduce((acc, row) => {
        if (!row.content_id || !row.locale || !row.slug) return acc;
        const localeEntries =
          acc.get(row.content_id) || new Map<string, string>();
        localeEntries.set(row.locale, row.slug);
        acc.set(row.content_id, localeEntries);
        return acc;
      }, new Map<string, Map<string, string>>());
    }
  }

  return blogs.flatMap((blog) => {
    const localeSlugs =
      translationMap.get(blog.id) || new Map<string, string>();

    return supportedLocales.map((locale) => ({
      loc: `${baseUrl}/${locale}/blogs/${locale === defaultLocale ? blog.slug : localeSlugs.get(locale) || blog.slug}`,
      lastmod: blog.updated_at || blog.published_at,
      changefreq: "weekly" as const,
      priority: 0.7,
    }));
  });
}

/**
 * Generate full sitemap XML
 */
export function generateSitemapXml(entries: SitemapEntry[]): string {
  const urlEntries = entries
    .map(
      (entry) => `
  <url>
    <loc>${escapeXml(entry.loc)}</loc>${
      entry.lastmod
        ? `
    <lastmod>${new Date(entry.lastmod).toISOString()}</lastmod>`
        : ""
    }${
      entry.changefreq
        ? `
    <changefreq>${entry.changefreq}</changefreq>`
        : ""
    }${
      entry.priority !== undefined
        ? `
    <priority>${entry.priority.toFixed(1)}</priority>`
        : ""
    }
  </url>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlEntries}
</urlset>`;
}

/**
 * Generate sitemap index for multiple sitemaps
 */
export function generateSitemapIndexXml(
  sitemaps: { loc: string; lastmod?: string }[],
): string {
  const sitemapEntries = sitemaps
    .map(
      (sitemap) => `
  <sitemap>
    <loc>${escapeXml(sitemap.loc)}</loc>${
      sitemap.lastmod
        ? `
    <lastmod>${new Date(sitemap.lastmod).toISOString()}</lastmod>`
        : ""
    }
  </sitemap>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapEntries}
</sitemapindex>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Get combined sitemap entries for all content types
 */
export async function getAllSitemapEntries(
  supabase: SupabaseClient,
  baseUrl: string,
  tenantId?: string | null,
): Promise<SitemapEntry[]> {
  const [pages, blogs] = await Promise.all([
    getPagesSitemapEntries(supabase, baseUrl, tenantId),
    getBlogsSitemapEntries(supabase, baseUrl, tenantId),
  ]);

  // Add static pages
  const staticEntries: SitemapEntry[] = [
    ...supportedLocales.flatMap((locale) => [
      {
        loc: `${baseUrl}/${locale}`,
        changefreq: "daily" as const,
        priority: 1.0,
      },
      {
        loc: `${baseUrl}/${locale}/blogs`,
        changefreq: "daily" as const,
        priority: 0.9,
      },
      {
        loc: `${baseUrl}/${locale}/contact`,
        changefreq: "monthly" as const,
        priority: 0.5,
      },
    ]),
  ];

  return [...staticEntries, ...pages, ...blogs];
}
