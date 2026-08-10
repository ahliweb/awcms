import { fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  GroupExternallyManagedError,
  listUserGroupMembers,
  updateUserGroup,
  validateUpdateUserGroupInput,
  type UpdateUserGroupInput
} from "../../../../modules/identity-access/application/user-group-admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `GET /api/v1/user-groups/{id}` — the group's members (ids only; the identifier is PII). */
export const GET = defineTenantRoute({
  workClass: "interactive",
  prepare: ({ params }): string | Response => {
    const id = params.id;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      return fail(400, "VALIDATION_ERROR", "id must be a valid UUID.");
    }
    return id;
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "user_groups",
    action: "read"
  },
  // An unknown group and an empty group answer identically. The alternative
  // needs a pre-read that says whether an id exists in this tenant, which is the
  // existence oracle every other read here refuses to be.
  handler: async ({ tx, tenantId, prepared }) =>
    ok({ members: await listUserGroupMembers(tx, tenantId, prepared) })
});

/** `PATCH /api/v1/user-groups/{id}` — rename a LOCAL group (`{ groupName, description? }`). */
export const PATCH = defineTenantRoute({
  workClass: "interactive",
  prepare: async ({
    request,
    params
  }): Promise<{ id: string; input: UpdateUserGroupInput } | Response> => {
    const id = params.id;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      return fail(400, "VALIDATION_ERROR", "id must be a valid UUID.");
    }

    const bodyRead = await readJsonBody(request);
    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const validation = validateUpdateUserGroupInput(bodyRead.value);
    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "User group input is invalid.",
        {},
        validation.errors
      );
    }

    return { id, input: validation.value };
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "user_groups",
    action: "update"
  },
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    try {
      const result = await updateUserGroup(
        tx,
        tenantId,
        auth.context.tenantUserId,
        prepared.id,
        prepared.input,
        locals.correlationId
      );

      if (result.outcome === "not_found") {
        return fail(404, "RESOURCE_NOT_FOUND", "User group not found.");
      }

      return ok(result.record);
    } catch (error) {
      // Raised before any write (the `source` check), so mapping it here
      // persists nothing.
      if (error instanceof GroupExternallyManagedError) {
        return fail(409, "GROUP_EXTERNALLY_MANAGED", error.message);
      }
      throw error;
    }
  }
});
