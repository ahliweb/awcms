/**
 * Content fetching utilities for dynamic pages and blogs from Supabase.
 * Used by dynamic routes like /p/[slug] and /blogs/[slug]
 */
import type { SupabaseClient } from "@supabase/supabase-js";

interface ContentTranslationRow {
  content_id: string;
  locale: string;
  content_type?: string;
  title?: string | null;
  slug?: string | null;
  content?: string | null;
  excerpt?: string | null;
  meta_description?: string | null;
}

type TranslationContentType = "page" | "article";

function parseVisualTranslationContent(
  rawContent: string | null | undefined,
): Record<string, unknown> | null {
  if (!rawContent) return null;

  try {
    const parsed = JSON.parse(rawContent);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

async function getPageTranslationBySlug(
  supabase: SupabaseClient,
  slug: string,
  locale?: string,
  tenantId?: string | null,
): Promise<ContentTranslationRow | null> {
  return getContentTranslationBySlug(supabase, "page", slug, locale, tenantId);
}

async function getContentTranslationBySlug(
  supabase: SupabaseClient,
  contentType: TranslationContentType,
  slug: string,
  locale?: string,
  tenantId?: string | null,
): Promise<ContentTranslationRow | null> {
  if (!locale || locale === "id") return null;

  let query = supabase
    .from("content_translations")
    .select(
      "content_id, locale, title, slug, content, excerpt, meta_description",
    )
    .eq("content_type", contentType)
    .eq("locale", locale)
    .eq("slug", slug);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error(
      "[Content] Error fetching page translation by slug:",
      error.message,
    );
    return null;
  }

  return (data as ContentTranslationRow | null) || null;
}

async function getPageTranslations(
  supabase: SupabaseClient,
  locale?: string,
  tenantId?: string | null,
  contentIds: string[] = [],
): Promise<Map<string, ContentTranslationRow>> {
  return getContentTranslations(supabase, "page", locale, tenantId, contentIds);
}

async function getContentTranslations(
  supabase: SupabaseClient,
  contentType: TranslationContentType,
  locale?: string,
  tenantId?: string | null,
  contentIds: string[] = [],
): Promise<Map<string, ContentTranslationRow>> {
  if (!locale || locale === "id" || contentIds.length === 0) {
    return new Map<string, ContentTranslationRow>();
  }

  let query = supabase
    .from("content_translations")
    .select(
      "content_id, locale, title, slug, content, excerpt, meta_description",
    )
    .eq("content_type", contentType)
    .eq("locale", locale)
    .in("content_id", contentIds);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Content] Error fetching page translations:", error.message);
    return new Map<string, ContentTranslationRow>();
  }

  return new Map(
    (data || []).map((row) => [row.content_id, row as ContentTranslationRow]),
  );
}

function mergePageTranslation(
  page: PageData,
  translation?: ContentTranslationRow | null,
): PageData {
  if (!translation) return page;

  const translatedVisualContent = parseVisualTranslationContent(
    translation.content,
  );
  const isVisual = page.editor_type === "visual";

  return {
    ...page,
    title: translation.title || page.title,
    slug: translation.slug || page.slug,
    excerpt: translation.excerpt || page.excerpt,
    meta_description: translation.meta_description || page.meta_description,
    content:
      !isVisual && translation.content ? translation.content : page.content,
    content_published: translatedVisualContent || page.content_published,
    visual_content: translatedVisualContent || page.visual_content,
  };
}

function mergeBlogTranslation(
  blog: BlogData,
  translation?: ContentTranslationRow | null,
): BlogData {
  if (!translation) return blog;

  const translatedVisualContent = parseVisualTranslationContent(
    translation.content,
  );
  const isVisual = blog.editor_type === "visual";

  return {
    ...blog,
    title: translation.title || blog.title,
    slug: translation.slug || blog.slug,
    excerpt: translation.excerpt || blog.excerpt,
    content:
      !isVisual && translation.content ? translation.content : blog.content,
    visual_content: translatedVisualContent || blog.visual_content,
  };
}

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
  content_draft?: Record<string, unknown> | null;
  content_published?: Record<string, unknown> | null;
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
  author?: {
    full_name: string;
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
  locale?: string,
): Promise<PageData | null> {
  const translationMatch = await getPageTranslationBySlug(
    supabase,
    slug,
    locale,
    tenantId,
  );

  let query = supabase
    .from("pages")
    .select("*")
    .eq("status", "published")
    .is("deleted_at", null);

  if (translationMatch?.content_id) {
    query = query.eq("id", translationMatch.content_id);
  } else {
    query = query.eq("slug", slug);
  }

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

  return mergePageTranslation(data as PageData, translationMatch);
}

/**
 * Fetch all published pages (for sitemap or listing)
 */
