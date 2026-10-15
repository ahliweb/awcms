import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  actorOf,
  runAdminMutation
} from "../../../../../../modules/booking/application/booking-admin-routes";
import { restoreOffering } from "../../../../../../modules/booking/application/booking-offering-admin";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readReservationBody
} from "../../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../../modules/booking/domain/booking-permissions";
import { validateEmptyReservationBody } from "../../../../../../modules/booking/domain/booking-reservation-validation";

/**
 * `POST /api/v1/booking/offerings/{id}/restore` -- bring a soft-deleted offering
 * back. Restoring a live offering returns it with `replayed: true`. An unknown id
 * and another tenant's id are the same `404 OFFERING_NOT_FOUND`. Gated by
 * `booking.offerings.restore`; `Idempotency-Key` required; audited `info`. The body
 * is empty.
 */
export const POST = defineTenantRoute<{ id: string; idempotencyKey: string }>({
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

    const body = await readReservationBody(
      request,
      validateEmptyReservationBody
    );

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: BOOKING_GUARDS.offerings.restore,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runAdminMutation(
      tx,
      tenantId,
      auth,
      "booking_offering_restore",
      prepared.idempotencyKey,
      { id: prepared.id },
      200,
      () => restoreOffering(tx, tenantId, actorOf(auth, locals), prepared.id),
      (result) => ({ offering: result.offering, replayed: result.replayed })
    )
});
