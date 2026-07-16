import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { getProjectionSummaryForTenant } from "../../../../../../modules/reporting/application/projection-directory";

/** `GET /api/v1/reports/projections/{key}` (Issue #753) — a single projection's snapshot/freshness plus its recent reconciliation history. */
export const GET: APIRoute = async ({ request, cookies, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const key = params.key;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }
  if (!key) {
    return fail(400, "VALIDATION_ERROR", "Projection key is required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "reporting",
      activityCode: "projections",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await getProjectionSummaryForTenant(
      tx,
      tenantId,
      key,
      auth.grantedPermissionKeys,
      now
    );

    if (result.outcome === "not_found") {
      return fail(
        404,
        "NOT_FOUND",
        `No registered projection with key "${key}".`
      );
    }
    if (result.outcome === "forbidden") {
      return fail(
        403,
        "ACCESS_DENIED",
        `Missing the required permission to read projection "${key}".`
      );
    }

    return ok({
      projection: result.summary,
      recentReconciliations: result.recentReconciliations
    });
  });
};
