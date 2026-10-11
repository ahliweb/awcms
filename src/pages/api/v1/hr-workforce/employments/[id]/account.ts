import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { assignAccount } from "../../../../../../modules/hr-workforce/application/hr-workforce-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateAssignAccount,
  type AssignAccountInput
} from "../../../../../../modules/hr-workforce/domain/hr-workforce-validation";

type Prepared = {
  id: string;
  idempotencyKey: string;
  input: AssignAccountInput;
};

const SCOPE = "hr_workforce_employment_account";

/**
 * `PUT /api/v1/hr-workforce/employments/{id}/account` — link the login that IS
 * this employee (`{"tenantUserId": "<uuid>"}`), or unlink it (`null`). This is
 * the basis of "an employee sees their own", so it is a high-risk `assign`,
 * audited at `warning` (the row records THAT it happened, never which login),
 * and idempotent. One active employment per login.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateAssignAccount);

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.employments.assign,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id, input: prepared.input },
      async () => {
        const result = await assignAccount(
          tx,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input.tenantUserId
        );

        switch (result.outcome) {
          case "ok":
            return {
              status: 200,
              body: { replayed: result.replayed, employment: result.employment }
            };
          case "not_found":
            return fail(404, "RESOURCE_NOT_FOUND", "Employment not found.");
          case "deleted":
            return fail(
              409,
              "EMPLOYMENT_DELETED",
              "The employment is deleted; restore it first."
            );
          case "terminated":
            return fail(
              409,
              "EMPLOYMENT_TERMINATED",
              "A terminated employment cannot be linked to a login."
            );
          case "user_not_found":
            return fail(
              422,
              "USER_NOT_FOUND",
              "tenantUserId does not name an active user of this tenant."
            );
          case "account_in_use":
            return fail(
              409,
              "ACCOUNT_IN_USE",
              "That login already belongs to another active employment."
            );
        }
      }
    )
});
