import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchDeploymentDetail } from "../../../../../modules/omes-control/application/deployment-directory";

/** `GET /api/v1/omes/deployments/{id}` (Issue ahliweb/omes#198) — `{id}` is `awcms_omes_deployments.id`. */
export const GET = defineTenantRoute<undefined>({
  workClass: "interactive",
  authorize: OMES_GUARDS.deployments.read,
  handler: async ({ tx, tenantId, now, params }) => {
    const id = params.id;

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "Deployment id is required.");
    }

    const deployment = await fetchDeploymentDetail(tx, tenantId, id, now);

    if (!deployment) {
      return fail(404, "RESOURCE_NOT_FOUND", "Deployment not found.");
    }

    return ok({ deployment });
  }
});
