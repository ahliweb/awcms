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

const SCOPE = "booking_reservation_confirm";

/**
 * `POST /api/v1/booking/reservations/{id}/confirm` -- `held` -> `confirmed`
 * (booking.md section 3). Re-checks the hold has not expired under the
 * reservation's row lock, on the DATABASE clock: an elapsed hold is
 * `409 HOLD_EXPIRED` even when the sweep has not run, and so is one the sweep
 * already expired. A confirm racing the sweep serialises on that lock and exactly
 * one wins. Confirming a reservation that is already confirmed returns it with
 * `replayed: true` and writes nothing. Gated by `booking.reservations.confirm`;
 * `Idempotency-Key` required; audited and published (`awcms.booking.reservation.confirmed`).
 * The body is empty: payment is the commerce layer's, which decides WHEN to ask.
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
  authorize: BOOKING_GUARDS.reservations.confirm,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runTransitionRoute(tx, tenantId, auth, locals, SCOPE, "confirm", prepared)
});
