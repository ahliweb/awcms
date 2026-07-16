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
import {
  fetchModuleSettingsView,
  updateModuleSettings
} from "../../../../../../modules/module-management/application/module-settings";
import { validateModuleSettingsPatch } from "../../../../../../modules/module-management/domain/module-settings";

const READ_GUARD = {
  moduleKey: "module_management",
  activityCode: "settings",
  action: "read" as const
};

const UPDATE_GUARD = {
  moduleKey: "module_management",
  activityCode: "settings",
  action: "update" as const
};

/**
 * `GET /api/v1/tenant/modules/{moduleKey}/settings` — effective settings =
 * the module's own code-declared defaults with the tenant's stored override
 * applied on top. A module with no override row yet still returns a view
 * (defaults-only `effective`), not a `404` — only an unknown `moduleKey` (no
 * such registered descriptor) is `404`.
 */
export const GET: APIRoute = async ({ request, params, cookies }) => {
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

    const view = await fetchModuleSettingsView(tx, tenantId, moduleKey);

    if (!view) {
      return fail(404, "RESOURCE_NOT_FOUND", "Module is not registered.");
    }

    return ok(view);
  });
};

/**
 * `PATCH /api/v1/tenant/modules/{moduleKey}/settings` — merges the body into
 * the tenant's existing settings override (shallow, top-level — omitted keys
 * are left untouched, present keys are replaced wholesale). Rejects
 * (`400 SETTINGS_SENSITIVE_KEY_REJECTED`) any secret-shaped key anywhere in
 * the body, and (`400 SETTINGS_SECRET_SHAPED_VALUE_REJECTED`) any
 * secret-shaped *value* anywhere in the body regardless of its key's own
 * name: real provider secrets belong in environment variables/a secret
 * manager, never a tenant-writable, admin-readable settings row. Audited with
 * safe diff metadata (changed key *names* only, never values).
 */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
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
      moduleKey,
      patch,
      auth.context.tenantUserId
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Module is not registered.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "module_management",
      action: "settings_updated",
      resourceType: "module_settings",
      resourceId: moduleKey,
      severity: "info",
      message: `Module settings updated for ${moduleKey}.`,
      attributes: { diff: result.diff },
      correlationId
    });

    return ok(result.view);
  });
};
