import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../lib/database/client";
import { withTenant } from "../../../lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../../lib/tenant/public-tenant-resolver";
import { escapeHtml } from "../../../lib/html/escape";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../../lib/html/error-responses";
import { log } from "../../../lib/logging/logger";
import { searchPublicBlogContent } from "../../../modules/blog-content/application/blog-search";
import { isLegacyTenantRouteEnabled } from "../../../modules/blog-content/application/public-route-settings";
import {
  renderPostSummaryListHtml,
  renderPublicPageShell
} from "../../../modules/blog-content/domain/public-page-rendering";
import { decodeKeysetCursor } from "../../../modules/_shared/keyset-pagination";

/**
 * `GET /blog/{tenantCode}/search?q=` (Issue #540) — public search, reuses
 * #539's `searchPublicBlogContent` directly (same public visibility
 * predicate, `resourceType: "post"` since this issue has no public page
 * detail route to link to — see README §Public routes). An empty/missing
 * `q` renders the search form with no results rather than a 400 — this is
 * a browsable public page, not a JSON API. Issue #564: 404s (same generic
 * shape) when `legacyTenantRouteEnabled` is `false`.
 */
export const GET: APIRoute = async ({ params, url }) => {
  const tenantCode = params.tenantCode;

  if (!tenantCode) {
    return notFoundHtmlResponse();
  }

  try {
    const sql = getDatabaseClient();
    const tenant = await resolvePublicTenantByCode(sql, tenantCode);

    if (!tenant) {
      return notFoundHtmlResponse();
    }

    const query = url.searchParams.get("q")?.trim() ?? "";
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

    return await withTenant(sql, tenant.tenantId, async (tx) => {
      if (!(await isLegacyTenantRouteEnabled(tx, tenant.tenantId))) {
        return notFoundHtmlResponse();
      }

      const result =
        query.length > 0
          ? await searchPublicBlogContent(tx, tenant.tenantId, {
              query,
              resourceType: "post",
              cursor: cursor ?? undefined
            })
          : { items: [], nextCursor: null };

      const nextLink =
        result.nextCursor && query.length > 0
          ? `<a href="?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(result.nextCursor)}">Next</a>`
          : "";

      const bodyHtml = `<h1>Search ${escapeHtml(tenant.tenantName)} Blog</h1>
<form method="get" action="/blog/${escapeHtml(tenantCode)}/search">
  <input type="text" name="q" value="${escapeHtml(query)}" aria-label="Search" />
  <button type="submit">Search</button>
</form>
<div class="posts">${
        query.length === 0
          ? "<p>Enter a search term above.</p>"
          : renderPostSummaryListHtml(
              tenantCode,
              result.items,
              "No results found."
            )
      }</div>
<nav>${nextLink}</nav>`;

      const html = renderPublicPageShell({
        title: query
          ? `Search: ${query} — ${tenant.tenantName} Blog`
          : `Search — ${tenant.tenantName} Blog`,
        description: `Search results for "${query}" on the ${tenant.tenantName} blog.`,
        canonicalUrl: null,
        bodyHtml,
        locale: tenant.defaultLocale,
        variant: "list"
      });

      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    });
  } catch (error) {
    log("error", "public_blog.search.failed", {
      tenantCode,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
