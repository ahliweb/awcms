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
  assignRoleToGroup,
  AssignmentTargetNotFoundError,
  DuplicateAssignmentError,
  SystemRoleAssignmentError,
  unassignRole,
  unassignRoleFromGroup,
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
 * (`{ tenantUserId, roleId }`) or to a GROUP (`{ userGroupId, roleId }`,
 * ADR-0081). Exactly one subject, refused at validation.
 *
 * Both subjects share this endpoint and this permission on purpose. Granting a
 * role is one authority, and the thing that changes is who receives it; a
 * separate `user_groups.grant` permission would let a group administrator hand
 * `owner` to a group they belong to, which is the escalation `access_control.assign`
 * exists to hold.
 *
 * A repeat assign is a 409 (checked before the write, and 23505 translated for
 * the concurrent case), caught INSIDE `withTenant`. High-risk: audited.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateAssignmentInput(bodyRead.value);
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

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Assignment input is invalid.",
        {},
        validation.errors
      );
    }

    try {
      const input = validation.value;
      const record =
        input.subject === "user_group"
          ? await assignRoleToGroup(
              tx,
              tenantId,
              auth.context.tenantUserId,
              input.userGroupId,
              input.roleId,
              correlationId
            )
          : await assignRole(
              tx,
              tenantId,
              auth.context.tenantUserId,
              input.tenantUserId,
              input.roleId,
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
 * (`{ tenantUserId, roleId }`) or from a GROUP (`{ userGroupId, roleId }`).
 * 404 when no such grant exists. High-risk: audited.
 *
 * Revoking a person's role never touches a grant they hold THROUGH a group they
 * are still in, and revoking a group's role never looks like it removed anyone's
 * personal grant — two questions, two writers, one endpoint.
 */
export const DELETE: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateAssignmentInput(bodyRead.value);
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

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Assignment input is invalid.",
        {},
        validation.errors
      );
    }

    try {
      const input = validation.value;
      const removed =
        input.subject === "user_group"
          ? await unassignRoleFromGroup(
              tx,
              tenantId,
              auth.context.tenantUserId,
              input.userGroupId,
              input.roleId,
              correlationId
            )
          : await unassignRole(
              tx,
              tenantId,
              auth.context.tenantUserId,
              input.tenantUserId,
              input.roleId,
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
