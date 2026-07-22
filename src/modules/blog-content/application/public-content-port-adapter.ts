/**
 * Concrete `PublicContentPort` implementation (Issue #681, epic #679
 * platform-hardening) — `blog_content`'s own capability, wired into
 * `news_portal`'s homepage-section composer/reference-validation at the
 * composition root (route handlers), never imported by `news_portal`'s
 * `application`/`domain` files directly. See
 * `_shared/ports/public-content-port.ts` for the full "why a port"
 * reasoning.
 *
 * `postExists` uses the ADMIN-facing `fetchBlogPostById` (not a public-
 * visibility-filtered query) deliberately — Issue #637's write-time
 * reference validation only needs to confirm a curated `postId` exists
 * for this tenant (an editor may curate a not-yet-published post), while
 * `fetchPostSummariesByIds`/`listPosts`/`listPostsByCategoryId` (used at
 * RENDER time) correctly stay public-visibility-filtered
 * (`fetchPublicBlogPostSummariesByIds`/`listPublicBlogPosts`/
 * `listPublicBlogPostsByTermId`) — the same existence-vs-visibility split
 * `homepage-section-reference-validation.ts` already relied on before
 * this extraction.
 */
import { fetchBlogPostById } from "./blog-post-directory";
import {
  fetchPublicBlogPostSummariesByIds,
  fetchPublicTermBySlug,
  listPublicBlogPosts,
  listPublicBlogPostsByTermId
} from "./public-blog-directory";
import type {
  PublicContentCategoryDTO,
  PublicContentPort,
  PublicContentPostPageDTO,
  PublicContentPostSummaryDTO
} from "../../_shared/ports/public-content-port";

export const publicContentPortAdapter: PublicContentPort = {
  async postExists(
    tx: Bun.SQL,
    tenantId: string,
    postId: string
  ): Promise<boolean> {
    const post = await fetchBlogPostById(tx, tenantId, postId);
    return post !== null;
  },

  async fetchPostSummariesByIds(
    tx: Bun.SQL,
    tenantId: string,
    postIds: readonly string[]
  ): Promise<PublicContentPostSummaryDTO[]> {
    const posts = await fetchPublicBlogPostSummariesByIds(
      tx,
      tenantId,
      postIds
    );
    return posts.map((post) => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      featuredMediaId: post.featuredMediaId
    }));
  },

  async fetchCategoryBySlug(
    tx: Bun.SQL,
    tenantId: string,
    slug: string
  ): Promise<PublicContentCategoryDTO | null> {
    const term = await fetchPublicTermBySlug(tx, tenantId, "category", slug);
    return term ? { id: term.id, name: term.name, slug: term.slug } : null;
  },

  async listPosts(
    tx: Bun.SQL,
    tenantId: string,
    options: { pageSize?: number }
  ): Promise<PublicContentPostPageDTO> {
    const page = await listPublicBlogPosts(tx, tenantId, {
      pageSize: options.pageSize
    });
    return {
      items: page.items.map((post) => ({
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        featuredMediaId: post.featuredMediaId
      })),
      hasNextPage: page.hasNextPage
    };
  },

  async listPostsByCategoryId(
    tx: Bun.SQL,
    tenantId: string,
    categoryId: string,
    options: { pageSize?: number }
  ): Promise<PublicContentPostPageDTO> {
    const page = await listPublicBlogPostsByTermId(tx, tenantId, categoryId, {
      pageSize: options.pageSize
    });
    return {
      items: page.items.map((post) => ({
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        featuredMediaId: post.featuredMediaId
      })),
      hasNextPage: page.hasNextPage
    };
  }
};
