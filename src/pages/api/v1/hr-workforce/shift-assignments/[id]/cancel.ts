import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { cancelAssignment } from "../../../../../../modules/hr-workforce/application/hr-shift-directory";
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

const SCOPE = "hr_workforce_shift_assignment_cancel";

/**
 * `POST /api/v1/hr-workforce/shift-assignments/{id}/cancel` — draft or published -> cancelled (terminal). The row stays; it stops counting for the overlap rule and for availability. High-risk, audited, idempotent.
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
  authorize: HR_WORKFORCE_GUARDS.shifts.cancel,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id },
      async () => {
        const result = await cancelAssignment(tx, tenantId, prepared.id, {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        });

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.assignment };
          case "not_found":
            return fail(
              404,
              "RESOURCE_NOT_FOUND",
              "Shift assignment not found."
            );
          case "already_cancelled":
            return fail(
              409,
              "SHIFT_ALREADY_CANCELLED",
              "The assignment is already cancelled."
            );
        }
      }
    )
});
