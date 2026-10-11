import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  changeTerms,
  getEmployment,
  listTerms
} from "../../../../../../modules/hr-workforce/application/hr-workforce-directory";
import {
  asUuid,
  badId,
  ownEmploymentGrant,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateChangeTerms,
  type ChangeTermsInput
} from "../../../../../../modules/hr-workforce/domain/hr-workforce-validation";

type IdPrepared = { id: string };

/**
 * `GET /api/v1/hr-workforce/employments/{id}/terms` — the effective-dated
 * history (office, manager, title, type, status), oldest first. The linked
 * employee may read their own (ownership grant), everyone else needs
 * `employments.read`.
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
    if (!(await getEmployment(tx, tenantId, prepared.id))) {
      return fail(404, "RESOURCE_NOT_FOUND", "Employment not found.");
    }

    return ok({ terms: await listTerms(tx, tenantId, prepared.id) });
  }
});

type ChangePrepared = {
  id: string;
  idempotencyKey: string;
  input: ChangeTermsInput;
};

const SCOPE = "hr_workforce_employment_terms_change";

/**
 * `POST /api/v1/hr-workforce/employments/{id}/terms` — append the next terms,
 * effective from `effectiveFrom` (strictly after the current terms' start, never
 * before the hire date). The open row is closed, never edited. `status:
 * terminated` ends the employment and is terminal. Re-sending identical terms is
 * a no-op that answers `replayed: true`.
 */
export const POST = defineTenantRoute<ChangePrepared>({
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

    const input = await readValidatedBody(request, validateChangeTerms);

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.employments.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id, input: prepared.input },
      async () => {
        const result = await changeTerms(
          tx,
          tenantId,
          prepared.id,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input
        );

        switch (result.outcome) {
          case "ok":
            return {
              status: result.replayed ? 200 : 201,
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
              "Terminated is terminal; rehire is a new employment."
            );
          case "before_hire":
            return fail(
              422,
              "EFFECTIVE_BEFORE_HIRE",
              "effectiveFrom cannot be before the hire date."
            );
          case "out_of_order":
            return fail(
              409,
              "TERMS_OUT_OF_ORDER",
              "effectiveFrom must be after the start of the current terms; history is never rewritten."
            );
          case "office_not_found":
            return fail(422, "OFFICE_NOT_FOUND", "Office not found.");
          case "manager_not_found":
            return fail(
              422,
              "MANAGER_NOT_FOUND",
              "managerEmploymentId does not name a live employment in this tenant."
            );
          case "manager_cycle":
            return fail(
              409,
              "MANAGER_CYCLE",
              "That manager would make the reporting chain circular."
            );
          case "manager_depth":
            return fail(
              409,
              "MANAGER_CHAIN_TOO_DEEP",
              "The reporting chain would be deeper than 10 levels."
            );
        }
      }
    )
});
