import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { fetchModuleHealthReport } from "../../../../../modules/module-management/application/health-registry";

const READ_GUARD = {
  moduleKey: "module_management",
  activityCode: "health",
  action: "read" as const
};

/**
 * `GET /api/v1/modules/{moduleKey}/health` — fast, bounded readiness signals
 * (descriptor registered, DB registry synced, migrations applied, permission
 * catalog synced, settings valid, jobs documented, OpenAPI/AsyncAPI
 * documented). Never runs a live provider/network check — that's the explicit
 * `POST .../health/check` action only. Safe to call repeatedly: read-only, no
 * mutation, bounded by a handful of lightweight queries and small file reads.
 */
export const GET: APIRoute = async ({ request, params, cookies, locals }) => {
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
      READ_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const report = await fetchModuleHealthReport(
      tx,
      tenantId,
      moduleKey,
      correlationId
    );

    if (!report) {
      return fail(404, "RESOURCE_NOT_FOUND", "Module not found.");
    }

    return ok(report);
  });
};
