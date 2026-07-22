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
import { parsePageParam } from "../../../modules/_shared/offset-pagination";
import {
  fetchPublicBlogSettings,
  listPublicBlogPosts
} from "../../../modules/blog-content/application/public-blog-directory";
import { isLegacyTenantRouteEnabled } from "../../../modules/blog-content/application/public-route-settings";
import {
  renderPaginationNavHtml,
  renderPostSummaryListHtml,
  renderPublicPageShell
} from "../../../modules/blog-content/domain/public-page-rendering";

/**
 * `GET /blog/{tenantCode}` (Issue #540) — public blog index, listing
 * only `published`+`public` posts (never draft/review/scheduled-future/
 * archived/private/unlisted/soft-deleted — doc issue #540 §Public
 * Visibility Rule + the listing-only `visibility != 'unlisted'` rule).
 *
 * Implemented as a plain `.ts` `APIRoute` (hand-rendered HTML string),
 * not a `.astro` page — deliberately, so it is testable through this
 * repo's existing `tests/integration/harness.ts` `invoke()` pattern
 * (built for `APIRoute` handlers, no existing convention for testing
 * `.astro` output). See `src/modules/blog-content/README.md` §Public
 * routes for the full reasoning.
 *
 * Issue #564 (epic #555): gated by the tenant's effective
 * `legacyTenantRouteEnabled` setting (default `true` — today's behavior
 * unchanged). `false` 404s this route the same generic way as an unknown
 * `tenantCode`, applied consistently across all 7 `/blog/{tenantCode}`
 * routes — see `src/modules/blog-content/README.md` §Public route
 * settings.
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

    const page = parsePageParam(url.searchParams.get("page"));

    return await withTenant(sql, tenant.tenantId, async (tx) => {
      if (!(await isLegacyTenantRouteEnabled(tx, tenant.tenantId))) {
        return notFoundHtmlResponse();
      }

      const settings = await fetchPublicBlogSettings(tx, tenant.tenantId);
      const result = await listPublicBlogPosts(tx, tenant.tenantId, {
        page,
        pageSize: settings.postsPerPage
      });

      const bodyHtml = `<h1>${escapeHtml(tenant.tenantName)} Blog</h1>
<div class="posts">${renderPostSummaryListHtml(tenantCode, result.items, "No posts yet.")}</div>
${renderPaginationNavHtml(page, result.hasNextPage, `/blog/${tenantCode}`)}`;

      const html = renderPublicPageShell({
        title: settings.seoDefaultTitle ?? `${tenant.tenantName} Blog`,
        description:
          settings.seoDefaultDescription ??
          `Latest posts from ${tenant.tenantName}.`,
        canonicalUrl: `${url.origin}/blog/${tenantCode}`,
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
    log("error", "public_blog.index.failed", {
      tenantCode,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
