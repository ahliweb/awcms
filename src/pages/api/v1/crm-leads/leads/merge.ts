import { fail } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { mergeLeads } from "../../../../../modules/crm-leads/application/lead-lifecycle";
import {
  auditCrmLeads,
  emitContext,
  leadNotOpen,
  mutationRefusal,
  notFound,
  prepareMutation,
  runIdempotent,
  tenantDisabledResponse
} from "../../../../../modules/crm-leads/application/route-support";
import { fetchSettings } from "../../../../../modules/crm-leads/application/settings-directory";
import { CRM_LEADS_GUARDS } from "../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateMerge,
  type MergeInput
} from "../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `POST /api/v1/crm-leads/leads/merge` (ADR-0153 section 5, L5) — a
 * HUMAN-VERIFIED merge: the reviewer names the survivor and the absorbed lead,
 * the versions they reviewed and a note. Both leads must be open, live and in
 * the same pipeline; another tenant's lead answers `404` like a missing one.
 * Undoable within the tenant's window through
 * `POST /merges/{id}/revert`. High-risk: `Idempotency-Key`, audited at warning.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: MergeInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateMerge),
  authorize: CRM_LEADS_GUARDS.manageMerges,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const tenantOff = await tenantDisabledResponse(tx, tenantId);

    if (tenantOff) return tenantOff;

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_leads_lead_merge",
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const settings = await fetchSettings(tx, tenantId);
        const result = await mergeLeads(
          tx,
          tenantId,
          actor,
          prepared.input,
          settings.mergeUndoHours,
          emitContext(context, prepared.idempotencyKey)
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Lead");
          case "pipeline_mismatch":
            return fail(
              409,
              "PIPELINE_MISMATCH",
              "Only leads of the same pipeline can be merged."
            );
          case "not_open":
            return leadNotOpen("not_open");
          case "version_conflict":
            return fail(
              409,
              "VERSION_CONFLICT",
              "A lead changed since it was reviewed; re-read both and retry.",
              {},
              { leadId: result.leadId, currentVersion: result.currentVersion }
            );
          case "absorbed_converted":
            return fail(
              409,
              "ABSORBED_LEAD_CONVERTED",
              "A converted lead cannot be absorbed."
            );
          case "absorbed_is_survivor":
            return fail(
              409,
              "ABSORBED_LEAD_HAS_MERGES",
              "The absorbed lead is the survivor of another live merge."
            );
          case "merged":
            break;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.merge",
          resourceType: "crm_leads_merge",
          resourceId: result.mergeId,
          severity: "warning",
          message: "Two leads merged after review.",
          attributes: {
            survivorLeadId: prepared.input.survivorLeadId,
            absorbedLeadId: prepared.input.absorbedLeadId,
            undoUntil: result.undoUntil
          }
        });

        return {
          status: 201,
          body: {
            mergeId: result.mergeId,
            survivorLeadId: prepared.input.survivorLeadId,
            absorbedLeadId: prepared.input.absorbedLeadId,
            undoUntil: result.undoUntil
          }
        };
      }
    );
  }
});
