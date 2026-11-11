import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  fetchLeadHistory,
  fetchLeadView,
  softDeleteLead,
  updateLead
} from "../../../../../../modules/crm-leads/application/lead-directory";
import {
  asUuid,
  auditCrmLeads,
  badId,
  disabledResponse,
  leadWriteRefusalResponse,
  mutationRefusal,
  notFound,
  prepareMutation,
  readIdempotencyKey,
  requireRings,
  runIdempotent,
  tenantDisabledResponse,
  versionConflict
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  parseIfMatchVersion,
  validateUpdateLead,
  type UpdateLeadInput
} from "../../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `GET /api/v1/crm-leads/leads/{id}` (Issue #1166) — one lead with masked
 * contact points and its history: source touches (first touch immutable),
 * transitions (each with the revision it happened under), assignments,
 * conversions and merges. An id in another tenant answers like a missing one.
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
      ...lead,
      history: await fetchLeadHistory(context.tx, context.tenantId, id)
    });
  }
});

/**
 * `PATCH /api/v1/crm-leads/leads/{id}` — change the display name, add contact
 * points or revoke them. Needs `expectedVersion` (`409 VERSION_CONFLICT`) and an
 * `Idempotency-Key`. A contact value is never edited: revoke it and add another.
 */
export const PATCH = defineTenantRoute<{
  idempotencyKey: string;
  input: UpdateLeadInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateUpdateLead),
  authorize: CRM_LEADS_GUARDS.updateLeads,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const { tx, tenantId, auth, prepared } = context;
    const tenantOff = await tenantDisabledResponse(tx, tenantId);

    if (tenantOff) return tenantOff;

    const rings = requireRings();

    if (rings instanceof Response) return rings;

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_leads_lead_update",
      prepared.idempotencyKey,
      actor,
      { id, ...prepared.input },
      async () => {
        const result = await updateLead(
          tx,
          tenantId,
          actor,
          id,
          prepared.input,
          rings
        );

        if (result.outcome === "contact_point_not_found") {
          return fail(
            422,
            "CONTACT_POINT_NOT_FOUND",
            "A contact point to revoke is not a live contact point of this lead."
          );
        }

        if (result.outcome !== "updated") {
          return leadWriteRefusalResponse(result)!;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.update",
          resourceType: "crm_leads_lead",
          resourceId: id,
          severity: "info",
          message: "Lead changed.",
          attributes: { fields: result.changed }
        });

        return { status: 200, body: result.lead };
      }
    );
  }
});

/**
 * `DELETE /api/v1/crm-leads/leads/{id}` — SOFT delete (restorable). Needs
 * `If-Match: "<version>"` (`428 PRECONDITION_REQUIRED` without it) and an
 * `Idempotency-Key`. Erasure of the person is `POST /leads/{id}/anonymize`.
 */
export const DELETE = defineTenantRoute<{
  idempotencyKey: string;
  version: number;
}>({
  workClass: "interactive",
  prepare: ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const version = parseIfMatchVersion(request.headers.get("if-match"));

    return version === null
      ? fail(428, "PRECONDITION_REQUIRED", 'If-Match: "<version>" is required.')
      : { idempotencyKey, version };
  },
  authorize: CRM_LEADS_GUARDS.deleteLeads,
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
      "crm_leads_lead_delete",
      prepared.idempotencyKey,
      actor,
      { id, version: prepared.version },
      async () => {
        const result = await softDeleteLead(
          tx,
          tenantId,
          actor,
          id,
          prepared.version
        );

        switch (result.outcome) {
          case "not_found":
            return notFound("Lead");
          case "version_conflict":
            return versionConflict(result.currentVersion);
          case "already_deleted":
            return fail(409, "LEAD_ALREADY_DELETED", "The lead is deleted.");
          default:
            break;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.delete",
          resourceType: "crm_leads_lead",
          resourceId: id,
          severity: "warning",
          message: "Lead soft-deleted."
        });

        return { status: 200, body: { id, deleted: true } };
      }
    );
  }
});
