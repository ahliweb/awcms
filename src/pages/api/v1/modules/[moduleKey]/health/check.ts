import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { runModuleHealthCheck } from "../../../../../../modules/module-management/application/health-registry";

const CHECK_GUARD = {
  moduleKey: "module_management",
  activityCode: "health",
  action: "check" as const
};

/**
 * `POST /api/v1/modules/{moduleKey}/health/check` — the explicit, on-demand
 * variant: same generic signals as `GET .../health`, plus any live, bounded,
 * network-calling provider health check where one exists. Deliberately a
 * separate action/permission from the passive `GET`, per the "provider checks
 * are explicit" rule — never invoked automatically from a business
 * transaction path.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const moduleKey = params.moduleKey;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!moduleKey) {
    return fail(400, "VALIDATION_ERROR", "Module key is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      CHECK_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const report = await runModuleHealthCheck(
      tx,
      tenantId,
      moduleKey,
      correlationId
    );

    if (!report) {
      return fail(404, "RESOURCE_NOT_FOUND", "Module not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "module_management",
      action: "health_checked",
      resourceType: "module_health",
      resourceId: moduleKey,
      severity: report.status === "failed" ? "critical" : "info",
      message: `Module health check triggered for ${moduleKey}: ${report.status}.`,
      attributes: { status: report.status },
      correlationId
    });

    return ok(report);
  });
};
