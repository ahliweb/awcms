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
import {
  fetchTenantSettings,
  updateTenantSettings
} from "../../../../modules/tenant-admin/application/tenant-settings-directory";
import { validateUpdateTenantSettingsInput } from "../../../../modules/tenant-admin/domain/settings-validation";

const READ_GUARD = {
  moduleKey: "tenant_admin",
  activityCode: "tenant_settings",
  action: "read" as const
};
const UPDATE_GUARD = {
  moduleKey: "tenant_admin",
  activityCode: "tenant_settings",
  action: "update" as const
};

export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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
    if (!auth.allowed) return auth.denied;

    const settings = await fetchTenantSettings(tx, tenantId);
    if (!settings) return fail(404, "RESOURCE_NOT_FOUND", "Tenant not found.");

    return ok(settings);
  });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateUpdateTenantSettingsInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Settings update is invalid.",
      {},
      validation.errors
    );
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
      UPDATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const settings = await updateTenantSettings(
      tx,
      tenantId,
      auth.context.tenantUserId,
      validation.value
    );
    if (!settings) return fail(404, "RESOURCE_NOT_FOUND", "Tenant not found.");

    return ok(settings);
  });
};
