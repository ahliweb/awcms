import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import {
  DuplicateRoleCodeError,
  restoreRole
} from "../../../../../modules/identity-access/application/role-admin";

// Restore authorizes on `configure` ("Manage roles and role permissions") —
// the catalogued, owner-granted, HIGH_RISK action.
const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "configure" as const
};

/**
 * `POST /api/v1/roles/{id}/restore` — restore a soft-deleted role (Issue #171,
 * same precedent as `POST /profiles/{id}/restore` and
 * `POST /email/templates/{id}/restore`). HIGH-RISK: gated on
 * `identity_access.access_control.configure`, audited by `restoreRole`. 404 if
 * the role is not currently soft-deleted (idempotent-safe on retry). 409 if its
 * `role_code` was re-used by a live role while it was deleted.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const roleId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!roleId) return fail(400, "VALIDATION_ERROR", "Role id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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
      const role = await restoreRole(
        tx,
        tenantId,
        auth.context.tenantUserId,
        roleId,
        correlationId
      );
      if (!role) {
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "Role not found or not currently soft-deleted."
        );
      }
      return ok(role);
    } catch (error) {
      // Caught INSIDE `withTenant`: the unique violation that produced this
      // error already aborted the transaction, so returning 409 here commits
      // nothing.
      if (error instanceof DuplicateRoleCodeError) {
        return fail(409, "ROLE_CODE_ALREADY_EXISTS", error.message);
      }
      throw error;
    }
  });
};
