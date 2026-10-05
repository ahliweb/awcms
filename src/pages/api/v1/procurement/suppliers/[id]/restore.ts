import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { restoreSupplier } from "../../../../../../modules/procurement/application/procurement-supplier-directory";
import {
  asUuid,
  badId
} from "../../../../../../modules/procurement/application/procurement-route-support";
import { PROCUREMENT_GUARDS } from "../../../../../../modules/procurement/domain/procurement-permissions";

/** `POST /api/v1/procurement/suppliers/{id}/restore` — undo a soft delete. */
export const POST = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ params }) => asUuid(params.id) ?? badId(),
  authorize: PROCUREMENT_GUARDS.suppliers.restore,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await restoreSupplier(tx, tenantId, prepared, {
      actorTenantUserId: auth.context.tenantUserId,
      correlationId: locals.correlationId
    });

    switch (result.outcome) {
      case "ok":
        return ok(result.supplier);
      case "not_found":
        return fail(404, "RESOURCE_NOT_FOUND", "Supplier not found.");
      case "not_deleted":
        return fail(409, "NOT_DELETED", "The supplier is not deleted.");
      default:
        return fail(500, "INTERNAL_ERROR", "Unexpected outcome.");
    }
  }
});
