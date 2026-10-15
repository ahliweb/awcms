import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { withdrawCorrection } from "../../../../../../modules/hr-workforce/application/hr-attendance-directory";
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

const SCOPE = "hr_workforce_attendance_correction_withdraw";

/**
 * `POST /api/v1/hr-workforce/attendance-corrections/{id}/withdraw` — the
 * REQUESTER withdraws a still-pending correction (its approval instance is
 * cancelled first). Someone else's correction and a missing id answer alike
 * (404). High-risk, audited without the reason, idempotent.
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
  authorize: HR_WORKFORCE_GUARDS.corrections.cancel,
  handler: async ({ tx, tenantId, auth, prepared, locals, now }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id },
      async () => {
        const result = await withdrawCorrection(
          tx,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          now
        );

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.correction };
          case "not_found":
          case "not_requester":
            return fail(
              404,
              "RESOURCE_NOT_FOUND",
              "Attendance correction not found."
            );
          case "not_pending":
            return fail(
              409,
              "CORRECTION_NOT_PENDING",
              `The correction is already ${result.status}.`
            );
          case "workflow_already_decided":
            return fail(
              409,
              "CORRECTION_ALREADY_DECIDED",
              "The approval workflow has already decided; settle the correction instead."
            );
        }
      }
    )
});
