import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readReservationBody
} from "../../../../../../modules/booking/application/booking-route-support";
import {
  runTransitionRoute,
  type TransitionRouteInput
} from "../../../../../../modules/booking/application/booking-transition-route";
import { BOOKING_GUARDS } from "../../../../../../modules/booking/domain/booking-permissions";
import { validateCancel } from "../../../../../../modules/booking/domain/booking-reservation-validation";

const SCOPE = "booking_reservation_cancel";

/**
 * `POST /api/v1/booking/reservations/{id}/cancel` -- `held` or `confirmed` ->
 * `cancelled`, releasing every live allocation in the same transaction
 * (booking.md section 3). `reasonCode` is an optional short code, never free
 * text. A cancellation inside the offering's `cancellation_cutoff_seconds` of the
 * start is recorded as `lateCancellation: true` on the reservation and the event;
 * the module records the fact, any fee is the commerce layer's. Cancelling an
 * already cancelled reservation returns it with `replayed: true` and writes
 * nothing. Gated by `booking.reservations.cancel`; `Idempotency-Key` required;
 * audited at warning severity and published (`awcms.booking.reservation.cancelled`).
 */
export const POST = defineTenantRoute<TransitionRouteInput>({
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

    const body = await readReservationBody(request, validateCancel);

    return body instanceof Response
      ? body
      : { id, idempotencyKey, reasonCode: body.reasonCode };
  },
  authorize: BOOKING_GUARDS.reservations.cancel,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runTransitionRoute(tx, tenantId, auth, locals, SCOPE, "cancel", prepared)
});
