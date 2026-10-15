import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { getMfaStatus } from "../../../../../../modules/identity-access/application/mfa";
import { requireStepUp } from "../../../../../../modules/identity-access/application/mfa-session-assurance";
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
 * idempotent, and one active employment per login. PS-14 / #979: the login must
 * belong to the employment's person, the caller may not link their own login to
 * someone else's employment, and a re-link is audited at `critical` (a first
 * link at `warning`; both record the login UUIDs, never free text) and, when the
 * employment already has history, needs the conditional step-up.
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
  handler: async ({ tx, tenantId, auth, prepared, locals, tokenHash, now }) =>
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
          prepared.input.tenantUserId,
          {
            // ADR-0141 §4: CONDITIONAL. A holder with no enrolled factor is
            // not locked out (the audit row records `not_enrolled`); an
            // enrolled one needs a fresh step-up.
            checkStepUp: async () => {
              const mfa = await getMfaStatus(
                tx,
                tenantId,
                auth.context.identityId
              );

              if (!mfa.enabled) return "not_enrolled";

              return (await requireStepUp(tx, tenantId, tokenHash, now)).ok
                ? "satisfied"
                : "required";
            }
          }
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
          case "self_link_forbidden":
            return fail(
              403,
              "SELF_LINK_FORBIDDEN",
              "You cannot link your own login to another person's employment."
            );
          case "profile_mismatch":
            return fail(
              422,
              "PROFILE_MISMATCH",
              "That login does not belong to the person of this employment."
            );
          case "step_up_required":
            return fail(
              403,
              "STEP_UP_REQUIRED",
              "Re-linking an employment that has history requires recent multi-factor verification. Complete a step-up and retry."
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
