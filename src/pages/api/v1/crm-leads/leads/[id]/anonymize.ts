import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { anonymizeLead } from "../../../../../../modules/crm-leads/application/lead-directory";
import {
  asUuid,
  auditCrmLeads,
  badId,
  mutationRefusal,
  notFound,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";

/**
 * `POST /api/v1/crm-leads/leads/{id}/anonymize` (ADR-0153 section 7, ADR-0094)
 * — anonymising ERASURE at a data subject's request: the display name, every
 * contact point and every free-text reason and note are erased irreversibly;
 * the lead row, its stage, source touches, transition and conversion facts are
 * kept so reported funnel counts do not change. Leads this one absorbed by
 * merge are listed in `survivorOfLeadIds` so the controller can erase them too.
 * High-risk: `Idempotency-Key`, audited at warning (no value in the audit row).
 */
export const POST = defineTenantRoute<{ idempotencyKey: string }>({
  workClass: "interactive",
  prepare: ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { idempotencyKey };
  },
  authorize: CRM_LEADS_GUARDS.deleteLeads,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_leads_lead_anonymize",
      prepared.idempotencyKey,
      actor,
      { id },
      async () => {
        const result = await anonymizeLead(tx, tenantId, actor, id);

        if (result.outcome === "not_found") return notFound("Lead");

        if (result.outcome === "already_anonymized") {
          return fail(
            409,
            "LEAD_ALREADY_ANONYMIZED",
            "The lead is already anonymised."
          );
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.anonymize",
          resourceType: "crm_leads_lead",
          resourceId: id,
          severity: "warning",
          message: "Lead anonymised (erasure).",
          attributes: {
            erasedContactPoints: result.erasedContactPoints,
            survivorOfLeadCount: result.survivorOfLeadIds.length
          }
        });

        return {
          status: 200,
          body: {
            id,
            anonymized: true,
            erasedContactPoints: result.erasedContactPoints,
            survivorOfLeadIds: result.survivorOfLeadIds
          }
        };
      }
    );
  }
});
