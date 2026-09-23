import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchOperationRequestDetail } from "../../../../../modules/omes-control/application/operation-directory";

/** `GET /api/v1/omes/operations/{id}` (Issue ahliweb/omes#198) — `{id}` is `awcms_omes_operation_requests.id`. */
export const GET = defineTenantRoute<undefined>({
  workClass: "interactive",
  authorize: OMES_GUARDS.deployments.read,
  handler: async ({ tx, tenantId, params }) => {
    const id = params.id;

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "Operation request id is required.");
    }

    const operationRequest = await fetchOperationRequestDetail(
      tx,
      tenantId,
      id
    );

    if (!operationRequest) {
      return fail(404, "RESOURCE_NOT_FOUND", "Operation request not found.");
    }

    return ok({ operationRequest });
  }
});
