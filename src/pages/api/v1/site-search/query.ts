import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../lib/database/client";
import {
  recordCounter,
  recordHistogram
} from "../../../../lib/observability/metrics-port";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import { ok, fail } from "../../../../modules/_shared/api-response";
import { withSiteSearchTenant } from "../../../../modules/site-search/application/public-search-tenant-resolution";
import { recordSearchQuery } from "../../../../modules/site-search/application/search-query-log";
import {
  decodeSearchCursor,
  searchSiteContent
} from "../../../../modules/site-search/application/search-service";
import {
  hashSearchQuery,
  normalizeSearchLocale,
  normalizeSearchQuery
} from "../../../../modules/site-search/domain/search-query";

/**
 * `GET /api/v1/site-search/query` (ADR-0040 §5) — the PUBLIC, anonymous JSON
 * search endpoint. Tenant is resolved from the request host (never a
 * session/header), the query text is a bound parameter into
 * `websearch_to_tsquery` (no SQL injection), snippets are escaped before any HTML
 * is emitted (no XSS), and the endpoint is per-IP rate-limited,
 * query-length-bounded, and result-capped. Every non-resolving/disabled/short
 * outcome returns the same neutral empty payload — never leak WHY.
 */
const RATE_LIMIT_MAX = Number(process.env.SITE_SEARCH_RATE_LIMIT_MAX ?? 60);
const RATE_LIMIT_WINDOW_SEC = Number(
  process.env.SITE_SEARCH_RATE_LIMIT_WINDOW_SEC ?? 60
);

export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  const started = Date.now();
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = await checkSharedRateLimit(
    `site-search:query:${clientIp}`,
    {
      maxAttempts: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_SEC * 1000
    }
  );
  if (!rateLimit.allowed) {
    recordCounter("site_search_queries_total", {
      surface: "search",
      outcome: "rate_limited"
    });
    return fail(
      429,
      "RATE_LIMITED",
      "Too many search requests from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const sql = getDatabaseClient();
  const rawQuery = url.searchParams.get("q");
  const typeParam = url.searchParams.get("type");
  const cursorParam = url.searchParams.get("cursor");
  const localeParam = url.searchParams.get("locale");

  const result = await withSiteSearchTenant(
    sql,
    request,
    async (tx, tenant, settings) => {
      const locale = normalizeSearchLocale(localeParam, tenant.defaultLocale);
      const normalized = normalizeSearchQuery(
        rawQuery,
        settings.minQueryLength
      );
      if (!normalized.ok) {
        recordCounter("site_search_queries_total", {
          surface: "search",
          outcome: normalized.reason
        });
        return {
          items: [],
          nextCursor: null,
          query: "",
          locale,
          reason: normalized.reason
        };
      }

      // Type filter only honored when the tenant admits it.
      const typeFilter =
        typeParam &&
        (settings.enabledResourceTypes === null ||
          settings.enabledResourceTypes.includes(typeParam))
          ? typeParam
          : null;
      const cursor = decodeSearchCursor(cursorParam);

      const search = await searchSiteContent(tx, tenant.tenantId, {
        query: normalized.value,
        locale,
        resourceType: typeFilter,
        enabledResourceTypes: settings.enabledResourceTypes,
        limit: settings.resultLimit,
        cursor
      });

      if (settings.analyticsEnabled) {
        await recordSearchQuery(tx, tenant.tenantId, {
          queryHash: hashSearchQuery(normalized.value),
          queryLength: normalized.value.length,
          locale,
          resultCount: search.items.length
        });
      }

      recordCounter("site_search_queries_total", {
        surface: "search",
        outcome: search.items.length > 0 ? "ok" : "empty"
      });

      return {
        items: search.items,
        nextCursor: search.nextCursor,
        query: normalized.value,
        locale
      };
    }
  );

  recordHistogram("site_search_query_duration_ms", Date.now() - started, {
    surface: "search"
  });

  if (result === null) {
    recordCounter("site_search_queries_total", {
      surface: "search",
      outcome: "disabled"
    });
    // Neutral empty payload — indistinguishable from "no results", so an
    // unresolved host / disabled search never leaks its state.
    return ok({ items: [], nextCursor: null, query: "", locale: "" });
  }
  return ok(result);
};
