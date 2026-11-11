import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { revertMerge } from "../../../../../../modules/crm-leads/application/lead-lifecycle";
import {
  asUuid,
  auditCrmLeads,
  badId,
  emitContext,
  mutationRefusal,
  notFound,
  readIdempotencyKey,
  runIdempotent,
  tenantDisabledResponse
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";

/**
 * `POST /api/v1/crm-leads/merges/{id}/revert` (ADR-0153 section 5, T-M1) — roll
 * a merge back within the tenant's undo window: the absorbed lead is open
 * again, exactly as it was (nothing was moved or deleted). A second rollback is
 * `409 ALREADY_REVERTED`; after the window, `409 UNDO_WINDOW_CLOSED` (a
 * correction is then a new merge). High-risk: `Idempotency-Key`, audited.
 */
export const POST = defineTenantRoute<{ idempotencyKey: string }>({
  workClass: "interactive",
  prepare: ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { idempotencyKey };
  },
  authorize: CRM_LEADS_GUARDS.manageMerges,
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
      "crm_leads_merge_revert",
      prepared.idempotencyKey,
      actor,
      { id },
      async () => {
        const result = await revertMerge(
          tx,
          tenantId,
          actor,
          id,
          emitContext(context, prepared.idempotencyKey)
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Merge");
          case "already_reverted":
            return fail(
              409,
              "ALREADY_REVERTED",
              "This merge was already rolled back."
            );
          case "undo_window_closed":
            return fail(
              409,
              "UNDO_WINDOW_CLOSED",
              "The undo window of this merge has closed."
            );
          case "absorbed_changed":
            return fail(
              409,
              "ABSORBED_LEAD_CHANGED",
              "The absorbed lead is no longer merged into the survivor."
            );
          case "reverted":
            break;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.merge_revert",
          resourceType: "crm_leads_merge",
          resourceId: id,
          severity: "warning",
          message: "Lead merge rolled back.",
          attributes: {
            survivorLeadId: result.survivorLeadId,
            absorbedLeadId: result.absorbedLeadId
          }
        });

        return {
          status: 200,
          body: {
            mergeId: id,
            survivorLeadId: result.survivorLeadId,
            absorbedLeadId: result.absorbedLeadId,
            reverted: true
          }
        };
      }
    );
  }
});
