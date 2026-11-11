import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { addTouch } from "../../../../../../modules/crm-leads/application/lead-directory";
import {
  asUuid,
  auditCrmLeads,
  badId,
  leadWriteRefusalResponse,
  mutationRefusal,
  prepareMutation,
  runIdempotent,
  tenantDisabledResponse
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateAddTouch,
  type AddTouchInput
} from "../../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `POST /api/v1/crm-leads/leads/{id}/touches` (ADR-0153 section 4) — append a
 * LATER source touch. The first touch never changes. A replay of the same
 * source key on the same lead answers the existing touch (`200`); the same key
 * already attributed to ANOTHER lead is `409 SOURCE_KEY_USED` (deciding two
 * leads are one person is a merge, never a side effect of a touch).
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: AddTouchInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) =>
    prepareMutation(request, (raw) => validateAddTouch(raw)),
  authorize: CRM_LEADS_GUARDS.updateLeads,
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
      "crm_leads_lead_touch",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await addTouch(
          tx,
          tenantId,
          actor,
          id,
          prepared.input.source
        );

        if (result.outcome === "duplicate") {
          return {
            status: 200,
            body: { leadId: id, touchId: result.touchId, duplicate: true }
          };
        }

        if (result.outcome === "key_used_by_other_lead") {
          return fail(
            409,
            "SOURCE_KEY_USED",
            "This source event is already attributed to another lead."
          );
        }

        if (result.outcome !== "added") {
          return leadWriteRefusalResponse(result)!;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.touch",
          resourceType: "crm_leads_lead",
          resourceId: id,
          severity: "info",
          message: "Source touch added to a lead.",
          attributes: {
            touchNumber: result.touchNumber,
            sourceKind: prepared.input.source.kind
          }
        });

        return {
          status: 201,
          body: {
            leadId: id,
            touchId: result.touchId,
            touchNumber: result.touchNumber,
            duplicate: false
          }
        };
      }
    );
  }
});
