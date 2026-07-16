import type { APIRoute } from "astro";
import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import { extractBearerToken } from "../../../../modules/identity-access/application/session-lookup";
import {
  fetchGrantedPermissionKeys,
  resolveTenantContext
} from "../../../../modules/identity-access/application/auth-context";
import { recordDecisionLog } from "../../../../modules/identity-access/application/decision-log";
import { evaluateAccess } from "../../../../modules/identity-access/domain/access-control";
import { fetchTenantActivityReport } from "../../../../modules/reporting/application/tenant-activity-report";

const GUARD_REQUEST = {
  moduleKey: "reporting",
  activityCode: "dashboard",
  action: "read" as const
};

export const GET: APIRoute = async ({ request }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  const token = extractBearerToken(request.headers.get("authorization"));

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const context = await resolveTenantContext(tx, tenantId, tokenHash, now);

      if (!context) {
        return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
      }

      const grantedPermissionKeys = await fetchGrantedPermissionKeys(
        tx,
        tenantId,
        context.tenantUserId
      );
      const decision = evaluateAccess(
        context,
        GUARD_REQUEST,
        grantedPermissionKeys
      );

      await recordDecisionLog(
        tx,
        tenantId,
        context.tenantUserId,
        GUARD_REQUEST,
        decision
      );

      if (!decision.allowed) {
        return fail(403, "ACCESS_DENIED", decision.reason);
      }

      const report = await fetchTenantActivityReport(tx, tenantId);

      return ok(report);
    },
    { workClass: "reporting" }
  );
};
