import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import {
  DuplicateRolePermissionError,
  grantPermissionToRole,
  PermissionNotFoundError,
  revokePermissionFromRole
} from "../../../../../modules/identity-access/application/role-admin";
import { validatePermissionRefInput } from "../../../../../modules/identity-access/domain/role-admin-validation";

// Role↔permission management authorizes on `configure` ("Manage roles and role
// permissions") — the catalogued, owner-granted, HIGH_RISK action.
const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "configure" as const
};

/**
 * `POST /api/v1/roles/{id}/permissions` — grant a catalogued permission
 * (`permissionId`) to the role (Issue #171). HIGH-RISK: gated on
 * `identity_access.access_control.configure`, audited by
 * `grantPermissionToRole`. 404 if the role is absent/deleted; 409 if the grant
 * already exists; 400 if `permissionId` is unknown.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const roleId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!roleId) return fail(400, "VALIDATION_ERROR", "Role id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validatePermissionRefInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Permission grant input is invalid.",
      {},
      validation.errors
    );
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
      CONFIGURE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    try {
      const result = await grantPermissionToRole(
        tx,
        tenantId,
        auth.context.tenantUserId,
        roleId,
        validation.value.permissionId,
        correlationId
      );
      if (result.outcome === "role_not_found") {
        return fail(404, "RESOURCE_NOT_FOUND", "Role not found.");
      }
      if (result.outcome === "system_blocked") {
        return fail(
          409,
          "ROLE_SYSTEM_PROTECTED",
          "System roles have an immutable permission set."
        );
      }
      return ok({ roleId, permissionId: validation.value.permissionId });
    } catch (error) {
      // Caught INSIDE `withTenant`. `DuplicateRolePermissionError` follows the
      // 23505 that already aborted the transaction, `PermissionNotFoundError`
      // the 23503 — returning 4xx here commits nothing.
      if (error instanceof DuplicateRolePermissionError) {
        return fail(409, "ROLE_PERMISSION_ALREADY_GRANTED", error.message);
      }
      if (error instanceof PermissionNotFoundError) {
        return fail(400, "VALIDATION_ERROR", error.message, {}, [
          { field: "permissionId", message: error.message }
        ]);
      }
      throw error;
    }
  });
};

/**
 * `DELETE /api/v1/roles/{id}/permissions` — revoke a permission
 * (`permissionId`) from the role (Issue #171). HIGH-RISK: gated on
 * `identity_access.access_control.configure`, audited by
 * `revokePermissionFromRole`. 404 if the role is absent/deleted or the grant
 * does not exist.
 */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const roleId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!roleId) return fail(400, "VALIDATION_ERROR", "Role id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validatePermissionRefInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Permission revoke input is invalid.",
      {},
      validation.errors
    );
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
      CONFIGURE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const result = await revokePermissionFromRole(
      tx,
      tenantId,
      auth.context.tenantUserId,
      roleId,
      validation.value.permissionId,
      correlationId
    );

    if (result.outcome === "role_not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Role not found.");
    }
    if (result.outcome === "system_blocked") {
      return fail(
        409,
        "ROLE_SYSTEM_PROTECTED",
        "System roles have an immutable permission set."
      );
    }
    if (result.outcome === "grant_not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Permission grant not found.");
    }

    return ok({ roleId, permissionId: validation.value.permissionId });
  });
};
