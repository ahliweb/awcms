import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  getReservation,
  listReservationEvents
} from "../../../../../modules/booking/application/booking-reservation-directory";
import {
  asUuid,
  badId,
  reservationNotFound
} from "../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";

/**
 * `GET /api/v1/booking/reservations/{id}` -- one reservation with its items and
 * its append-only transition history. The customer note is never returned (it is
 * behind `booking.reservation_notes.read`, an audited read with its own route).
 * An unknown id and another tenant's id are the same `404 RESERVATION_NOT_FOUND`.
 * Gated by `booking.reservations.read`. There is no ownership grant on this read:
 * the customer is an opaque reference at the commerce authority, not a tenant user
 * who could be recognised as "the owner", and the creator of a reservation is not
 * entitled to read it merely for having created it (booking.md section 6).
 */
export const GET = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: BOOKING_GUARDS.reservations.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const reservation = await getReservation(tx, tenantId, prepared.id);

    if (!reservation) {
      return reservationNotFound();
    }

    return ok({
      reservation,
      events: await listReservationEvents(tx, tenantId, prepared.id)
    });
  }
});
