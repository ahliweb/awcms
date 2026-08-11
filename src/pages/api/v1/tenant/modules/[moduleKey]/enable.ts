import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { checkModuleEntitlementForEnable } from "../../../../../../modules/identity-access/application/entitlement-lookup";
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

    // ADR-0084 — COURTESY, not the control.
    //
    // The control is the chokepoint: an unentitled tenant is refused on every
    // one of that module's guarded endpoints whether or not it is enabled here,
    // so nothing about this check is what keeps the plan wall standing. What it
    // buys is an answer instead of a puzzle — without it, enabling succeeds, the
    // navigation entry appears, and every click on it returns 403 with no
    // explanation of why the toggle they just used did nothing.
    //
    // 409, not 403: the caller HAS the authority to enable modules (they passed
    // the guard above). What they lack is the commercial precondition, and 409
    // is the class that says "your request conflicts with the current state"
    // rather than "you may not ask". `module_management` deliberately answers
    // 409 for every rejection except MODULE_NOT_FOUND, and this joins them.
    const entitlementCheck = await checkModuleEntitlementForEnable(
      tx,
      tenantId,
      moduleKey,
      now
    );

    if (entitlementCheck) {
      return fail(409, "ENTITLEMENT_REQUIRED", entitlementCheck.reason);
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
