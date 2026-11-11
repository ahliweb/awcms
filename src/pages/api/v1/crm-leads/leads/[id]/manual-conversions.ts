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
 * `POST /api/v1/crm-leads/leads/{id}/manual-conversions` (ADR-0153 section 6,
 * O13) — a MANUAL conversion for a product with no automated authority. Stored
 * as `authority_unconfirmed`, requires a note and an evidence reference, and is
 * reported separately. Requires `crm_leads.manual_conversions.create`;
 * idempotent, audited at warning.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: ConversionInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) =>
    prepareMutation(request, (raw) => validateConversion(raw)),
  authorize: CRM_LEADS_GUARDS.manualConversions,
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

    return handleConversion(context, id, "authority_unconfirmed");
  }
});
