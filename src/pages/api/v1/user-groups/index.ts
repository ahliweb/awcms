import { created, fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  createUserGroup,
  DuplicateGroupCodeError,
  listUserGroups,
  validateCreateUserGroupInput,
  type CreateUserGroupInput
} from "../../../../modules/identity-access/application/user-group-admin";

/**
 * `GET`/`POST /api/v1/user-groups` (ADR-0081).
 *
 * A group is a SUBJECT that can hold a role grant, so its permissions sit apart
 * from `access_control`: `user_groups.read` shows who is in which group,
 * `user_groups.create` makes one. Neither grants a group anything — that stays
 * at `/api/v1/access/assignments` under `access_control.assign`, which is the
 * split that stops a group administrator from granting `owner` to a group they
 * belong to.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "identity_access",
    activityCode: "user_groups",
    action: "read"
  },
  handler: async ({ tx, tenantId }) =>
    ok({ groups: await listUserGroups(tx, tenantId) })
});

/** `POST /api/v1/user-groups` — create a LOCAL group (`{ groupCode, groupName, description? }`). */
export const POST = defineTenantRoute({
  workClass: "interactive",
  // Body parsing belongs in `prepare`: `await request.json()` waits on the
  // CLIENT, so reading it inside the transaction would hold a reserved pool
  // connection for as long as the caller chooses to take (#504).
  prepare: async ({ request }): Promise<CreateUserGroupInput | Response> => {
    const bodyRead = await readJsonBody(request);
    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const validation = validateCreateUserGroupInput(bodyRead.value);
    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "User group input is invalid.",
        {},
        validation.errors
      );
    }

    return validation.value;
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "user_groups",
    action: "create"
  },
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    try {
      return created(
        await createUserGroup(
          tx,
          tenantId,
          auth.context.tenantUserId,
          prepared,
          locals.correlationId
        )
      );
    } catch (error) {
      // Caught INSIDE the transaction: the 23505 has already aborted it, so the
      // commit degrades to a rollback and nothing further is written. Mapping it
      // outside would leave the response correct and the transaction
      // unaccounted for.
      if (error instanceof DuplicateGroupCodeError) {
        return fail(409, "GROUP_CODE_TAKEN", error.message);
      }
      throw error;
    }
  }
});
