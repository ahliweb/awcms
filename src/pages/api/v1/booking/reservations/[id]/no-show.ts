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

const SCOPE = "booking_reservation_no_show";

/**
 * `POST /api/v1/booking/reservations/{id}/no-show` -- `confirmed` -> `no_show`,
 * marked BY A PERSON after the start plus the grace period (booking.md section 3;
 * `no_show_grace_seconds`, default 15 minutes; for a stay the start is the arrival
 * instant). There is no automatic no-show in v1: nothing but this route, behind
 * its own staff permission, ever writes the state, and a customer-facing adapter
 * credential is simply not granted `booking.reservations.no_show`. Earlier than
 * the grace allows is `409 NO_SHOW_TOO_EARLY`. The allocations are KEPT, so the
 * slot is accounted as consumed. Marking a no-show twice returns the reservation
 * with `replayed: true` and writes nothing. Gated by `booking.reservations.no_show`;
 * `Idempotency-Key` required; audited at warning severity and published
 * (`awcms.booking.reservation.no_show`).
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
  authorize: BOOKING_GUARDS.reservations.noShow,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runTransitionRoute(tx, tenantId, auth, locals, SCOPE, "no_show", prepared)
});
