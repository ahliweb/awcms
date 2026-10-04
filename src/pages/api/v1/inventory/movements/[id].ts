import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { getMovement } from "../../../../../modules/inventory/application/inventory-movement-directory";
import {
  asUuid,
  toApiMovement
} from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";

/** `GET /api/v1/inventory/movements/{id}` — one ledger row. */
export const GET = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ params }) =>
    asUuid(params.id) ?? fail(400, "VALIDATION_ERROR", "id must be a UUID."),
  authorize: INVENTORY_GUARDS.movements.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const movement = await getMovement(tx, tenantId, prepared);

    return movement
      ? ok(toApiMovement(movement))
      : fail(404, "RESOURCE_NOT_FOUND", "Movement not found.");
  }
});
