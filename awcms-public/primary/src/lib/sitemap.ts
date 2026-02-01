/**
 * Sitemap generator for dynamic content from Supabase.
 * Generates XML sitemap entries for pages, blogs, and other content.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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
    .select("slug, updated_at, page_type")
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

  return (data || []).map((page) => ({
    loc: `${baseUrl}/p/${page.slug}`,
    lastmod: page.updated_at,
    changefreq: page.page_type === "homepage" ? "daily" : "weekly",
    priority: page.page_type === "homepage" ? 1.0 : 0.8,
  }));
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
    .select("slug, updated_at, published_at")
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

  return (data || []).map((blog) => ({
    loc: `${baseUrl}/blogs/${blog.slug}`,
    lastmod: blog.updated_at || blog.published_at,
    changefreq: "weekly" as const,
    priority: 0.7,
  }));
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
    { loc: baseUrl, changefreq: "daily", priority: 1.0 },
    { loc: `${baseUrl}/blogs`, changefreq: "daily", priority: 0.9 },
    { loc: `${baseUrl}/contact`, changefreq: "monthly", priority: 0.5 },
  ];

  return [...staticEntries, ...pages, ...blogs];
}
