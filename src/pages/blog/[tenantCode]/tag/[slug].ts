import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenantOrThrow } from "../../../../lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../../../lib/tenant/public-tenant-resolver";
import { escapeHtml } from "../../../../lib/html/escape";
import { resolveRequestOrigin } from "../../../../lib/http/site-origin";
import { DEFAULT_LOCALE } from "../../../../lib/i18n/locales";
import { coerceLocale } from "../../../../lib/i18n/negotiate";
import { buildLocalisedPublicUrls } from "../../../../lib/i18n/public-locale-path";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../../../../lib/html/error-responses";
import { log } from "../../../../lib/logging/logger";
import { parsePageParam } from "../../../../modules/_shared/offset-pagination";
import {
  fetchPublicTermBySlug,
  listPublicBlogPostsByTermId
} from "../../../../modules/blog-content/application/public-blog-directory";
import { isLegacyTenantRouteEnabled } from "../../../../modules/blog-content/application/public-route-settings";
import {
  renderPaginationNavHtml,
  renderPostSummaryListHtmlAtBasePath,
  renderPublicPageShell
} from "../../../../modules/blog-content/domain/public-page-rendering";

/** `GET /blog/{tenantCode}/tag/{slug}` (Issue #540) — same as the category archive, scoped to `taxonomy_type = 'tag'`, including the Issue #564 `legacyTenantRouteEnabled` gate. */
export const GET: APIRoute = async ({ locals, params, request, url }) => {
  const tenantCode = params.tenantCode;
  const slug = params.slug;

  if (!tenantCode || !slug) {
    return notFoundHtmlResponse();
  }

  try {
    const sql = getDatabaseClient();
    const tenant = await resolvePublicTenantByCode(sql, tenantCode);

    if (!tenant) {
      return notFoundHtmlResponse();
    }

    const page = parsePageParam(url.searchParams.get("page"));

    return await withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
      if (!(await isLegacyTenantRouteEnabled(tx, tenant.tenantId))) {
        return notFoundHtmlResponse();
      }

      const term = await fetchPublicTermBySlug(
        tx,
        tenant.tenantId,
        "tag",
        slug
      );

      if (!term) {
        return notFoundHtmlResponse();
      }

      const result = await listPublicBlogPostsByTermId(
        tx,
        tenant.tenantId,
        term.id,
        {
          page
        }
      );

      // ADR-0098 — canonical, hreflang and every in-page link are built from the
      // PREFIXED path. `postsBasePath` is the listing root each post link hangs
      // off, which is the tenant's blog root rather than this archive.
      const urls = buildLocalisedPublicUrls(
        resolveRequestOrigin(url, request),
        `/blog/${tenantCode}/tag/${term.slug}`,
        locals.locale,
        coerceLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE
      );
      const postsBasePath = buildLocalisedPublicUrls(
        resolveRequestOrigin(url, request),
        `/blog/${tenantCode}`,
        locals.locale,
        coerceLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE
      ).basePath;

      const bodyHtml = `<h1>Tag: ${escapeHtml(term.name)}</h1>
<div class="posts">${renderPostSummaryListHtmlAtBasePath(postsBasePath, result.items, "No posts with this tag yet.")}</div>
${renderPaginationNavHtml(page, result.hasNextPage, urls.basePath)}`;

      const html = renderPublicPageShell({
        title: `${term.name} — ${tenant.tenantName} Blog`,
        description: term.description ?? `Posts tagged ${term.name}.`,
        canonicalUrl: urls.canonicalUrl,
        hreflangAlternates: urls.hreflangAlternates,
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
    log("error", "public_blog.tag.failed", {
      tenantCode,
      slug,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
