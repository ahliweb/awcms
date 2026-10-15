import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  actorOf,
  authorizeDeletedView,
  deletedViewer,
  runAdminMutation
} from "../../../../../modules/booking/application/booking-admin-routes";
import {
  deleteOffering,
  getOffering,
  patchOffering
} from "../../../../../modules/booking/application/booking-offering-admin";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody
} from "../../../../../modules/booking/application/booking-route-support";
import {
  validateOfferingPatch,
  type OfferingPatchInput
} from "../../../../../modules/booking/domain/booking-admin-validation";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

/**
 * `GET /api/v1/booking/offerings/{id}` -- one offering, a soft-deleted one
 * included for a holder of `booking.offerings.restore` (anyone else gets the
 * neutral 404). An unknown id and another tenant's id are the same
 * `404 OFFERING_NOT_FOUND`. Gated by `booking.offerings.read`.
 */
export const GET = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: BOOKING_GUARDS.offerings.read,
  handler: async ({
    tx,
    tenantId,
    prepared,
    tokenHash,
    now,
    request,
    clientAddress
  }) => {
    const offering = await getOffering(tx, tenantId, prepared.id);

    // A soft-deleted row is visible only to a holder of `.restore` (the
    // ADR-0128 rule); to anyone else it is the same neutral 404 as an unknown id.
    if (offering && offering.deletedAt !== null) {
      const view = await authorizeDeletedView(
        tx,
        tenantId,
        tokenHash,
        now,
        BOOKING_GUARDS.offerings.restore,
        request,
        clientAddress
      );

      if (!view.allowed) {
        return fail(404, "OFFERING_NOT_FOUND", "Offering not found.");
      }
    }

    return offering
      ? ok({ offering })
      : fail(404, "OFFERING_NOT_FOUND", "Offering not found.");
  }
});

type PatchPrepared = {
  id: string;
  idempotencyKey: string;
  patch: OfferingPatchInput;
};

/**
 * `PATCH /api/v1/booking/offerings/{id}` -- edit an offering. `code` and
 * `granularity` are fixed; the merged row must still satisfy the shape of its
 * granularity (`400 VALIDATION_ERROR` otherwise). Changes FUTURE bookings
 * only: a reservation item keeps the snapshot it was made with.
 * `409 OFFERING_DELETED` for a deleted offering. Gated by
 * `booking.offerings.update`; `Idempotency-Key` required; audited `info`.
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

    const patch = await readValidatedBody(request, validateOfferingPatch);

    return patch instanceof Response ? patch : { id, idempotencyKey, patch };
  },
  authorize: BOOKING_GUARDS.offerings.update,
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
      "booking_offering_patch",
      prepared.idempotencyKey,
      { id: prepared.id, patch: prepared.patch },
      200,
      () =>
        patchOffering(
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
            BOOKING_GUARDS.offerings.restore,
            request,
            clientAddress
          )
        ),
      (result) => ({ offering: result.offering, replayed: result.replayed })
    )
});

/**
 * `DELETE /api/v1/booking/offerings/{id}` -- SOFT-delete an offering
 * (reservations keep their snapshot). Deleting a deleted offering returns it with
 * `replayed: true`. Gated by `booking.offerings.delete`; `Idempotency-Key`
 * required; audited `warning`.
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
    authorize: BOOKING_GUARDS.offerings.delete,
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
        "booking_offering_delete",
        prepared.idempotencyKey,
        { id: prepared.id },
        200,
        () =>
          deleteOffering(
            tx,
            tenantId,
            actorOf(auth, locals),
            prepared.id,
            deletedViewer(
              tx,
              tenantId,
              tokenHash,
              now,
              BOOKING_GUARDS.offerings.restore,
              request,
              clientAddress
            )
          ),
        (result) => ({ offering: result.offering, replayed: result.replayed })
      )
  }
);
