import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { assignLead } from "../../../../../../modules/crm-leads/application/lead-directory";
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
  validateAssignLead,
  type AssignLeadInput
} from "../../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `POST /api/v1/crm-leads/leads/{id}/assign` (Issue #1166) — set or clear the
 * owner (an ACTIVE user of this tenant, else `422 OWNER_NOT_FOUND`). Appends an
 * assignment row and publishes `lead.assigned`. High-risk (`assign`):
 * `Idempotency-Key`, `expectedVersion`, audited at warning.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: AssignLeadInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateAssignLead),
  authorize: CRM_LEADS_GUARDS.assignLeads,
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
      "crm_leads_lead_assign",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await assignLead(
          tx,
          tenantId,
          actor,
          id,
          prepared.input,
          emitContext(context, prepared.idempotencyKey)
        );

        if (result.outcome === "owner_not_found") {
          return fail(
            422,
            "OWNER_NOT_FOUND",
            "The owner is not an active user of this tenant."
          );
        }

        if (result.outcome === "unchanged") {
          return { status: 200, body: { ...result.lead, changed: false } };
        }

        if (result.outcome !== "assigned") {
          return leadWriteRefusalResponse(result)!;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.assign",
          resourceType: "crm_leads_lead",
          resourceId: id,
          severity: "warning",
          message: "Lead owner changed.",
          attributes: {
            fromOwnerTenantUserId: result.from,
            toOwnerTenantUserId: result.to
          }
        });

        return { status: 200, body: { ...result.lead, changed: true } };
      }
    );
  }
});
