import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../lib/database/client";
import { publishEdgeCacheTenant } from "../../../lib/edge-cache/publish-tenant";
import { escapeHtml } from "../../../lib/html/escape";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../../lib/html/error-responses";
import { log } from "../../../lib/logging/logger";
import { parsePageParam } from "../../../modules/_shared/offset-pagination";
import {
  fetchPublicTermBySlug,
  listPublicBlogPostsByTermId
} from "../../../modules/blog-content/application/public-blog-directory";
import {
  HOST_RESOLVED_PUBLIC_BASE_PATH,
  withHostResolvedBlogTenant
} from "../../../modules/blog-content/application/public-host-route-tenant-resolution";
import {
  renderPaginationNavHtml,
  renderPostSummaryListHtmlAtBasePath,
  renderPublicPageShell
} from "../../../modules/blog-content/domain/public-page-rendering";

/**
 * `GET /news/category/{slug}` (ADR-0059 §A) — host-resolved category archive,
 * the same listing predicate as `/news` scoped to one `category` term. An
 * unknown or soft-deleted term returns the same generic 404 as an unresolved
 * host.
 */
export const GET: APIRoute = async ({ locals, params, request, url }) => {
  const slug = params.slug;

  if (!slug) {
    return notFoundHtmlResponse();
  }

  try {
    const sql = getDatabaseClient();
    const page = parsePageParam(url.searchParams.get("page"));

    const result = await withHostResolvedBlogTenant(
      sql,
      request,
      async (tx, tenant) => {
        const term = await fetchPublicTermBySlug(
          tx,
          tenant.tenantId,
          "category",
          slug
        );

        if (!term) {
          return null;
        }

        const posts = await listPublicBlogPostsByTermId(
          tx,
          tenant.tenantId,
          term.id,
          { page }
        );
        const termBasePath = `${HOST_RESOLVED_PUBLIC_BASE_PATH}/category/${term.slug}`;

        const bodyHtml = `<h1>Category: ${escapeHtml(term.name)}</h1>
<div class="posts">${renderPostSummaryListHtmlAtBasePath(HOST_RESOLVED_PUBLIC_BASE_PATH, posts.items, "No posts in this category yet.")}</div>
${renderPaginationNavHtml(page, posts.hasNextPage, termBasePath)}`;

        const html = renderPublicPageShell({
          title: `${term.name} — ${tenant.tenantName}`,
          description:
            term.description ?? `Posts categorized under ${term.name}.`,
          canonicalUrl: `${url.origin}${termBasePath}`,
          bodyHtml,
          locale: tenant.defaultLocale,
          siteName: tenant.tenantName,
          variant: "list"
        });

        // After the `!term` branch, never before it (ADR-0061 §3) — a missing
        // term and an unknown host must annotate identically.
        publishEdgeCacheTenant(locals, tenant.tenantId);

        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
    );

    return result ?? notFoundHtmlResponse();
  } catch (error) {
    log("error", "public_news.category.failed", {
      slug,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
