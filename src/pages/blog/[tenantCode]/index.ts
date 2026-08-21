import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../lib/database/client";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { resolvePublicTenantByCode } from "../../../lib/tenant/public-tenant-resolver";
import { escapeHtml } from "../../../lib/html/escape";
import { resolveRequestOrigin } from "../../../lib/http/site-origin";
import { DEFAULT_LOCALE } from "../../../lib/i18n/locales";
import { coerceLocale } from "../../../lib/i18n/negotiate";
import { buildLocalisedPublicUrls } from "../../../lib/i18n/public-locale-path";
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
import { composeHomepage } from "../../../modules/blog-content/application/homepage-composition";
import { composeAdSlots } from "../../../modules/blog-content/application/ad-slot-composition";
import { AD_SLOT_AVAILABLE_LABEL } from "../../../modules/blog-content/domain/ad-slot-labels";
import { renderComposedHomepageHtml } from "../../../modules/blog-content/domain/homepage-section-rendering";
import { mediaLibraryPortAdapter } from "../../../modules/media-library/application/media-library-port-adapter";
import {
  renderPaginationNavHtml,
  renderPostSummaryListHtmlAtBasePath,
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
export const GET: APIRoute = async ({ locals, params, request, url }) => {
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

    return await withTenantOrThrow(sql, tenant.tenantId, async (tx) => {
      if (!(await isLegacyTenantRouteEnabled(tx, tenant.tenantId))) {
        return notFoundHtmlResponse();
      }

      const settings = await fetchPublicBlogSettings(tx, tenant.tenantId);

      // Issue #594 — the editorial composition, if the tenant has one. Only on
      // page 1: pages 2..n are the chronological archive, and repeating a
      // curated front page above every one of them would make the same articles
      // appear on every page of the archive.
      const composed =
        page === 1
          ? await composeHomepage(tx, tenant.tenantId, mediaLibraryPortAdapter)
          : null;

      const result = await listPublicBlogPosts(tx, tenant.tenantId, {
        page,
        pageSize: settings.postsPerPage
      });

      // Issue #594 — four slots on the index. `target: null` means global ads
      // only, which is the whole inventory a listing page can carry: a scoped
      // placement names one article, page or widget, and this page is none of
      // them.
      const ads = await composeAdSlots(
        tx,
        tenant.tenantId,
        [
          "header_banner",
          "below_headline",
          "homepage_middle",
          "homepage_bottom"
        ],
        { placeholderLabel: AD_SLOT_AVAILABLE_LABEL }
      );

      // ADR-0098 — every in-page link is built from the PREFIXED base path, so
      // a reader who arrived on `/id/…` stays there. Building them from
      // `/blog/{code}` instead would drop each reader back onto the bare alias
      // on their very next click, and the `307` would then re-derive a locale
      // from their cookie — correct by luck, and wrong the moment the cookie
      // disagrees with the URL they were reading.
      const urls = buildLocalisedPublicUrls(
        resolveRequestOrigin(url, request),
        `/blog/${tenantCode}`,
        locals.locale,
        coerceLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE
      );

      // An empty string here means one of two things and the answer is the same
      // for both: the tenant has composed nothing, or everything it composed
      // resolved to nothing. Either way the chronological listing below is what
      // a reader gets, so a front page can never come out blank.
      const composedHtml = composed
        ? renderComposedHomepageHtml(urls.basePath, composed)
        : "";

      const bodyHtml = `${ads.get("header_banner") ?? ""}
<h1>${escapeHtml(tenant.tenantName)} Blog</h1>
${ads.get("below_headline") ?? ""}
${composedHtml}
${ads.get("homepage_middle") ?? ""}
<div class="posts">${renderPostSummaryListHtmlAtBasePath(urls.basePath, result.items, "No posts yet.")}</div>
${renderPaginationNavHtml(page, result.hasNextPage, urls.basePath)}
${ads.get("homepage_bottom") ?? ""}`;

      const html = renderPublicPageShell({
        title: settings.seoDefaultTitle ?? `${tenant.tenantName} Blog`,
        description:
          settings.seoDefaultDescription ??
          `Latest posts from ${tenant.tenantName}.`,
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
    log("error", "public_blog.index.failed", {
      tenantCode,
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
