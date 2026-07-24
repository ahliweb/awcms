import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { fetchTopCountries } from "../../../../modules/visitor-analytics/application/analytics-queries";
import {
  DEFAULT_ANALYTICS_RANGE,
  isKnownAnalyticsRange,
  resolveRangeStart
} from "../../../../modules/visitor-analytics/domain/analytics-range";

const DASHBOARD_GUARD = {
  moduleKey: "visitor_analytics",
  activityCode: "dashboard",
  action: "read" as const
};

/**
 * `GET /api/v1/analytics/locations?range=24h|7d|30d|12m` — country breakdown
 * from `visit_events.geo->>'countryCode'`. Empty until geolocation enrichment
 * is enabled (VISITOR_ANALYTICS_GEO_ENABLED + VISITOR_ANALYTICS_TRUST_CLOUDFLARE)
 * — not an error, just no data yet.
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const rangeParam = url.searchParams.get("range");
  const range = rangeParam ?? DEFAULT_ANALYTICS_RANGE;

  if (!isKnownAnalyticsRange(range)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "range must be one of 24h, 7d, 30d, 12m."
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      DASHBOARD_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const start = resolveRangeStart(range, now);
    const countries = await fetchTopCountries(tx, tenantId, start);

    return ok({ range, countries });
  });
};
