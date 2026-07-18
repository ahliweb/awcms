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
  setTenantUserStatus,
  validateSetStatusInput
} from "../../../../modules/identity-access/application/user-admin";

/**
 * Guarded on `identity_access.access_control.configure` ("Manage roles and role
 * permissions", seeded in `sql/005`). Deactivating a tenant user revokes all of
 * their access, so it is gated by the heaviest identity_access admin permission
 * the seed provides — there is no `access_control.update` permission in the
 * catalogue, so guarding on `update` would deny even the owner (who is granted
 * every SEEDED permission and nothing more). See `user-admin.ts`.
 */
const UPDATE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "configure" as const
};

/**
 * `PATCH /api/v1/users/{id}` — activate / deactivate a tenant user by setting
 * `status` to `active` / `inactive` (there is no `deleted_at` on
 * `awcms_tenant_users`). High-risk: audited. Cookie or bearer auth.
 */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const tenantUserId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!tenantUserId)
    return fail(400, "VALIDATION_ERROR", "User id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateSetStatusInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "User status input is invalid.",
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
      UPDATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const result = await setTenantUserStatus(
      tx,
      tenantId,
      auth.context.tenantUserId,
      tenantUserId,
      validation.value.status,
      correlationId
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "User not found.");
    }
    if (result.outcome === "self_blocked") {
      return fail(
        409,
        "CANNOT_DEACTIVATE_SELF",
        "You cannot deactivate your own account."
      );
    }
    if (result.outcome === "last_admin_blocked") {
      return fail(
        409,
        "USER_LAST_ADMIN_PROTECTED",
        "Cannot deactivate the last active administrator."
      );
    }

    return ok(result.record);
  });
};
