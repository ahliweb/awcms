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
  assignRole,
  AssignmentTargetNotFoundError,
  DuplicateAssignmentError,
  SystemRoleAssignmentError,
  unassignRole,
  validateAssignmentInput
} from "../../../../modules/identity-access/application/user-admin";

/**
 * Both verbs are guarded on `identity_access.access_control.assign` ("Assign
 * roles to tenant users", seeded in `sql/005`) — the permission that exactly
 * names this action, held by the owner role.
 */
const ASSIGN_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "assign" as const
};

/**
 * `POST /api/v1/access/assignments` — grant a role to a tenant user
 * (body: `{ tenantUserId, roleId }`). Idempotency is enforced at the DB unique
 * index: a repeat assign is a 23505 mapped to 409, caught INSIDE `withTenant`.
 * High-risk: audited.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateAssignmentInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Assignment input is invalid.",
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
      ASSIGN_GUARD
    );
    if (!auth.allowed) return auth.denied;

    try {
      const record = await assignRole(
        tx,
        tenantId,
        auth.context.tenantUserId,
        validation.value.tenantUserId,
        validation.value.roleId,
        correlationId
      );
      return ok(record);
    } catch (error) {
      // Caught INSIDE `withTenant` on purpose (same reasoning as
      // `offices/index.ts`): neither error is a `Bun.SQL.PostgresError` here,
      // so the circuit-breaker carve-out in `tenant-context.ts` would not
      // recognise them. `AssignmentTargetNotFoundError` is raised before any
      // write (commit persists nothing); `DuplicateAssignmentError` follows the
      // 23505 that already aborted the transaction (commit degrades to
      // rollback). Neither path writes anything further to `tx`.
      if (error instanceof AssignmentTargetNotFoundError) {
        return fail(404, "RESOURCE_NOT_FOUND", error.message);
      }
      if (error instanceof SystemRoleAssignmentError) {
        return fail(409, "ROLE_SYSTEM_PROTECTED", error.message);
      }
      if (error instanceof DuplicateAssignmentError) {
        return fail(409, "ASSIGNMENT_ALREADY_EXISTS", error.message);
      }
      throw error;
    }
  });
};

/**
 * `DELETE /api/v1/access/assignments` — revoke a role from a tenant user
 * (body: `{ tenantUserId, roleId }`). 404 when no such assignment exists.
 * High-risk: audited.
 */
export const DELETE: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateAssignmentInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Assignment input is invalid.",
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
      ASSIGN_GUARD
    );
    if (!auth.allowed) return auth.denied;

    try {
      const removed = await unassignRole(
        tx,
        tenantId,
        auth.context.tenantUserId,
        validation.value.tenantUserId,
        validation.value.roleId,
        correlationId
      );
      if (!removed)
        return fail(404, "RESOURCE_NOT_FOUND", "Assignment not found.");

      return ok({ removed: true });
    } catch (error) {
      // `SystemRoleAssignmentError` is raised before any write (the is_system
      // pre-check), so mapping it to 409 inside `withTenant` persists nothing.
      if (error instanceof SystemRoleAssignmentError) {
        return fail(409, "ROLE_SYSTEM_PROTECTED", error.message);
      }
      throw error;
    }
  });
};
