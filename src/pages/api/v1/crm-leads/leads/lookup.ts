import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { lookupByContact } from "../../../../../modules/crm-leads/application/lead-directory";
import {
  auditCrmLeads,
  disabledResponse,
  readValidatedBody,
  requireRing
} from "../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateLookup,
  type LookupInput
} from "../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `POST /api/v1/crm-leads/leads/lookup` (ADR-0153 section 7) — find the leads
 * of THIS tenant holding a contact value, by EXACT keyed-hash match. A POST so
 * the value never sits in a URL, an access log or a proxy cache. Returns lead
 * and contact-point ids only. Audited (the value is never in the audit row).
 */
export const POST = defineTenantRoute<LookupInput>({
  workClass: "interactive",
  prepare: ({ request }) => readValidatedBody(request, validateLookup),
  authorize: CRM_LEADS_GUARDS.readLeads,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const ring = requireRing();

    if (ring instanceof Response) return ring;

    const matches = await lookupByContact(
      context.tx,
      context.tenantId,
      context.prepared,
      ring
    );

    await auditCrmLeads(context, {
      action: "crm_leads.lead.lookup",
      resourceType: "crm_leads_lead",
      resourceId: null,
      severity: "info",
      message: "Leads looked up by contact value.",
      attributes: { kind: context.prepared.kind, matchCount: matches.length }
    });

    return ok({ items: matches });
  }
});
