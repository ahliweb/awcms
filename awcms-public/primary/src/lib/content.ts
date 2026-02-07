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
): Promise<PageData | null> {
  let query = supabase
    .from("pages")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published");

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
  limit = 100,
): Promise<PageData[]> {
  let query = supabase
    .from("pages")
    .select("*")
    .eq("status", "published")
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
): Promise<PageData | null> {
  let query = supabase
    .from("pages")
    .select("*")
    .eq("page_type", pageType)
    .eq("status", "published");

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
): Promise<BlogData | null> {
  let query = supabase
    .from("blogs")
    .select(
      `
      *,
      category:categories!blogs_category_id_fkey(id, name, slug)
    `,
    )
    .eq("slug", slug)
    .eq("status", "published");

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query.maybeSingle();

  if (!error) {
    return (data || null) as BlogData | null;
  }

  const errorMessage = error.message || "";
  if (
    !errorMessage.includes("relationship") &&
    !errorMessage.includes("schema cache")
  ) {
    console.error("[Content] Error fetching blog:", errorMessage);
    return null;
  }

  let fallbackQuery = supabase
    .from("blogs")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published");

  if (tenantId) {
    fallbackQuery = fallbackQuery.eq("tenant_id", tenantId);
  }

  const { data: fallbackData, error: fallbackError } = await fallbackQuery
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    console.error("[Content] Error fetching blog:", fallbackError.message);
    return null;
  }

  if (!fallbackData) {
    return null;
  }

  let category = null;
  if (fallbackData.category_id) {
    const { data: categoryData } = await supabase
      .from("categories")
      .select("id, name, slug")
      .eq("id", fallbackData.category_id)
      .maybeSingle();
    category = categoryData || null;
  }

  return {
    ...(fallbackData as BlogData),
    category,
  };
}

/**
 * Fetch all published blogs with pagination
 */
export async function getBlogs(
  supabase: SupabaseClient,
  tenantId?: string | null,
  options: { limit?: number; offset?: number; categorySlug?: string } = {},
): Promise<{ blogs: BlogData[]; total: number }> {
  const { limit = 10, offset = 0, categorySlug } = options;

  let query = supabase
    .from("blogs")
    .select(
      `
      *,
      category:categories!blogs_category_id_fkey(id, name, slug)
    `,
      { count: "exact" },
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  // Filter by category if provided
  if (categorySlug) {
    query = query.eq("category.slug", categorySlug);
  }

  const { data, error, count } = await query;

  if (!error) {
    return {
      blogs: (data || []) as BlogData[],
      total: count || 0,
    };
  }

  const errorMessage = error.message || "";
  if (
    !errorMessage.includes("relationship") &&
    !errorMessage.includes("schema cache")
  ) {
    console.error("[Content] Error fetching blogs:", errorMessage);
    return { blogs: [], total: 0 };
  }

  let categoryId: string | null = null;
  if (categorySlug) {
    const { data: categoryData, error: categoryError } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", categorySlug)
      .maybeSingle();

    if (categoryError) {
      console.error(
        "[Content] Error fetching category:",
        categoryError.message,
      );
      return { blogs: [], total: 0 };
    }

    if (!categoryData) {
      return { blogs: [], total: 0 };
    }

    categoryId = categoryData.id as string;
  }

  let fallbackQuery = supabase
    .from("blogs")
    .select("*", { count: "exact" })
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (tenantId) {
    fallbackQuery = fallbackQuery.eq("tenant_id", tenantId);
  }

  if (categoryId) {
    fallbackQuery = fallbackQuery.eq("category_id", categoryId);
  }

  const {
    data: fallbackData,
    error: fallbackError,
    count: fallbackCount,
  } = await fallbackQuery;

  if (fallbackError) {
    console.error("[Content] Error fetching blogs:", fallbackError.message);
    return { blogs: [], total: 0 };
  }

  const blogs = (fallbackData || []) as BlogData[];
  const categoryIds = Array.from(
    new Set(blogs.map((blog) => blog.category_id).filter(Boolean)),
  ) as string[];

  if (categoryIds.length > 0) {
    const { data: categoriesData } = await supabase
      .from("categories")
      .select("id, name, slug")
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
    total: fallbackCount || 0,
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
