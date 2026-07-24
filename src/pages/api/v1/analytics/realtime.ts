import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { fetchRealtimeStats } from "../../../../modules/visitor-analytics/application/analytics-queries";
import { resolveVisitorAnalyticsConfig } from "../../../../modules/visitor-analytics/domain/visitor-analytics-config";

const REALTIME_GUARD = {
  moduleKey: "visitor_analytics",
  activityCode: "realtime",
  action: "read" as const
};

/** `GET /api/v1/analytics/realtime` — online-now presence counts. */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const config = resolveVisitorAnalyticsConfig();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      REALTIME_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const stats = await fetchRealtimeStats(
      tx,
      tenantId,
      config.onlineWindowSeconds
    );

    return ok(stats);
  });
};
