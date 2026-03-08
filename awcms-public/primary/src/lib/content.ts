/**
 * Content fetching utilities for dynamic pages and blogs from Supabase.
 * Used by dynamic routes like /p/[slug] and /blogs/[slug]
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PageData {
  id: string;
  title: string;
  slug: string;
  content: string | null;
  visual_content: Record<string, unknown> | null;
  content_draft: Record<string, unknown> | null;
  content_published: Record<string, unknown> | null;
  puck_layout_jsonb: Record<string, unknown> | null;
  editor_type: "richtext" | "visual" | "markdown";
  excerpt: string | null;
  featured_image: string | null;
  meta_description: string | null;
  meta_title: string | null;
  meta_keywords: string | null;
  og_image: string | null;
  canonical_url: string | null;
  category_id: string | null;
  tags: string[] | null;
  status: string;
  page_type: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogData {
  id: string;
  title: string;
  slug: string;
  content: string | null;
  visual_content: Record<string, unknown> | null;
  editor_type: "richtext" | "visual";
  excerpt: string | null;
  featured_image: string | null;
  workflow_state: string;
  status: string;
  views: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  category_id?: string | null;
  category?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  tags?: Array<{ id: string; name: string; slug: string }>;
}

/**
 * Fetch a single page by its slug
 */
export async function getPageBySlug(
  supabase: SupabaseClient,
  slug: string,
  tenantId?: string | null,
  _locale?: string,
): Promise<PageData | null> {
  let query = supabase
    .from("pages")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .is("deleted_at", null);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[Content] Error fetching page:", error.message);
    return null;
  }

  return data as PageData;
}

/**
 * Fetch all published pages (for sitemap or listing)
 */
export async function getAllPages(
  supabase: SupabaseClient,
  tenantId?: string | null,
  _locale?: string,
  limit = 100,
): Promise<PageData[]> {
  let query = supabase
    .from("pages")
    .select("*")
    .eq("status", "published")
    .is("deleted_at", null)
    .eq("page_type", "regular")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Content] Error fetching pages:", error.message);
    return [];
  }

  return (data || []) as PageData[];
}

/**
 * Fetch a single page by its page_type
 */
export async function getPageByType(
  supabase: SupabaseClient,
  pageType: string,
  tenantId?: string | null,
  _locale?: string,
): Promise<PageData | null> {
  let query = supabase
    .from("pages")
    .select("*")
    .eq("page_type", pageType)
    .eq("status", "published")
    .is("deleted_at", null);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[Content] Error fetching page by type:", error.message);
    return null;
  }

  return (data || null) as PageData | null;
}

/**
 * Fetch a single blog by its slug
 */
export async function getBlogBySlug(
  supabase: SupabaseClient,
  slug: string,
  tenantId?: string | null,
  _locale?: string,
): Promise<BlogData | null> {
  let query = supabase
    .from("blogs")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .is("deleted_at", null);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("[Content] Error fetching blog:", error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  // Fetch category separately
  let category = null;
  if (data.category_id) {
    const { data: categoryData } = await supabase
      .from("categories")
      .select("id, name, slug")
      .eq("id", data.category_id)
      .is("deleted_at", null)
      .maybeSingle();
    category = categoryData || null;
  }

  return {
    ...(data as BlogData),
    category,
  };
}

/**
 * Fetch all published blogs with pagination
 */
export async function getBlogs(
  supabase: SupabaseClient,
  tenantId?: string | null,
  options: {
    limit?: number;
    offset?: number;
    categorySlug?: string;
  } = {},
): Promise<{ blogs: BlogData[]; total: number }> {
  const { limit = 10, offset = 0, categorySlug } = options;

  let query = supabase
    .from("blogs")
    .select("*", { count: "exact" })
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  if (categorySlug) {
    query = query.eq("category_id", categorySlug);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[Content] Error fetching blogs:", error.message);
    return { blogs: [], total: 0 };
  }

  const blogs = (data || []) as BlogData[];

  // Fetch categories separately
  const categoryIds = Array.from(
    new Set(blogs.map((blog) => blog.category_id).filter(Boolean)),
  ) as string[];

  if (categoryIds.length > 0) {
    const { data: categoriesData } = await supabase
      .from("categories")
      .select("id, name, slug")
      .is("deleted_at", null)
      .in("id", categoryIds);

    const categoryMap = new Map(
      (categoriesData || []).map((category) => [category.id, category]),
    );

    for (const blog of blogs) {
      if (blog.category_id) {
        blog.category = categoryMap.get(blog.category_id) || null;
      }
    }
  }

  return {
    blogs,
    total: count || 0,
  };
}

/**
 * Increment blog view count
 */
export async function incrementBlogViews(
  supabase: SupabaseClient,
  blogId: string,
): Promise<void> {
  await supabase.rpc("increment_blog_views", { blog_id: blogId });
}
