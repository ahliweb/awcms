import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { handleConversion } from "../../../../../../modules/crm-leads/application/conversion-handler";
import {
  asUuid,
  badId,
  mutationRefusal,
  prepareMutation,
  tenantDisabledResponse
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateConversion,
  type ConversionInput
} from "../../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `POST /api/v1/crm-leads/leads/{id}/conversions` (ADR-0153 section 6, T-C1) —
 * record a conversion CONFIRMED by the customer authority, with its opaque
 * `externalCustomerRef` and an `evidenceRef`. The lead moves to a converted
 * stage along an allowed edge. A replay of the same evidence is a no-op (`200`,
 * `replayed: true`). Never creates a customer. Requires
 * `crm_leads.conversions.approve`; high-risk, idempotent, audited at warning.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: ConversionInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) =>
    prepareMutation(request, (raw) => validateConversion(raw)),
  authorize: CRM_LEADS_GUARDS.confirmConversions,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const tenantOff = await tenantDisabledResponse(
      context.tx,
      context.tenantId
    );

    if (tenantOff) return tenantOff;

    return handleConversion(context, id, "authority_confirmed");
  }
});
