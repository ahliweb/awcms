/**
 * Search index utilities for full-text search using PostgreSQL pg_trgm.
 * Provides search functionality for pages, blogs, and other content.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SearchResult {
  id: string;
  type: "page" | "blog" | "product";
  title: string;
  slug: string;
  excerpt?: string;
  url: string;
  score: number;
}

export interface SearchOptions {
  types?: ("page" | "blog" | "product")[];
  limit?: number;
  offset?: number;
}

/**
 * Perform full-text search across content types
 */
export async function searchContent(
  supabase: SupabaseClient,
  query: string,
  tenantId?: string | null,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const { types = ["page", "blog"], limit = 20, offset = 0 } = options;

  if (!query.trim()) return [];

  const results: SearchResult[] = [];
  const searchTerm = `%${query.toLowerCase()}%`;

  // Search pages
  if (types.includes("page")) {
    const pageResults = await searchPages(
      supabase,
      searchTerm,
      tenantId,
      limit,
    );
    results.push(...pageResults);
  }

  // Search blogs
  if (types.includes("blog")) {
    const blogResults = await searchBlogs(
      supabase,
      searchTerm,
      tenantId,
      limit,
    );
    results.push(...blogResults);
  }

  // Sort by score and apply pagination
  return results
    .sort((a, b) => b.score - a.score)
    .slice(offset, offset + limit);
}

async function searchPages(
  supabase: SupabaseClient,
  searchTerm: string,
  tenantId?: string | null,
  limit: number = 10,
): Promise<SearchResult[]> {
  let query = supabase
    .from("pages")
    .select("id, title, slug, excerpt")
    .eq("status", "published")
    .eq("is_active", true)
    .is("deleted_at", null)
    .or(
      `title.ilike.${searchTerm},excerpt.ilike.${searchTerm},content.ilike.${searchTerm}`,
    )
    .limit(limit);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Search] Error searching pages:", error.message);
    return [];
  }

  return (data || []).map((page) => ({
    id: page.id,
    type: "page" as const,
    title: page.title,
    slug: page.slug,
    excerpt: page.excerpt || undefined,
    url: `/p/${page.slug}`,
    score: calculateScore(page.title, searchTerm),
  }));
}

async function searchBlogs(
  supabase: SupabaseClient,
  searchTerm: string,
  tenantId?: string | null,
  limit: number = 10,
): Promise<SearchResult[]> {
  let query = supabase
    .from("blogs")
    .select("id, title, slug, excerpt")
    .eq("status", "published")
    .is("deleted_at", null)
    .or(
      `title.ilike.${searchTerm},excerpt.ilike.${searchTerm},content.ilike.${searchTerm}`,
    )
    .limit(limit);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Search] Error searching blogs:", error.message);
    return [];
  }

  return (data || []).map((blog) => ({
    id: blog.id,
    type: "blog" as const,
    title: blog.title,
    slug: blog.slug,
    excerpt: blog.excerpt || undefined,
    url: `/blogs/${blog.slug}`,
    score: calculateScore(blog.title, searchTerm),
  }));
}

/**
 * Simple relevance score based on title match
 */
function calculateScore(title: string, searchTerm: string): number {
  const term = searchTerm.replace(/%/g, "").toLowerCase();
  const titleLower = title.toLowerCase();

  // Exact match
  if (titleLower === term) return 100;

  // Starts with
  if (titleLower.startsWith(term)) return 80;

  // Contains
  if (titleLower.includes(term)) return 60;

  // Default
  return 40;
}

/**
 * Get search suggestions (autocomplete)
 */
export async function getSearchSuggestions(
  supabase: SupabaseClient,
  query: string,
  tenantId?: string | null,
  limit: number = 5,
): Promise<string[]> {
  if (query.length < 2) return [];

  const searchTerm = `${query.toLowerCase()}%`;

  let queryBuilder = supabase
    .from("pages")
    .select("title")
    .eq("status", "published")
    .ilike("title", searchTerm)
    .limit(limit);

  if (tenantId) {
    queryBuilder = queryBuilder.eq("tenant_id", tenantId);
  }

  const { data, error } = await queryBuilder;

  if (error) return [];

  return (data || []).map((p) => p.title);
}
