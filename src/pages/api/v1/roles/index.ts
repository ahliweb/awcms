import type { APIRoute } from "astro";

import { created, fail, ok } from "../../../../modules/_shared/api-response";
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
import { listRoles } from "../../../../modules/identity-access/application/access-directory";
import {
  createRole,
  DuplicateRoleCodeError
} from "../../../../modules/identity-access/application/role-admin";
import { validateCreateRoleInput } from "../../../../modules/identity-access/domain/role-admin-validation";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "read" as const
};
// Role CRUD + role↔permission management all authorize on `configure`
// ("Manage roles and role permissions") — the catalogued, owner-granted,
// HIGH_RISK action. See role-admin.ts for why finer create/update/delete keys
// are not used.
const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "configure" as const
};

/**
 * `GET /api/v1/roles` — the tenant's (non-deleted) roles with a permission
 * count (Issue #166). Read-only. Gated on `identity_access.access_control.read`.
 */
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

    const items = await listRoles(tx, tenantId);
    return ok({ items });
  });
};

/**
 * `POST /api/v1/roles` — create a custom role (`role_code`, `role_name`) for the
 * tenant (Issue #171). HIGH-RISK: gated on `identity_access.access_control.
 * configure`, audited by `createRole`. A duplicate live `role_code` is 409.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateCreateRoleInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Role creation input is invalid.",
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
      const role = await createRole(
        tx,
        tenantId,
        auth.context.tenantUserId,
        validation.value,
        correlationId
      );
      return created(role);
    } catch (error) {
      // Caught INSIDE `withTenant`: `DuplicateRoleCodeError` follows the unique
      // violation that already aborted the transaction, so returning 409 here
      // commits nothing (the commit degrades to a rollback), and — being no
      // longer a `Bun.SQL.PostgresError` — it must not reach the shared DB
      // circuit breaker as a server fault. No further write to `tx` may follow.
      if (error instanceof DuplicateRoleCodeError) {
        return fail(409, "ROLE_CODE_ALREADY_EXISTS", error.message);
      }
      throw error;
    }
  });
};
