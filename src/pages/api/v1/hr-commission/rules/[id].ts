import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  getRule,
  updateDraftRule
} from "../../../../../modules/hr-commission/application/hr-commission-rule-directory";
import {
  asUuid,
  badId,
  readValidatedBody
} from "../../../../../modules/hr-commission/application/hr-commission-route-support";
import { HR_COMMISSION_GUARDS } from "../../../../../modules/hr-commission/domain/hr-commission-permissions";
import {
  validateUpdateRule,
  type UpdateRuleInput
} from "../../../../../modules/hr-commission/domain/hr-commission-validation";

type IdPrepared = { id: string };

/** `GET /api/v1/hr-commission/rules/{id}` — one rule version. */
export const GET = defineTenantRoute<IdPrepared>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: HR_COMMISSION_GUARDS.rules.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const rule = await getRule(tx, tenantId, prepared.id);

    return rule
      ? ok(rule)
      : fail(404, "RESOURCE_NOT_FOUND", "Commission rule not found.");
  }
});

type UpdatePrepared = { id: string; input: UpdateRuleInput };

/**
 * `PUT /api/v1/hr-commission/rules/{id}` — replace every editable field of a
 * DRAFT, naming the `expectedContentDigest` it was based on: if the terms have
 * changed since (another editor), it is `409 RULE_CHANGED` and nothing is
 * written. A published or retired version is immutable (409); change it by
 * creating a new version. Replacing a draft with the same body is a no-op, so
 * no `Idempotency-Key` is needed.
 */
export const PUT = defineTenantRoute<UpdatePrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const input = await readValidatedBody(request, validateUpdateRule);

    return input instanceof Response ? input : { id, input };
  },
  authorize: HR_COMMISSION_GUARDS.rules.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await updateDraftRule(
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
        return ok(result.rule);
      case "not_found":
        return fail(404, "RESOURCE_NOT_FOUND", "Commission rule not found.");
      case "stale":
        return fail(
          409,
          "RULE_CHANGED",
          "The rule changed since you read it; re-read it and apply your edit to the current terms."
        );
      case "not_draft":
        return fail(
          409,
          "RULE_NOT_DRAFT",
          `A ${result.status} commission rule version is immutable; create a new version instead.`
        );
    }
  }
});
