import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  actorOf,
  authorizeDeletedView,
  deletedViewer,
  runAdminMutation
} from "../../../../../modules/booking/application/booking-admin-routes";
import {
  deleteResource,
  getResource,
  patchResource
} from "../../../../../modules/booking/application/booking-resource-admin";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import {
  validateResourcePatch,
  type ResourcePatchInput
} from "../../../../../modules/booking/domain/booking-admin-validation";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

/**
 * `GET /api/v1/booking/resources/{id}` -- one resource with its units, a
 * soft-deleted one included for a holder of `booking.resources.restore` (so a
 * screen can offer the restore; anyone else gets the neutral 404). An unknown id
 * and another tenant's id are the same `404 RESOURCE_NOT_FOUND`. Gated by
 * `booking.resources.read`.
 */
export const GET = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: BOOKING_GUARDS.resources.read,
  handler: async ({
    tx,
    tenantId,
    prepared,
    tokenHash,
    now,
    request,
    clientAddress
  }) => {
    const resource = await getResource(tx, tenantId, prepared.id);

    // A soft-deleted row is visible only to a holder of `.restore` (the
    // ADR-0128 rule); to anyone else it is the same neutral 404 as an unknown id.
    if (resource && resource.deletedAt !== null) {
      const view = await authorizeDeletedView(
        tx,
        tenantId,
        tokenHash,
        now,
        BOOKING_GUARDS.resources.restore,
        request,
        clientAddress
      );

      if (!view.allowed) {
        return fail(404, "RESOURCE_NOT_FOUND", "Resource not found.");
      }
    }

    return resource
      ? ok({ resource })
      : fail(404, "RESOURCE_NOT_FOUND", "Resource not found.");
  }
});

type PatchPrepared = {
  id: string;
  idempotencyKey: string;
  patch: ResourcePatchInput;
};

/**
 * `PATCH /api/v1/booking/resources/{id}` -- edit a resource. `code` is fixed.
 * Fields: `name`, `kind`, `status`, `poolId` (a pool id, or null to leave the
 * pool: this is the pool membership), `timezone`, `bookingMode`, the stay times,
 * `sortOrder`, `capacity` (GROW only: new units are added, and a resource-wide
 * block covers them) and `units` (relabel or activate/deactivate by unit id).
 * Refusals: `409 BOOKING_MODE_IN_USE` and `409 TIMEZONE_IN_USE` (live
 * allocations or active blocks), `409 SCHEDULE_TIMEZONE_MISMATCH` (an active
 * schedule in the current zone), `409 CAPACITY_REDUCTION_NOT_ALLOWED`,
 * `409 RESOURCE_DELETED`, `404 UNIT_NOT_FOUND`, `404 POOL_NOT_FOUND`. A refusal
 * writes nothing. Gated by `booking.resources.update`; `Idempotency-Key`
 * required; audited `info`.
 */
export const PATCH = defineTenantRoute<PatchPrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const patch = await readValidatedBody(request, validateResourcePatch);

    return patch instanceof Response ? patch : { id, idempotencyKey, patch };
  },
  authorize: BOOKING_GUARDS.resources.update,
  handler: ({
    tx,
    tenantId,
    auth,
    prepared,
    locals,
    tokenHash,
    now,
    request,
    clientAddress
  }) =>
    runAdminMutation(
      tx,
      tenantId,
      auth,
      "booking_resource_patch",
      prepared.idempotencyKey,
      { id: prepared.id, patch: prepared.patch },
      200,
      () =>
        patchResource(
          tx,
          tenantId,
          actorOf(auth, locals),
          prepared.id,
          prepared.patch,
          deletedViewer(
            tx,
            tenantId,
            tokenHash,
            now,
            BOOKING_GUARDS.resources.restore,
            request,
            clientAddress
          )
        ),
      (result) => ({ resource: result.resource, replayed: result.replayed })
    )
});

/**
 * `DELETE /api/v1/booking/resources/{id}` -- SOFT-delete a resource (reservations
 * keep referencing it; nothing is removed). Refused with
 * `409 RESOURCE_IN_USE` while a held, confirmed or checked-in reservation or an
 * active block needs it (set `status: "inactive"` to stop selling instead).
 * Deleting a deleted resource returns it with `replayed: true`. Gated by
 * `booking.resources.delete`; `Idempotency-Key` required; audited `warning`.
 * The body is empty.
 */
export const DELETE = defineTenantRoute<{ id: string; idempotencyKey: string }>(
  {
    workClass: "interactive",
    prepare: ({ request, params }) => {
      const id = asUuid(params.id);

      if (!id) {
        return badId();
      }

      const idempotencyKey = readIdempotencyKey(request);

      return idempotencyKey instanceof Response
        ? idempotencyKey
        : { id, idempotencyKey };
    },
    authorize: BOOKING_GUARDS.resources.delete,
    handler: ({
      tx,
      tenantId,
      auth,
      prepared,
      locals,
      tokenHash,
      now,
      request,
      clientAddress
    }) =>
      runAdminMutation(
        tx,
        tenantId,
        auth,
        "booking_resource_delete",
        prepared.idempotencyKey,
        { id: prepared.id },
        200,
        () =>
          deleteResource(
            tx,
            tenantId,
            actorOf(auth, locals),
            prepared.id,
            deletedViewer(
              tx,
              tenantId,
              tokenHash,
              now,
              BOOKING_GUARDS.resources.restore,
              request,
              clientAddress
            )
          ),
        (result) => ({ resource: result.resource, replayed: result.replayed })
      )
  }
);
