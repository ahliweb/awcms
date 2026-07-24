import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  fetchModuleSettingsView,
  updateModuleSettings
} from "../../../../modules/module-management/application/module-settings";
import { validateModuleSettingsPatch } from "../../../../modules/module-management/domain/module-settings";

const MODULE_KEY = "visitor_analytics";

const READ_GUARD = {
  moduleKey: MODULE_KEY,
  activityCode: "settings",
  action: "read" as const
};

const UPDATE_GUARD = {
  moduleKey: MODULE_KEY,
  activityCode: "settings",
  action: "update" as const
};

/**
 * `GET /api/v1/analytics/settings` — a thin,
 * `visitor_analytics`-permission-gated wrapper around Module Management's
 * generic per-tenant settings storage (`awcms_module_settings`), reusing its
 * storage/validation rather than inventing a second mechanism. Distinct from
 * the generic `GET /api/v1/tenant/modules/{moduleKey}/settings` (which
 * requires `module_management.settings.read`) — this endpoint requires the
 * module's own already-seeded `visitor_analytics.settings.read`/`.update`
 * (migration 049) instead.
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

    const view = await fetchModuleSettingsView(tx, tenantId, MODULE_KEY);

    if (!view) {
      return fail(404, "RESOURCE_NOT_FOUND", "Module is not registered.");
    }

    return ok(view);
  });
};

/**
 * `PATCH /api/v1/analytics/settings` — shallow JSON-merge patch, same
 * semantics as the generic module-settings endpoint.
 * `validateModuleSettingsPatch` rejects any secret-shaped key or value
 * before this ever reaches storage. Audited (`settings_updated`, diff of
 * changed key *names* only, never values).
 */
export const PATCH: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateModuleSettingsPatch(bodyRead.value);

  if (!validation.valid) {
    return fail(400, validation.code, validation.message);
  }

  const patch = validation.value;
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
      UPDATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await updateModuleSettings(
      tx,
      tenantId,
      MODULE_KEY,
      patch,
      auth.context.tenantUserId
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Module is not registered.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: MODULE_KEY,
      action: "settings_updated",
      resourceType: "module_settings",
      resourceId: MODULE_KEY,
      severity: "info",
      message: "Visitor analytics settings updated.",
      attributes: { diff: result.diff },
      correlationId
    });

    return ok(result.view);
  });
};
