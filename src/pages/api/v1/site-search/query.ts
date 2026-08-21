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
import { parsePositiveIntSetting } from "../../../../lib/security/env-thresholds";
import { ok, fail } from "../../../../modules/_shared/api-response";
import { withSiteSearchTenant } from "../../../../modules/site-search/application/public-search-tenant-resolution";
import { recordSearchQuery } from "../../../../modules/site-search/application/search-query-log";
import {
  countSearchFacets,
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
// Parsed rather than coerced: `Number(process.env.X ?? 60)` yields `NaN` for a
// non-numeric value, and `count > NaN` is false — which switches this limiter
// OFF on an anonymous full-text endpoint while the `rate_limited` metric stays
// at zero and reads as "no abuse". The literal `process.env.NAME` spelling is
// kept because `config:env:coverage:check` cannot see a computed read.
const RATE_LIMIT_MAX = parsePositiveIntSetting(
  process.env.SITE_SEARCH_RATE_LIMIT_MAX,
  60,
  "SITE_SEARCH_RATE_LIMIT_MAX"
);
const RATE_LIMIT_WINDOW_SEC = parsePositiveIntSetting(
  process.env.SITE_SEARCH_RATE_LIMIT_WINDOW_SEC,
  60,
  "SITE_SEARCH_RATE_LIMIT_WINDOW_SEC"
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
          facets: { resourceTypes: [] },
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

      // Issue #607 — awaited SEQUENTIALLY, not with `Promise.all`. Both run on
      // the same transaction connection, and concurrent queries on one leak it
      // (the rule every admin screen in this repo already follows).
      //
      // Computed on every page, including a cursor page: the counts describe
      // the whole result set rather than the page, so omitting them after the
      // first page would make them look like they had changed.
      const facets = await countSearchFacets(tx, tenant.tenantId, {
        query: normalized.value,
        locale,
        enabledResourceTypes: settings.enabledResourceTypes
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
        facets,
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
    return ok({
      items: [],
      nextCursor: null,
      // Same SHAPE as a real answer: a payload that omitted `facets` here would
      // distinguish "search is off for this host" from "no results", which is
      // exactly what the neutral payload exists to prevent.
      facets: { resourceTypes: [] },
      query: "",
      locale: ""
    });
  }
  return ok(result);
};
