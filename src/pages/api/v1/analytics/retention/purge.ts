import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { purgeVisitorAnalyticsData } from "../../../../../modules/visitor-analytics/application/retention-purge";
import { resolveVisitorAnalyticsConfig } from "../../../../../modules/visitor-analytics/domain/visitor-analytics-config";

const PURGE_GUARD = {
  moduleKey: "visitor_analytics",
  activityCode: "retention",
  action: "purge" as const
};

const IDEMPOTENCY_SCOPE = "visitor_analytics_retention_purge";

/**
 * `POST /api/v1/analytics/retention/purge` — on-demand purge using the
 * module's retention config (VISITOR_ANALYTICS_EVENT_RETENTION_DAYS /
 * _RAW_DETAIL_RETENTION_DAYS / _ROLLUP_RETENTION_DAYS). Destructive,
 * high-risk mutation: requires `Idempotency-Key` and is audited `critical`.
 * See `application/retention-purge.ts` for the exact purge rules.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const requestHash = computeRequestHash({ action: "retention_purge" });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;
  const config = resolveVisitorAnalyticsConfig();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      PURGE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    const result = await purgeVisitorAnalyticsData(tx, tenantId, config, now);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "visitor_analytics",
      action: "retention_purged",
      resourceType: "visitor_analytics_data",
      resourceId: tenantId,
      severity: "critical",
      message: "Visitor analytics data purged past retention window.",
      attributes: result,
      correlationId
    });

    const successResponse = ok(result);
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      successBody
    );

    return successResponse;
  });
};
