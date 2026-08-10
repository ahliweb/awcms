import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  addUserGroupMember,
  GroupExternallyManagedError,
  GroupMembershipTargetNotFoundError,
  removeUserGroupMember,
  validateMembershipInput,
  type MembershipInput
} from "../../../../modules/identity-access/application/user-group-admin";

/**
 * `POST`/`DELETE /api/v1/user-groups/members` — membership, both verbs guarded
 * on `identity_access.user_groups.assign`.
 *
 * `assign` is HIGH-RISK, so both additionally pass the SoD chokepoint inside
 * `authorizeInTransaction` with no extra wiring — which matters here more than
 * it looks: putting somebody in a group can hand them every role that group
 * holds, so it is a grant in everything but name.
 */
const ASSIGN_GUARD = {
  moduleKey: "identity_access",
  activityCode: "user_groups",
  action: "assign" as const
};

async function prepareMembership({
  request
}: {
  request: Request;
}): Promise<MembershipInput | Response> {
  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateMembershipInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Membership input is invalid.",
      {},
      validation.errors
    );
  }

  return validation.value;
}

/** `POST /api/v1/user-groups/members` — add (`{ userGroupId, tenantUserId }`). Idempotent. */
export const POST = defineTenantRoute({
  workClass: "interactive",
  prepare: prepareMembership,
  authorize: ASSIGN_GUARD,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    try {
      return ok(
        await addUserGroupMember(
          tx,
          tenantId,
          auth.context.tenantUserId,
          prepared,
          locals.correlationId
        )
      );
    } catch (error) {
      if (error instanceof GroupExternallyManagedError) {
        return fail(409, "GROUP_EXTERNALLY_MANAGED", error.message);
      }
      if (error instanceof GroupMembershipTargetNotFoundError) {
        return fail(404, "RESOURCE_NOT_FOUND", error.message);
      }
      throw error;
    }
  }
});

/** `DELETE /api/v1/user-groups/members` — remove (`{ userGroupId, tenantUserId }`). */
export const DELETE = defineTenantRoute({
  workClass: "interactive",
  prepare: prepareMembership,
  authorize: ASSIGN_GUARD,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    try {
      const result = await removeUserGroupMember(
        tx,
        tenantId,
        auth.context.tenantUserId,
        prepared,
        locals.correlationId
      );

      if (!result.removed) {
        return fail(404, "RESOURCE_NOT_FOUND", "Membership not found.");
      }

      return ok(result);
    } catch (error) {
      if (error instanceof GroupExternallyManagedError) {
        return fail(409, "GROUP_EXTERNALLY_MANAGED", error.message);
      }
      throw error;
    }
  }
});
