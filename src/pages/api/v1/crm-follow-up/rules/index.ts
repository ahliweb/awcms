import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createRule,
  listRules
} from "../../../../../modules/crm-follow-up/application/rule-directory";
import {
  auditCrmFollowUp,
  disabledResponse,
  mutationRefusal,
  prepareMutation,
  runIdempotent,
  unknownUsers
} from "../../../../../modules/crm-follow-up/application/route-support";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validateCreateRule,
  type CreateRuleInput
} from "../../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `GET /api/v1/crm-follow-up/rules` (Issue #1165) — the tenant's follow-up
 * rules with their current revision, at most 200, ordered by code.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_FOLLOW_UP_GUARDS.readRules,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok({ items: await listRules(context.tx, context.tenantId) });
  }
});

/**
 * `POST /api/v1/crm-follow-up/rules` — create a rule with its first,
 * immutable revision. High-risk (`configure`): `Idempotency-Key`, audited at
 * warning. A fixed assignee or escalation recipient must be an ACTIVE user of
 * this tenant (`422 USER_NOT_FOUND`); a code is unique per tenant
 * (`409 RULE_CODE_TAKEN`).
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: CreateRuleInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateCreateRule),
  authorize: CRM_FOLLOW_UP_GUARDS.configureRules,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_follow_up_rule_create",
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const result = await createRule(tx, tenantId, actor, prepared.input);

        if (result.outcome === "code_taken") {
          return fail(
            409,
            "RULE_CODE_TAKEN",
            "A rule with this code already exists."
          );
        }

        if (result.outcome === "unknown_users") return unknownUsers();

        await auditCrmFollowUp(context, {
          action: "crm_follow_up.rule.create",
          resourceType: "crm_follow_up_rule",
          resourceId: result.rule.id,
          severity: "warning",
          message: "Follow-up rule created.",
          attributes: {
            code: result.rule.code,
            revisionNumber: 1,
            triggerKind: prepared.input.definition.trigger.kind,
            definitionHash: result.rule.currentRevision?.definitionHash ?? null
          }
        });

        return { status: 201, body: result.rule };
      }
    );
  }
});
