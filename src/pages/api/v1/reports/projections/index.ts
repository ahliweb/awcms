import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { listProjectionSummariesForTenant } from "../../../../../modules/reporting/application/projection-directory";

/**
 * `GET /api/v1/reports/projections` (Issue #753) — list every registered
 * `scope: "tenant"` projection descriptor's live snapshot/freshness for
 * the caller's tenant. A projection is a DERIVED read model, never an
 * authorization source of truth — this endpoint independently re-checks
 * RBAC/ABAC (`authorizeInTransaction`) exactly like every other endpoint,
 * regardless of how stale the underlying data might be.
 */
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

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "reporting",
      activityCode: "projections",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const projections = await listProjectionSummariesForTenant(
      tx,
      tenantId,
      auth.grantedPermissionKeys,
      now
    );

    return ok({ projections });
  });
};
