import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { restoreLead } from "../../../../../../modules/crm-leads/application/lead-directory";
import {
  asUuid,
  auditCrmLeads,
  badId,
  mutationRefusal,
  notFound,
  prepareMutation,
  runIdempotent,
  tenantDisabledResponse,
  versionConflict
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateExpectedVersion,
  type ExpectedVersionInput
} from "../../../../../../modules/crm-leads/domain/crm-leads-validation";

/** `POST /api/v1/crm-leads/leads/{id}/restore` (Issue #1166) — undo a soft delete. High-risk: `Idempotency-Key`, `expectedVersion`, audited at warning. */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: ExpectedVersionInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateExpectedVersion),
  authorize: CRM_LEADS_GUARDS.restoreLeads,
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
      "crm_leads_lead_restore",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await restoreLead(
          tx,
          tenantId,
          actor,
          id,
          prepared.input.expectedVersion
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Lead");
          case "version_conflict":
            return versionConflict(result.currentVersion);
          case "not_deleted":
            return fail(409, "LEAD_NOT_DELETED", "The lead is not deleted.");
          default:
            break;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.restore",
          resourceType: "crm_leads_lead",
          resourceId: id,
          severity: "warning",
          message: "Lead restored."
        });

        return { status: 200, body: { id, restored: true } };
      }
    );
  }
});
