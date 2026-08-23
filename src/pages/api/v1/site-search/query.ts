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
import { withPublicSearchTenant } from "../../../../modules/site-search/application/public-search-tenant-resolution";
import { recordSearchQuery } from "../../../../modules/site-search/application/search-query-log";
import {
  countSearchFacets,
  decodeSearchCursor,
  searchSiteContent
} from "../../../../modules/site-search/application/search-service";
import {
  hashSearchQuery,
  normalizeSearchLocale,
  normalizeSearchQuery,
  parseTermFilters
} from "../../../../modules/site-search/domain/search-query";
import { collectTermFacetKeys } from "../../../../modules/site-search/domain/search-source-registry";
import { listModules } from "../../../../modules";

/**
 * The facet names a request may filter on (Issue #633), derived from the
 * search-source registry rather than written down here. Computed ONCE: the
 * module list is a static code registry, so recomputing it per request would
 * only spend CPU to reach the same answer.
 */
const TERM_FACET_KEYS = collectTermFacetKeys(listModules());

/**
 * The neutral empty facet payload. Shared by every early return so the "search
 * is off for this host" answer and the "no results" answer stay identical in
 * SHAPE as well as content — a missing `terms` key on one of them would be the
 * distinguishing signal the neutral payload exists to prevent.
 */
const EMPTY_FACETS = { resourceTypes: [], terms: {} };

/**
 * `GET /api/v1/site-search/query` (ADR-0040 §5) — the PUBLIC, anonymous JSON
 * search endpoint. Tenant is resolved from the request host (never a
 * session/header), the query text is a bound parameter into
 * `websearch_to_tsquery` (no SQL injection), snippets are escaped before any HTML
 * is emitted (no XSS), and the endpoint is per-IP rate-limited,
 * query-length-bounded, and result-capped. Every non-resolving/disabled/short
 * outcome returns the same neutral empty payload — never leak WHY.
 *
 * ## Cross-origin readers (ADR-0107)
 *
 * A request carrying an `Origin` that is not ours resolves its tenant from that
 * ORIGIN — never from the host, and never from the default-tenant fallback the
 * host chain ends in — and is answered with `Access-Control-Allow-Origin` only
 * when the origin is an `active` domain of an `active` tenant. A refused origin
 * gets the same neutral payload with no grant header, so the browser refuses the
 * read; only the `origin_refused` counter knows the difference.
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
      {
        "retry-after": String(rateLimit.retryAfterSec),
        // The limiter answers before the origin is ever classified, so this
        // response carries no CORS grant — but it is still one of the answers
        // this URL gives, and a cache must not hand it to another origin as if
        // it were origin-independent (ADR-0107).
        vary: "Origin"
      }
    );
  }

  const sql = getDatabaseClient();
  const rawQuery = url.searchParams.get("q");
  const typeParam = url.searchParams.get("type");
  const cursorParam = url.searchParams.get("cursor");
  const localeParam = url.searchParams.get("locale");
  const termFilters = parseTermFilters(url.searchParams, TERM_FACET_KEYS);

  const { result, corsHeaders, origin } = await withPublicSearchTenant(
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
          facets: EMPTY_FACETS,
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
        termFilters,
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
      // `resourceType` and `termFilters` ARE passed now (Issue #633): a facet
      // applies every filter except its OWN, so it has to be told about the
      // ones it will leave out. The old signature omitted `resourceType`
      // entirely, which encoded "never apply it" — right with one facet, wrong
      // with several.
      const facets = await countSearchFacets(tx, tenant.tenantId, {
        query: normalized.value,
        locale,
        resourceType: typeFilter,
        enabledResourceTypes: settings.enabledResourceTypes,
        termFilters
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
      // A cross-origin caller this deployment does not serve is counted apart
      // from a disabled tenant. The two answers are byte-identical on purpose
      // (never leak WHY); an operator asking "is the site's search box wired to
      // a registered domain" still needs to be able to tell them apart, and a
      // server-side counter is not a disclosure to the caller.
      outcome: origin === "refused" ? "origin_refused" : "disabled"
    });
    // Neutral empty payload — indistinguishable from "no results", so an
    // unresolved host / disabled search never leaks its state.
    return ok(
      {
        items: [],
        nextCursor: null,
        // Same SHAPE as a real answer: a payload that omitted `facets` here
        // would distinguish "search is off for this host" from "no results",
        // which is exactly what the neutral payload exists to prevent.
        facets: EMPTY_FACETS,
        query: "",
        locale: ""
      },
      {},
      corsHeaders
    );
  }
  return ok(result, {}, corsHeaders);
};