export async function getAllPages(
  supabase: SupabaseClient,
  tenantId?: string | null,
  locale?: string,
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

  const pages = (data || []) as PageData[];
  const translations = await getPageTranslations(
    supabase,
    locale,
    tenantId,
    pages.map((page) => page.id),
  );

  return pages.map((page) =>
    mergePageTranslation(page, translations.get(page.id) || null),
  );
}

/**
 * Fetch a single page by its page_type
 */
export async function getPageByType(
  supabase: SupabaseClient,
  pageType: string,
  tenantId?: string | null,
  locale?: string,
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

  const page = (data || null) as PageData | null;
  if (!page) return null;

  const translations = await getPageTranslations(supabase, locale, tenantId, [
    page.id,
  ]);
  return mergePageTranslation(page, translations.get(page.id) || null);
}

/**
 * Fetch a single blog by its slug
 */
export async function getBlogBySlug(
  supabase: SupabaseClient,
  slug: string,
  tenantId?: string | null,
  locale?: string,
): Promise<BlogData | null> {
  const translationMatch = await getContentTranslationBySlug(
    supabase,
    "article",
    slug,
    locale,
    tenantId,
  );

  let query = supabase
    .from("blogs")
    .select("*")
    .eq("status", "published")
    .is("deleted_at", null);

  if (translationMatch?.content_id) {
    query = query.eq("id", translationMatch.content_id);
  } else {
    query = query.eq("slug", slug);
  }

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

  let author = null;
  if (data.author_id) {
    const { data: authorData } = await supabase
      .from("users")
      .select("full_name")
      .eq("id", data.author_id)
      .is("deleted_at", null)
      .maybeSingle();
    author = authorData || null;
  }

  let tags: Array<{ id: string; name: string; slug: string }> = [];
  const { data: blogTagRows } = await supabase
    .from("blog_tags")
    .select("tag_id")
    .eq("blog_id", data.id);

  const tagIds = (blogTagRows || []).map((row) => row.tag_id).filter(Boolean);
  if (tagIds.length > 0) {
    const { data: tagRows } = await supabase
      .from("tags")
      .select("id, name, slug")
      .in("id", tagIds)
      .is("deleted_at", null);
    tags = (tagRows || []) as Array<{ id: string; name: string; slug: string }>;
  }

  return mergeBlogTranslation(
    {
      ...(data as BlogData),
      category,
      author,
      tags,
    },
    translationMatch,
  );
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
    tagSlug?: string;
    locale?: string;
  } = {},
): Promise<{ blogs: BlogData[]; total: number }> {
  const { limit = 10, offset = 0, categorySlug, tagSlug, locale } = options;

  let categoryId: string | null = null;
  if (categorySlug) {
    const { data: categoryData, error: categoryError } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", categorySlug)
      .is("deleted_at", null)
      .maybeSingle();

    if (categoryError) {
      console.error(
        "[Content] Error resolving blog category:",
        categoryError.message,
      );
      return { blogs: [], total: 0 };
    }

    if (!categoryData?.id) {
      return { blogs: [], total: 0 };
    }

    categoryId = categoryData.id;
  }

  let taggedBlogIds: string[] | null = null;
  if (tagSlug) {
    const { data: tagData, error: tagError } = await supabase
      .from("tags")
      .select("id")
      .eq("slug", tagSlug)
      .is("deleted_at", null)
      .maybeSingle();

    if (tagError) {
      console.error("[Content] Error resolving blog tag:", tagError.message);
      return { blogs: [], total: 0 };
    }

    if (!tagData?.id) {
      return { blogs: [], total: 0 };
    }

    let blogTagsQuery = supabase
      .from("blog_tags")
      .select("blog_id")
      .eq("tag_id", tagData.id);

    if (tenantId) {
      blogTagsQuery = blogTagsQuery.eq("tenant_id", tenantId);
    }

    const { data: blogTagRows, error: blogTagsError } = await blogTagsQuery;

    if (blogTagsError) {
      console.error(
        "[Content] Error resolving tagged blogs:",
        blogTagsError.message,
      );
      return { blogs: [], total: 0 };
    }

    taggedBlogIds = (blogTagRows || [])
      .map((row) => row.blog_id)
      .filter(Boolean);
    if (taggedBlogIds.length === 0) {
      return { blogs: [], total: 0 };
    }
  }

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

  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }

  if (taggedBlogIds) {
    query = query.in("id", taggedBlogIds);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[Content] Error fetching blogs:", error.message);
    return { blogs: [], total: 0 };
  }

  const blogs = (data || []) as BlogData[];
  const translations = await getContentTranslations(
    supabase,
    "article",
    locale,
    tenantId,
    blogs.map((blog) => blog.id),
  );

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

  const localizedBlogs = blogs.map((blog) =>
    mergeBlogTranslation(blog, translations.get(blog.id) || null),
  );

  return {
    blogs: localizedBlogs,
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
