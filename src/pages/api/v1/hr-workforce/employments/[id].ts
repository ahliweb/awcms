import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  getEmployment,
  softDeleteEmployment
} from "../../../../../modules/hr-workforce/application/hr-workforce-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  ownEmploymentGrant,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import { validateReason } from "../../../../../modules/hr-workforce/domain/hr-workforce-validation";

type IdPrepared = { id: string };

/**
 * `GET /api/v1/hr-workforce/employments/{id}` — one employment with its current
 * terms. The employee it is linked to may read it without holding
 * `employments.read` (an ownership grant, ADR-0063); everyone else needs the
 * permission. A missing id and someone else's employment are indistinguishable
 * to a caller without it (both 403).
 */
export const GET = defineTenantRoute<IdPrepared>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  ownershipGrant: (context) => ownEmploymentGrant(context),
  authorize: HR_WORKFORCE_GUARDS.employments.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const employment = await getEmployment(tx, tenantId, prepared.id);

    return employment
      ? ok(employment)
      : fail(404, "RESOURCE_NOT_FOUND", "Employment not found.");
  }
});

type DeletePrepared = {
  id: string;
  idempotencyKey: string;
  reason: string | null;
};

const DELETE_SCOPE = "hr_workforce_employment_delete";

/**
 * `DELETE /api/v1/hr-workforce/employments/{id}` — SOFT delete (an optional
 * `{"reason"}` body), for an employment entered by mistake. A real end of
 * employment is a `terminated` term, not a delete. High-risk, audited, and
 * idempotent.
 */
export const DELETE = defineTenantRoute<DeletePrepared>({
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

    const body = await readValidatedBody(request, validateReason(false));

    return body instanceof Response
      ? body
      : { id, idempotencyKey, reason: body.reason };
  },
  authorize: HR_WORKFORCE_GUARDS.employments.delete,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      DELETE_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id, reason: prepared.reason },
      async () => {
        const result = await softDeleteEmployment(
          tx,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.reason
        );

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.employment };
          case "not_found":
            return fail(404, "RESOURCE_NOT_FOUND", "Employment not found.");
          case "already_deleted":
            return fail(
              409,
              "EMPLOYMENT_DELETED",
              "The employment is already deleted."
            );
        }
      }
    )
});
