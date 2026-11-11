import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fetchPipeline } from "../../../../../../modules/crm-leads/application/pipeline-directory";
import {
  asUuid,
  badId,
  disabledResponse,
  notFound
} from "../../../../../../modules/crm-leads/application/route-support";
import { CRM_LEADS_GUARDS } from "../../../../../../modules/crm-leads/domain/crm-leads-constants";

/**
 * `GET /api/v1/crm-leads/pipelines/{id}` (Issue #1166) — one pipeline with its
 * CURRENT revision (stages in order, categories, allowed edges, guards). An id
 * in another tenant answers exactly like an id that does not exist.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: CRM_LEADS_GUARDS.readLeads,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const id = asUuid(context.params.id);

    if (!id) return badId();

    const pipeline = await fetchPipeline(context.tx, context.tenantId, id);

    return pipeline ? ok(pipeline) : notFound("Pipeline");
  }
});
