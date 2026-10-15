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

const SCOPE = "booking_reservation_check_in";

/**
 * `POST /api/v1/booking/reservations/{id}/check-in` -- `confirmed` ->
 * `checked_in`; the allocations are kept (booking.md section 3). A stay is
 * refused (`409 CHECK_IN_TOO_EARLY`) before its check-in DATE in the resource's
 * time zone; there is deliberately no time-of-day check, an early arrival being a
 * front-desk decision (section 3.1). Checking in a checked-in reservation returns
 * it with `replayed: true` and writes nothing. Gated by
 * `booking.reservations.check_in`; `Idempotency-Key` required; audited and
 * published (`awcms.booking.reservation.checked_in`).
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
  authorize: BOOKING_GUARDS.reservations.checkIn,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runTransitionRoute(tx, tenantId, auth, locals, SCOPE, "check_in", prepared)
});
