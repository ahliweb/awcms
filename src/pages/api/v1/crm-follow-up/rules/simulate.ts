import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  disabledResponse,
  readValidatedBody
} from "../../../../../modules/crm-follow-up/application/route-support";
import { simulateRevision } from "../../../../../modules/crm-follow-up/application/simulation";
import { CRM_FOLLOW_UP_GUARDS } from "../../../../../modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  validateSimulate,
  type SimulateInput
} from "../../../../../modules/crm-follow-up/domain/crm-follow-up-validation";

/**
 * `POST /api/v1/crm-follow-up/rules/simulate` (Issue #1165, ADR-0159 section
 * 3) — evaluate a DRAFT revision against a sample trigger: would a task be
 * created, when would it be due and escalate over the draft's calendar, who
 * would it be assigned to, which notices would be scheduled when. With
 * `leadId`, also whether that lead's stop signals or live tasks would block
 * it. READ-ONLY: writes no task, action, notice, audit row or event, so it
 * needs no `Idempotency-Key` and works while the tenant switch is off.
 */
export const POST = defineTenantRoute<SimulateInput>({
  workClass: "interactive",
  prepare: ({ request }) => readValidatedBody(request, validateSimulate),
  authorize: CRM_FOLLOW_UP_GUARDS.readRules,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok(
      await simulateRevision(
        context.tx,
        context.tenantId,
        context.prepared,
        context.now
      )
    );
  }
});
