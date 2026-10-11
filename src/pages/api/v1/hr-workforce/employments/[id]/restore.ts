import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { restoreEmployment } from "../../../../../../modules/hr-workforce/application/hr-workforce-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import { validateEmptyBody } from "../../../../../../modules/hr-workforce/domain/hr-workforce-validation";

type Prepared = { id: string; idempotencyKey: string };

const SCOPE = "hr_workforce_employment_restore";

/**
 * `POST /api/v1/hr-workforce/employments/{id}/restore` — undo a soft delete.
 * Refused (409) while the employee number, the person's active employment or the
 * linked login has been taken meanwhile: the unique indexes ignore deleted rows,
 * so a restore is where such a clash surfaces.
 */
export const POST = defineTenantRoute<Prepared>({
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

    const body = await readValidatedBody(request, validateEmptyBody);

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: HR_WORKFORCE_GUARDS.employments.restore,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id },
      async () => {
        const result = await restoreEmployment(tx, tenantId, prepared.id, {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        });

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.employment };
          case "not_found":
            return fail(404, "RESOURCE_NOT_FOUND", "Employment not found.");
          case "not_deleted":
            return fail(
              409,
              "EMPLOYMENT_NOT_DELETED",
              "The employment is not deleted."
            );
          case "duplicate_employee_no":
            return fail(
              409,
              "EMPLOYEE_NO_CONFLICT",
              "Another employment now uses this employee number."
            );
          case "already_employed":
            return fail(
              409,
              "ALREADY_EMPLOYED",
              "This person now has another active employment."
            );
          case "account_in_use":
            return fail(
              409,
              "ACCOUNT_IN_USE",
              "The linked login now belongs to another active employment."
            );
        }
      }
    )
});
