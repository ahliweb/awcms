import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { disableTenantModule } from "../../../../../../modules/module-management/application/tenant-module-lifecycle";

const DISABLE_GUARD = {
  moduleKey: "module_management",
  activityCode: "tenant_modules",
  action: "disable" as const
};

/**
 * `POST /api/v1/tenant/modules/{moduleKey}/disable` — `reason` required (a
 * meaningful operational action, not scratch state). Never deletes tenant
 * data: only writes `awcms_tenant_modules`. Rejected if the module is
 * core/system, already disabled, or another still-enabled module depends on
 * it.
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const reasonRaw = (body as { reason?: unknown } | null)?.reason;

  if (typeof reasonRaw !== "string" || reasonRaw.trim().length === 0) {
    return fail(400, "VALIDATION_ERROR", "reason is required.");
  }

  const reason = reasonRaw.trim();
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
      DISABLE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await disableTenantModule(
      tx,
      tenantId,
      moduleKey,
      auth.context.tenantUserId,
      reason
    );

    if (result.outcome === "rejected") {
      const status = result.validation.code === "MODULE_NOT_FOUND" ? 404 : 409;
      return fail(status, result.validation.code, result.validation.message);
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "module_management",
      action: "tenant_module_disabled",
      resourceType: "tenant_module",
      resourceId: moduleKey,
      severity: "warning",
      message: `Module disabled for tenant: ${moduleKey}.`,
      attributes: { reason },
      correlationId
    });

    return ok({ moduleKey, tenantEnabled: false });
  });
};
