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
import { enableTenantModule } from "../../../../../../modules/module-management/application/tenant-module-lifecycle";

const ENABLE_GUARD = {
  moduleKey: "module_management",
  activityCode: "tenant_modules",
  action: "enable" as const
};

/**
 * `POST /api/v1/tenant/modules/{moduleKey}/enable` — tenant-level
 * availability only, never a runtime code load. Server-side dependency
 * validation: a module can't be enabled if any direct dependency is missing,
 * globally disabled, or disabled for this tenant. `MODULE_NOT_FOUND`
 * (unknown/globally-disabled module) is `404`; every other rejection reason
 * is a `409` conflict, not a validation error — the request is well-formed,
 * the current state just doesn't allow it.
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
      ENABLE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await enableTenantModule(
      tx,
      tenantId,
      moduleKey,
      auth.context.tenantUserId
    );

    if (result.outcome === "rejected") {
      const status = result.validation.code === "MODULE_NOT_FOUND" ? 404 : 409;
      return fail(status, result.validation.code, result.validation.message);
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "module_management",
      action: "tenant_module_enabled",
      resourceType: "tenant_module",
      resourceId: moduleKey,
      severity: "info",
      message: `Module enabled for tenant: ${moduleKey}.`,
      correlationId
    });

    return ok({ moduleKey, tenantEnabled: true });
  });
};
