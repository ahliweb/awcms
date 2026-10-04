import { created, fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createLocation,
  listLocations
} from "../../../../../modules/inventory/application/inventory-location-directory";
import { readValidatedBody } from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";
import { isLocationStatus } from "../../../../../modules/inventory/domain/inventory-types";
import {
  validateCreateLocationInput,
  type CreateLocationInput
} from "../../../../../modules/inventory/domain/inventory-validation";

type ListQuery = {
  status?: "active" | "inactive";
  after?: string;
  limit?: number;
};

/**
 * `GET /api/v1/inventory/locations` — this tenant's stock locations, by code,
 * keyset paginated (`?after=<last code>`). `?status=` filters.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  prepare: ({ url }): ListQuery | Response => {
    const status = url.searchParams.get("status");
    const limitParam = url.searchParams.get("limit");
    const query: ListQuery = {};

    if (status !== null) {
      if (!isLocationStatus(status)) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "status must be active or inactive."
        );
      }

      query.status = status;
    }

    if (limitParam !== null) {
      const limit = Number(limitParam);

      if (!Number.isInteger(limit) || limit < 1) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "limit must be a positive integer."
        );
      }

      query.limit = limit;
    }

    const after = url.searchParams.get("after");

    if (after !== null) {
      query.after = after;
    }

    return query;
  },
  authorize: INVENTORY_GUARDS.locations.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(await listLocations(tx, tenantId, prepared))
});

/**
 * `POST /api/v1/inventory/locations` — register a stock location.
 *
 * No `Idempotency-Key`, deliberately: the `(tenant_id, code)` unique key already
 * turns a retried create into a `409 LOCATION_CODE_CONFLICT`, which is the same
 * protection `POST /api/v1/blog/institutions` relies on.
 */
export const POST = defineTenantRoute<CreateLocationInput>({
  workClass: "interactive",
  prepare: ({ request }) =>
    readValidatedBody(request, validateCreateLocationInput),
  authorize: INVENTORY_GUARDS.locations.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await createLocation(
      tx,
      tenantId,
      auth.context.tenantUserId,
      prepared
    );

    if (result.outcome === "code_conflict") {
      return fail(
        409,
        "LOCATION_CODE_CONFLICT",
        `A stock location with code "${prepared.code}" already exists.`
      );
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
      action: "inventory.location.created",
      resourceType: "inventory_location",
      resourceId: result.location.id,
      severity: "info",
      message: `Stock location created: ${result.location.code}.`,
      attributes: {
        code: result.location.code,
        officeId: result.location.officeId
      },
      correlationId: locals.correlationId
    });

    return created(result.location);
  }
});
