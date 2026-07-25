import type { APIRoute } from "astro";

import { getDatabaseClient } from "../lib/database/client";
import {
  notFoundHtmlResponse,
  serverErrorHtmlResponse
} from "../lib/html/error-responses";
import { log } from "../lib/logging/logger";
import { withSiteSearchTenant } from "../modules/site-search/application/public-search-tenant-resolution";
import {
  decodeSearchCursor,
  searchSiteContent,
  type SearchResultItem
} from "../modules/site-search/application/search-service";
import {
  normalizeSearchLocale,
  normalizeSearchQuery
} from "../modules/site-search/domain/search-query";
import {
  DEFAULT_SEARCH_PAGE_LABELS,
  renderSearchPageDocument
} from "../modules/site-search/domain/search-page-rendering";

/**
 * `GET /search?q=` (ADR-0040 §5) — the PUBLIC, anonymous, accessible search page.
 * Host-based tenant resolution (the same gate the SEO discovery routes use);
 * tenant + locale scoped; snippets are pre-escaped safe HTML; the page renders
 * `robots: noindex` (a search-results page must not be indexed). Core search
 * works with NO JavaScript — see `search-page-rendering.ts` on why the
 * typeahead script from awcms-micro is deliberately not ported here.
 *
 * An unresolved host, a disabled module, or a tenant that turned search off all
 * return the SAME generic 404 — never leak which.
 */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const sql = getDatabaseClient();
    const rawQuery = url.searchParams.get("q");
    const cursorParam = url.searchParams.get("cursor");
    const localeParam = url.searchParams.get("locale");

    const result = await withSiteSearchTenant(
      sql,
      request,
      async (tx, tenant, settings) => {
        const locale = normalizeSearchLocale(localeParam, tenant.defaultLocale);

        let items: readonly SearchResultItem[] = [];
        let nextCursor: string | null = null;
        let query = "";
        let reason: "empty" | "too_short" | "too_long" | undefined;

        const hasInput =
          typeof rawQuery === "string" && rawQuery.trim().length > 0;
        if (hasInput) {
          const normalized = normalizeSearchQuery(
            rawQuery,
            settings.minQueryLength
          );
          if (!normalized.ok) {
            reason = normalized.reason;
          } else {
            query = normalized.value;
            const cursor = decodeSearchCursor(cursorParam);
            const search = await searchSiteContent(tx, tenant.tenantId, {
              query,
              locale,
              enabledResourceTypes: settings.enabledResourceTypes,
              limit: settings.resultLimit,
              cursor
            });
            items = search.items;
            nextCursor = search.nextCursor;
          }
        }

        const html = renderSearchPageDocument({
          locale,
          siteName: tenant.tenantName,
          query,
          minQueryLength: settings.minQueryLength,
          reason,
          items,
          nextCursor,
          labels: DEFAULT_SEARCH_PAGE_LABELS
        });

        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
    );

    return result ?? notFoundHtmlResponse();
  } catch (error) {
    log("error", "public_site_search.page_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return serverErrorHtmlResponse();
  }
};
