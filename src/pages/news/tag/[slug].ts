import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../lib/database/client";
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
 * `GET /news/tag/{slug}` (ADR-0059 §A) — host-resolved tag archive; identical
 * to the category archive except for `taxonomy_type = 'tag'`. This is also the
 * page `renderContentHtmlWithInternalTagLinks` links to from inside a post body
 * when the base path is `/news`, so it must exist for that transform not to
 * emit dead links.
 */
export const GET: APIRoute = async ({ params, request, url }) => {
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
          "tag",
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
        const termBasePath = `${HOST_RESOLVED_PUBLIC_BASE_PATH}/tag/${term.slug}`;

        const bodyHtml = `<h1>Tag: ${escapeHtml(term.name)}</h1>
<div class="posts">${renderPostSummaryListHtmlAtBasePath(HOST_RESOLVED_PUBLIC_BASE_PATH, posts.items, "No posts with this tag yet.")}</div>
${renderPaginationNavHtml(page, posts.hasNextPage, termBasePath)}`;

        const html = renderPublicPageShell({
          title: `${term.name} — ${tenant.tenantName}`,
          description: term.description ?? `Posts tagged ${term.name}.`,
          canonicalUrl: `${url.origin}${termBasePath}`,
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
    log("error", "public_news.tag.failed", {
      slug,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
