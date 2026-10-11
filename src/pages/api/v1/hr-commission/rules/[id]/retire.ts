import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { retireRule } from "../../../../../../modules/hr-commission/application/hr-commission-rule-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/hr-commission/application/hr-commission-route-support";
import { HR_COMMISSION_GUARDS } from "../../../../../../modules/hr-commission/domain/hr-commission-permissions";
import { validateEmptyBody } from "../../../../../../modules/hr-commission/domain/hr-commission-validation";

type Prepared = { id: string; idempotencyKey: string };

const SCOPE = "hr_commission_rule_retire";

/**
 * `POST /api/v1/hr-commission/rules/{id}/retire` — withdraw a draft (abandon it)
 * or a published version (it no longer applies to new events). Terminal: a
 * retired version never changes again. High-risk, audited, idempotent.
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
  authorize: HR_COMMISSION_GUARDS.rules.retire,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id },
      async () => {
        const result = await retireRule(tx, tenantId, prepared.id, {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        });

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.rule };
          case "not_found":
            return fail(
              404,
              "RESOURCE_NOT_FOUND",
              "Commission rule not found."
            );
          case "already_retired":
            return fail(
              409,
              "RULE_ALREADY_RETIRED",
              "This commission rule version is already retired."
            );
        }
      }
    )
});
