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
import { validateEmptyReservationBody } from "../../../../../../modules/booking/domain/booking-reservation-validation";

const SCOPE = "booking_reservation_check_out";

/**
 * `POST /api/v1/booking/reservations/{id}/check-out` -- `checked_in` ->
 * `completed` (the `complete` verb, "check-out" in the UI; booking.md section 3).
 * The booked interval is NOT shrunk by an early departure: the allocations are
 * kept, as for a slot (releasing unused nights is an open question, section 11).
 * Completing a completed reservation returns it with `replayed: true` and writes
 * nothing. Gated by `booking.reservations.complete`; `Idempotency-Key` required;
 * audited and published (`awcms.booking.reservation.completed`).
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

    const body = await readReservationBody(
      request,
      validateEmptyReservationBody
    );

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: BOOKING_GUARDS.reservations.complete,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runTransitionRoute(tx, tenantId, auth, locals, SCOPE, "complete", prepared)
});
