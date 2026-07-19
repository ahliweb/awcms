import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  fetchAuthProviderById,
  softDeleteAuthProvider,
  updateAuthProvider
} from "../../../../../modules/identity-access/application/auth-provider-directory";
import { validateUpdateAuthProviderInput } from "../../../../../modules/identity-access/domain/tenant-sso-policy";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "sso_providers",
  action: "read" as const
};

const UPDATE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "sso_providers",
  action: "update" as const
};

const DELETE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "sso_providers",
  action: "delete" as const
};

/** `GET /api/v1/auth/sso-providers/{id}` (Issue #185). */
export const GET: APIRoute = async ({ request, params, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const providerId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!providerId) {
    return fail(400, "VALIDATION_ERROR", "Provider id is required.");
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

    const provider = await fetchAuthProviderById(tx, tenantId, providerId);

    if (!provider) {
      return fail(404, "RESOURCE_NOT_FOUND", "SSO provider not found.");
    }

    return ok(provider);
  });
};

/** `PATCH /api/v1/auth/sso-providers/{id}` (Issue #185) — partial update. High-risk admin action: audited. */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const providerId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!providerId) {
    return fail(400, "VALIDATION_ERROR", "Provider id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateAuthProviderInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "SSO provider update is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
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

    const result = await updateAuthProvider(
      tx,
      tenantId,
      auth.context.tenantUserId,
      providerId,
      input
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "SSO provider not found.");
    }

    if (result.outcome === "misconfigured") {
      return fail(
        500,
        "SSO_MISCONFIGURED",
        "AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY is not configured on this server."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "sso_provider_updated",
      resourceType: "auth_provider",
      resourceId: providerId,
      severity: "warning",
      message: `Tenant OIDC SSO provider updated: ${result.provider.providerKey}.`,
      correlationId
    });

    return ok(result.provider);
  });
};

/** `DELETE /api/v1/auth/sso-providers/{id}` (Issue #185) — soft delete. `reason` required. */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const providerId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!providerId) {
    return fail(400, "VALIDATION_ERROR", "Provider id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<{ reason?: unknown }>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (reason.length === 0) {
    return fail(400, "VALIDATION_ERROR", "reason is required.", {}, [
      { field: "reason", message: "reason is required." }
    ]);
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
      DELETE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const deleted = await softDeleteAuthProvider(
      tx,
      tenantId,
      auth.context.tenantUserId,
      providerId,
      reason
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "SSO provider not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "sso_provider_deleted",
      resourceType: "auth_provider",
      resourceId: providerId,
      severity: "warning",
      message: "Tenant OIDC SSO provider deleted.",
      attributes: { reason },
      correlationId
    });

    return ok({ id: providerId, deleted: true });
  });
};
