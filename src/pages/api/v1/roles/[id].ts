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
  softDeleteRole,
  updateRole
} from "../../../../modules/identity-access/application/role-admin";
import {
  validateDeleteRoleInput,
  validateUpdateRoleInput
} from "../../../../modules/identity-access/domain/role-admin-validation";

// Role CRUD authorizes on `configure` ("Manage roles and role permissions") —
// the catalogued, owner-granted, HIGH_RISK action.
const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "configure" as const
};

/**
 * `PATCH /api/v1/roles/{id}` — rename a role (`role_name`) (Issue #171).
 * HIGH-RISK: gated on `identity_access.access_control.configure`, audited by
 * `updateRole`. 404 if the role does not exist or is soft-deleted.
 */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const roleId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!roleId) return fail(400, "VALIDATION_ERROR", "Role id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateUpdateRoleInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Role update input is invalid.",
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

    const role = await updateRole(
      tx,
      tenantId,
      auth.context.tenantUserId,
      roleId,
      validation.value,
      correlationId
    );
    if (!role) return fail(404, "RESOURCE_NOT_FOUND", "Role not found.");

    return ok(role);
  });
};

/**
 * `DELETE /api/v1/roles/{id}` — soft-delete a role (Issue #171). HIGH-RISK:
 * gated on `identity_access.access_control.configure`, audited by
 * `softDeleteRole`. `is_system` roles are refused with 409. An optional
 * `reason` in the body is echoed into the audit event.
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

  const validation = validateDeleteRoleInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Role delete input is invalid.",
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

    const result = await softDeleteRole(
      tx,
      tenantId,
      auth.context.tenantUserId,
      roleId,
      validation.value.reason,
      correlationId
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Role not found.");
    }
    if (result.outcome === "system_blocked") {
      return fail(
        409,
        "ROLE_SYSTEM_PROTECTED",
        "System roles cannot be deleted."
      );
    }

    return ok({ id: roleId, status: "deleted" });
  });
};
