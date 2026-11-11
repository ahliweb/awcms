import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fetchRuleWithRevisions } from "../../../../../../modules/crm-follow-up/application/rule-directory";
import {
  asUuid,
  badId,
  disabledResponse,
  notFound
} from "../../../../../../modules/crm-follow-up/application/route-support";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";

/**
 * `GET /api/v1/crm-follow-up/rules/{id}` (Issue #1165) — one rule with every
 * immutable revision, newest first (at most 200).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_FOLLOW_UP_GUARDS.readRules,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const found = await fetchRuleWithRevisions(
      context.tx,
      context.tenantId,
      id
    );

    return found ? ok(found) : notFound("Rule");
  }
});
