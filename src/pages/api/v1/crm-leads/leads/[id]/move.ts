import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { moveLead } from "../../../../../../modules/crm-leads/application/lead-lifecycle";
import {
  asUuid,
  auditCrmLeads,
  badId,
  emitContext,
  leadWriteRefusalResponse,
  mutationRefusal,
  prepareMutation,
  runIdempotent,
  tenantDisabledResponse
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateMoveLead,
  type MoveLeadInput
} from "../../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `POST /api/v1/crm-leads/leads/{id}/move` (ADR-0153 section 3, T-S1) — move a
 * lead along an ALLOWED edge of its pipeline's current revision. Decided under
 * the row lock: `expectedVersion` (`409 VERSION_CONFLICT` for the loser of a
 * race), the edge (`409 TRANSITION_NOT_ALLOWED`) and its declarative guards
 * re-checked in the transaction (`409 GUARD_NOT_MET`, naming the guards). A
 * converted stage is entered only by a conversion (`409 CONVERSION_REQUIRED`)
 * and left only by its reversal (`409 REVERSAL_REQUIRED`).
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: MoveLeadInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) =>
    prepareMutation(request, (raw) => validateMoveLead(raw)),
  authorize: CRM_LEADS_GUARDS.moveLeads,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const tenantOff = await tenantDisabledResponse(tx, tenantId);

    if (tenantOff) return tenantOff;

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_leads_lead_move",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await moveLead(
          tx,
          tenantId,
          actor,
          id,
          prepared.input,
          emitContext(context, prepared.idempotencyKey)
        );

        switch (result.outcome) {
          case "stage_not_found":
            return fail(
              422,
              "STAGE_NOT_FOUND",
              "The target stage is not a stage of the pipeline's current revision."
            );
          case "transition_not_allowed":
            return fail(
              409,
              "TRANSITION_NOT_ALLOWED",
              "The pipeline does not allow this move."
            );
          case "guard_not_met":
            return fail(
              409,
              "GUARD_NOT_MET",
              "The move's guard is not satisfied.",
              {},
              { guards: result.guards }
            );
          case "conversion_required":
            return fail(
              409,
              "CONVERSION_REQUIRED",
              "A converted stage is entered only by recording a conversion."
            );
          case "reversal_required":
            return fail(
              409,
              "REVERSAL_REQUIRED",
              "A converted lead leaves its stage only by a conversion reversal."
            );
          case "moved":
            break;
          default:
            return leadWriteRefusalResponse(result)!;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.move",
          resourceType: "crm_leads_lead",
          resourceId: id,
          severity: "info",
          message: "Lead moved to another stage.",
          attributes: {
            transitionId: result.transitionId,
            toStageKey: result.lead.stageKey,
            toCategory: result.lead.stageCategory
          }
        });

        return {
          status: 200,
          body: { ...result.lead, transitionId: result.transitionId }
        };
      }
    );
  }
});
