import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  evaluateFieldAccessInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { decodeKeysetCursor } from "../../../../modules/_shared/keyset-pagination";
import { listVisitEvents } from "../../../../modules/visitor-analytics/application/event-directory";
import { shapeVisitEvent } from "../../../../modules/visitor-analytics/domain/analytics-response-shaping";

const EVENTS_GUARD = {
  moduleKey: "visitor_analytics",
  activityCode: "events",
  action: "read" as const
};

/**
 * Field-level guard for the de-anonymizing raw-detail columns. Routed through
 * the ABAC evaluator (not a bare permission-set membership check) so a `deny`
 * DSL policy on `visitor_analytics.raw_detail.read` is honored
 * (deny-overrides-allow) — see `evaluateFieldAccessInTransaction`.
 */
const RAW_DETAIL_GUARD = {
  moduleKey: "visitor_analytics",
  activityCode: "raw_detail",
  action: "read" as const
};

/**
 * `GET /api/v1/analytics/events` — keyset-paginated, newest first. Raw detail
 * (`ipHash`/`userAgentHash`) included only when the caller also holds
 * `visitor_analytics.raw_detail.read` AND no ABAC policy denies it.
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
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
      EVENTS_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const canSeeRawDetail = await evaluateFieldAccessInTransaction(
      tx,
      tenantId,
      auth.context,
      auth.grantedPermissionKeys,
      RAW_DETAIL_GUARD,
      now
    );

    const page = await listVisitEvents(tx, tenantId, cursor ?? undefined);
    const events = page.rows.map((row) =>
      shapeVisitEvent(row, canSeeRawDetail)
    );

    return ok({ events, nextCursor: page.nextCursor });
  });
};
