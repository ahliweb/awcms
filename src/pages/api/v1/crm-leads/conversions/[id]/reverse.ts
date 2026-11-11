import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { reverseConversion } from "../../../../../../modules/crm-leads/application/lead-lifecycle";
import {
  asUuid,
  auditCrmLeads,
  badId,
  emitContext,
  mutationRefusal,
  notFound,
  prepareMutation,
  runIdempotent,
  tenantDisabledResponse
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateReverseConversion,
  type ReverseConversionInput
} from "../../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `POST /api/v1/crm-leads/conversions/{id}/reverse` (ADR-0153 section 6, L7) —
 * the authority REVERSED a conversion (a refund, a cancelled enrolment). The
 * conversion record is stamped once with the reversal facts and the lead moves
 * back to the stage it converted from (or the initial stage) with a
 * `conversion_reversed` transition: a correction by event, never an edit of
 * history. A replay with the same reversal evidence answers `200`
 * (`replayed: true`); a different one on a reversed record is
 * `409 ALREADY_REVERSED`. Requires `crm_leads.conversions.approve`.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: ReverseConversionInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) =>
    prepareMutation(request, (raw) => validateReverseConversion(raw)),
  authorize: CRM_LEADS_GUARDS.confirmConversions,
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
      "crm_leads_conversion_reverse",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await reverseConversion(
          tx,
          tenantId,
          actor,
          id,
          prepared.input,
          emitContext(context, prepared.idempotencyKey)
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Conversion");
          case "already_reversed":
            return fail(
              409,
              "ALREADY_REVERSED",
              "This conversion was already reversed."
            );
          case "evidence_reused":
            return fail(
              409,
              "EVIDENCE_REUSED",
              "This evidence reference is already recorded."
            );
          case "replayed":
            return {
              status: 200,
              body: {
                ...result.lead,
                conversionId: result.conversionId,
                replayed: true
              }
            };
          case "reversed":
            break;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.conversion_reverse",
          resourceType: "crm_leads_conversion",
          resourceId: id,
          severity: "warning",
          message: "Lead conversion reversed.",
          attributes: {
            leadId: result.lead.id,
            reversalEvidenceRef: prepared.input.evidenceRef,
            toStageKey: result.lead.stageKey
          }
        });

        return {
          status: 200,
          body: {
            ...result.lead,
            conversionId: result.conversionId,
            replayed: false
          }
        };
      }
    );
  }
});
