import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../lib/database/client";
import {
  recordCounter,
  recordHistogram
} from "../../../../lib/observability/metrics-port";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import { ok, fail } from "../../../../modules/_shared/api-response";
import { withSiteSearchTenant } from "../../../../modules/site-search/application/public-search-tenant-resolution";
import { suggestSiteContent } from "../../../../modules/site-search/application/search-service";
import {
  normalizeSearchLocale,
  normalizeSearchQuery
} from "../../../../modules/site-search/domain/search-query";

/**
 * `GET /api/v1/site-search/suggest` (ADR-0040 §5) — the PUBLIC, anonymous bounded
 * typeahead endpoint (trigram over titles). Same host-based tenant resolution,
 * per-IP rate limit, query bounds, and neutral empty payload as `/query`. Returns
 * at most `suggestion_limit` title suggestions; disabled when the tenant turns
 * suggestions off.
 */
const RATE_LIMIT_MAX = Number(
  process.env.SITE_SEARCH_SUGGEST_RATE_LIMIT_MAX ?? 120
);
const RATE_LIMIT_WINDOW_SEC = Number(
  process.env.SITE_SEARCH_SUGGEST_RATE_LIMIT_WINDOW_SEC ?? 60
);

export const GET: APIRoute = async ({ request, url, clientAddress }) => {
  const started = Date.now();
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = checkRateLimit(`site-search:suggest:${clientIp}`, {
    maxAttempts: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_SEC * 1000
  });
  if (!rateLimit.allowed) {
    recordCounter("site_search_queries_total", {
      surface: "suggest",
      outcome: "rate_limited"
    });
    return fail(
      429,
      "RATE_LIMITED",
      "Too many suggestion requests from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const sql = getDatabaseClient();
  const rawQuery = url.searchParams.get("q");
  const localeParam = url.searchParams.get("locale");

  const result = await withSiteSearchTenant(
    sql,
    request,
    async (tx, tenant, settings) => {
      if (!settings.suggestionsEnabled) {
        return { items: [], query: "", locale: tenant.defaultLocale };
      }
      const locale = normalizeSearchLocale(localeParam, tenant.defaultLocale);
      const normalized = normalizeSearchQuery(
        rawQuery,
        settings.minQueryLength
      );
      if (!normalized.ok) {
        recordCounter("site_search_queries_total", {
          surface: "suggest",
          outcome: normalized.reason
        });
        return { items: [], query: "", locale };
      }

      const items = await suggestSiteContent(tx, tenant.tenantId, {
        query: normalized.value,
        locale,
        enabledResourceTypes: settings.enabledResourceTypes,
        limit: settings.suggestionLimit
      });

      recordCounter("site_search_queries_total", {
        surface: "suggest",
        outcome: items.length > 0 ? "ok" : "empty"
      });
      return { items, query: normalized.value, locale };
    }
  );

  recordHistogram("site_search_query_duration_ms", Date.now() - started, {
    surface: "suggest"
  });

  if (result === null) {
    recordCounter("site_search_queries_total", {
      surface: "suggest",
      outcome: "disabled"
    });
    return ok({ items: [], query: "", locale: "" });
  }
  return ok(result);
};
