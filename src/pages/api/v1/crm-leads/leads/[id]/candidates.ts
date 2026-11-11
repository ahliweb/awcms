import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  fetchLeadView,
  findCandidates
} from "../../../../../../modules/crm-leads/application/lead-directory";
import {
  asUuid,
  badId,
  disabledResponse,
  notFound
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";

/**
 * `GET /api/v1/crm-leads/leads/{id}/candidates` (ADR-0153 section 5, T-I1,
 * T-I2) — identity CANDIDATES: other open leads of THIS tenant sharing an exact
 * keyed hash with one of this lead's live contact points, with the matched
 * KINDS (never the values). A candidate is never a merge; merging is a separate,
 * human-verified request. Never crosses a tenant or compares an email to a
 * platform id.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_LEADS_GUARDS.readLeads,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const lead = await fetchLeadView(context.tx, context.tenantId, id);

    if (!lead) return notFound("Lead");

    return ok({
      leadId: id,
      items: await findCandidates(context.tx, context.tenantId, id)
    });
  }
});
