import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  getLocation,
  updateLocation
} from "../../../../../modules/inventory/application/inventory-location-directory";
import {
  asUuid,
  readValidatedBody
} from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";
import {
  validateUpdateLocationInput,
  type UpdateLocationInput
} from "../../../../../modules/inventory/domain/inventory-validation";

/** `GET /api/v1/inventory/locations/{id}`. */
export const GET = defineTenantRoute<string>({
  workClass: "interactive",
  prepare: ({ params }) =>
    asUuid(params.id) ?? fail(400, "VALIDATION_ERROR", "id must be a UUID."),
  authorize: INVENTORY_GUARDS.locations.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const location = await getLocation(tx, tenantId, prepared);

    return location
      ? ok(location)
      : fail(404, "RESOURCE_NOT_FOUND", "Stock location not found.");
  }
});

type PatchPrepared = { id: string; patch: UpdateLocationInput };

/**
 * `PATCH /api/v1/inventory/locations/{id}` — rename, re-attach to a business
 * location, or (de)activate. A location is never deleted: its movements are
 * ledger rows that must keep a place to point at. `negativeStockPolicy` is NOT
 * accepted here — it is a different power and has its own endpoint.
 */
export const PATCH = defineTenantRoute<PatchPrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "id must be a UUID.");
    }

    const patch = await readValidatedBody(request, validateUpdateLocationInput);

    return patch instanceof Response ? patch : { id, patch };
  },
  authorize: INVENTORY_GUARDS.locations.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await updateLocation(
      tx,
      tenantId,
      auth.context.tenantUserId,
      prepared.id,
      prepared.patch
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Stock location not found.");
    }

    if (result.outcome === "office_not_found") {
      return fail(
        422,
        "OFFICE_NOT_FOUND",
        "officeId does not name an office in this tenant."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "inventory",
      action: "inventory.location.updated",
      resourceType: "inventory_location",
      resourceId: prepared.id,
      severity:
        result.before.status === result.location.status ? "info" : "warning",
      message: `Stock location updated: ${result.location.code}.`,
      attributes: {
        fieldsChanged: Object.keys(prepared.patch).sort(),
        statusBefore: result.before.status,
        statusAfter: result.location.status
      },
      correlationId: locals.correlationId
    });

    return ok(result.location);
  }
});
