import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createPipeline,
  listPipelines
} from "../../../../../modules/crm-leads/application/pipeline-directory";
import {
  auditCrmLeads,
  disabledResponse,
  mutationRefusal,
  prepareMutation,
  runIdempotent
} from "../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../modules/crm-leads/domain/crm-leads-constants";
import {
  validateCreatePipeline,
  type CreatePipelineInput
} from "../../../../../modules/crm-leads/domain/crm-leads-validation";

/** `GET /api/v1/crm-leads/pipelines` (Issue #1166) — the tenant's pipelines (at most 200). */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_LEADS_GUARDS.readLeads,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    return ok({ items: await listPipelines(context.tx, context.tenantId) });
  }
});

/**
 * `POST /api/v1/crm-leads/pipelines` — create a pipeline with its FIRST
 * immutable revision (stages, closed categories, allowed edges with closed
 * guards). The code is unique per tenant (`409 PIPELINE_CODE_TAKEN`).
 * High-risk (`configure`): `Idempotency-Key`, audited at `warning`.
 */
export const POST = defineTenantRoute<{
  idempotencyKey: string;
  input: CreatePipelineInput;
}>({
  workClass: "interactive",
  prepare: ({ request }) => prepareMutation(request, validateCreatePipeline),
  authorize: CRM_LEADS_GUARDS.configurePipelines,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      "crm_leads_pipeline_create",
      prepared.idempotencyKey,
      actor,
      prepared.input,
      async () => {
        const result = await createPipeline(
          tx,
          tenantId,
          actor,
          prepared.input
        );

        if (result.outcome === "code_taken") {
          return fail(
            409,
            "PIPELINE_CODE_TAKEN",
            "This pipeline code is already in use."
          );
        }

        await auditCrmLeads(context, {
          action: "crm_leads.pipeline.create",
          resourceType: "crm_leads_pipeline",
          resourceId: result.pipeline.id,
          severity: "warning",
          message: "Lead pipeline created with its first revision.",
          attributes: {
            code: result.pipeline.code,
            revisionNumber: 1,
            definitionHash: result.pipeline.currentRevision.definitionHash,
            stageCount: result.pipeline.currentRevision.stages.length,
            transitionCount: result.pipeline.currentRevision.transitions.length
          }
        });

        return { status: 201, body: result.pipeline };
      }
    );
  }
});
