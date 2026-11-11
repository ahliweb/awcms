import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  createLead,
  listLeads
} from "../../../../../modules/crm-leads/application/lead-directory";
import {
  auditCrmLeads,
  disabledResponse,
  emitContext,
  mutationRefusal,
  prepareMutation,
  requireRings,
  runIdempotent,
  tenantDisabledResponse
} from "../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  encodeLeadCursor,
  validateCreateLead,
  validateListLeadsQuery,
  type CreateLeadInput,
  type ListLeadsQuery
} from "../../../../../modules/crm-leads/domain/crm-leads-validation";

/**
 * `GET /api/v1/crm-leads/leads` (Issue #1166) — the tenant's leads, newest
 * first, keyset-paginated, with MASKED contact points only. Filters: pipeline,
 * stage category, owner; soft-deleted rows only with `includeDeleted=true`,
 * which additionally requires `crm_leads.leads.restore` or
 * `crm_leads.leads.delete`.
 */
export const GET = defineTenantRoute<ListLeadsQuery>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const query = validateListLeadsQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, query.errors);
  },
  authorize: CRM_LEADS_GUARDS.readLeads,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    // Soft-deleted leads are visible only to someone who may act on a deleted
    // lead (`leads.restore` or `leads.delete`): `leads.read` alone sees live
    // leads. Each candidate is decided by the chokepoint and logged.
    if (context.prepared.includeDeleted) {
      const restore = await authorizeInTransaction(
        context.tx,
        context.tenantId,
        context.tokenHash,
        context.now,
        CRM_LEADS_GUARDS.restoreLeads
      );

      if (!restore.allowed) {
        const remove = await authorizeInTransaction(
          context.tx,
          context.tenantId,
          context.tokenHash,
          context.now,
          CRM_LEADS_GUARDS.deleteLeads
        );

        if (!remove.allowed) return remove.denied;
      }
    }

    const page = await listLeads(
      context.tx,
      context.tenantId,
      context.prepared
    );

    return ok({
      items: page.items,
      nextCursor: page.nextCursor ? encodeLeadCursor(page.nextCursor) : null
    });
  }
});

/**
 * `POST /api/v1/crm-leads/leads` (ADR-0153 section 4) — lead intake through the
 * `manual`, `import` or `api` path. Idempotent twice over: on the
 * `Idempotency-Key` AND on the source key `(source kind, channel account,
 * externalEventId)`, so a replayed webhook or a re-uploaded row returns the
 * SAME lead (`200`, `duplicate: true`) and writes nothing. Creates no profile,
 * no consent and no customer. Requires `crm_leads.leads.create`.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: CreateLeadInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) =>
    prepareMutation(request, (raw) => validateCreateLead(raw)),
  authorize: CRM_LEADS_GUARDS.createLeads,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const tenantOff = await tenantDisabledResponse(tx, tenantId);

    if (tenantOff) return tenantOff;

    const rings = requireRings();

    if (rings instanceof Response) return rings;

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_leads_lead_create",
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const result = await createLead(
          tx,
          tenantId,
          actor,
          prepared.input,
          rings,
          emitContext(context, prepared.idempotencyKey)
        );

        switch (result.outcome) {
          case "pipeline_not_found":
            return fail(422, "PIPELINE_NOT_FOUND", "Pipeline not found.");
          case "pipeline_archived":
            return fail(409, "PIPELINE_ARCHIVED", "The pipeline is archived.");
          case "owner_not_found":
            return fail(
              422,
              "OWNER_NOT_FOUND",
              "The owner is not an active user of this tenant."
            );
          case "duplicate":
            // The id only: `leads.create` is not a right to read the lead the
            // source key resolves to (read it with GET under `leads.read`).
            return {
              status: 200,
              body: { id: result.leadId, duplicate: true }
            };
          case "created":
            break;
        }

        await auditCrmLeads(context, {
          action: "crm_leads.lead.create",
          resourceType: "crm_leads_lead",
          resourceId: result.lead.id,
          severity: "info",
          message: "Lead created.",
          attributes: {
            pipelineId: result.lead.pipelineId,
            stageKey: result.lead.stageKey,
            sourceKind: prepared.input.source.kind,
            contactPointCount: result.lead.contactPoints.length
          }
        });

        return { status: 201, body: { ...result.lead, duplicate: false } };
      }
    );
  }
});
