import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../lib/database/client";
import { escapeHtml } from "../../lib/html/escape";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../lib/html/error-responses";
import { log } from "../../lib/logging/logger";
import { parsePageParam } from "../../modules/_shared/offset-pagination";
import {
  fetchPublicBlogSettings,
  listPublicBlogPosts
} from "../../modules/blog-content/application/public-blog-directory";
import {
  HOST_RESOLVED_PUBLIC_BASE_PATH,
  withHostResolvedBlogTenant
} from "../../modules/blog-content/application/public-host-route-tenant-resolution";
import {
  renderPaginationNavHtml,
  renderPostSummaryListHtmlAtBasePath,
  renderPublicPageShell
} from "../../modules/blog-content/domain/public-page-rendering";

/**
 * `GET /news` (ADR-0059 §A) — the host-resolved public index. Same listing
 * predicate as `/blog/{tenantCode}` (published + public only; never
 * draft/review/scheduled-future/archived/private/unlisted/soft-deleted) and the
 * same application services; the ONE difference is that the tenant comes from
 * the request rather than from a path segment.
 *
 * Every non-serving outcome — unknown host, `blog_content` disabled,
 * `publicRouteMode: "disabled"` — is the same generic 404 produced by the same
 * `null`, latency-normalized inside `withHostResolvedBlogTenant`.
 */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const sql = getDatabaseClient();
    const page = parsePageParam(url.searchParams.get("page"));

    const result = await withHostResolvedBlogTenant(
      sql,
      request,
      async (tx, tenant) => {
        const settings = await fetchPublicBlogSettings(tx, tenant.tenantId);
        const posts = await listPublicBlogPosts(tx, tenant.tenantId, {
          page,
          pageSize: settings.postsPerPage
        });

        const bodyHtml = `<h1>${escapeHtml(tenant.tenantName)}</h1>
<div class="posts">${renderPostSummaryListHtmlAtBasePath(HOST_RESOLVED_PUBLIC_BASE_PATH, posts.items, "No posts yet.")}</div>
${renderPaginationNavHtml(page, posts.hasNextPage, HOST_RESOLVED_PUBLIC_BASE_PATH)}`;

        const html = renderPublicPageShell({
          title: settings.seoDefaultTitle ?? tenant.tenantName,
          description:
            settings.seoDefaultDescription ??
            `Latest posts from ${tenant.tenantName}.`,
          canonicalUrl: `${url.origin}${HOST_RESOLVED_PUBLIC_BASE_PATH}`,
          bodyHtml,
          locale: tenant.defaultLocale,
          siteName: tenant.tenantName,
          variant: "list"
        });

        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
    );

    return result ?? notFoundHtmlResponse();
  } catch (error) {
    log("error", "public_news.index.failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
