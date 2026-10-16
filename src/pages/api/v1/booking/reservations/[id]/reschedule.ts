import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { resolveClientIp } from "../../../../../../lib/security/rate-limit";
import { authorizeInTransaction } from "../../../../../../modules/identity-access/application/access-guard";
import { rescheduleReservation } from "../../../../../../modules/booking/application/booking-reservation-service";
import { resolveStaffAvailability } from "../../../../../../modules/booking/application/booking-staff-availability-consumer";
import { loadStaffAvailabilityPort } from "../../../../../../modules/booking/module";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readReservationBody,
  refusalResponse,
  reservationNotFound,
  runIdempotent
} from "../../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../../modules/booking/domain/booking-permissions";
import {
  validateReschedule,
  type RescheduleRequest
} from "../../../../../../modules/booking/domain/booking-reservation-validation";
import { fail } from "../../../../../../modules/_shared/api-response";

type Prepared = {
  id: string;
  idempotencyKey: string;
  request: RescheduleRequest;
};

const SCOPE = "booking_reservation_reschedule";

/**
 * `POST /api/v1/booking/reservations/{id}/reschedule` -- move a `confirmed`
 * reservation to a new time or dates (booking.md sections 3 and 5.3). ONE
 * transaction: the old allocations are released, the old reservation becomes
 * `rescheduled` naming its replacement, and the replacement is inserted
 * `confirmed` under the same `lineageId` with `rescheduledFromId` set, carrying
 * the old customer reference, party, source, note and external reference. Moving
 * or extending over one's own slot or nights does not conflict with itself.
 * Intervals are never edited in place. ANY refusal -- the new interval is taken
 * (`409 SLOT_UNAVAILABLE`), outside policy, contended -- rolls everything back to
 * the untouched original, which stays `confirmed` with its allocations live.
 *
 * The new time is `startsAt` (a slot) or `stay` (check-in and check-out dates);
 * `resourceId` or `poolId` moves it elsewhere, otherwise it stays where it was
 * (a reservation spanning several resources must say where it goes:
 * `400 RESOURCE_REQUIRED`). `overridePolicy: true` lifts hours, lead time and
 * horizon and additionally needs `booking.reservations.override` (HIGH-RISK,
 * action-time separation-of-duties applies, audited `critical`); it never lifts a
 * conflict. Rescheduling an already-rescheduled reservation to the same time
 * returns the replacement with `replayed: true`.
 *
 * Gated by `booking.reservations.reschedule`; `Idempotency-Key` required; audited
 * at warning severity; publishes `awcms.booking.reservation.rescheduled` for the
 * old reservation and `created` + `confirmed` for the replacement.
 */
export const POST = defineTenantRoute<Prepared>({
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

    const body = await readReservationBody(request, validateReschedule);

    return body instanceof Response
      ? body
      : { id, idempotencyKey, request: body };
  },
  authorize: BOOKING_GUARDS.reservations.reschedule,
  handler: async ({
    tx,
    tenantId,
    auth,
    prepared,
    locals,
    tokenHash,
    now,
    request,
    clientAddress
  }) => {
    // The high-risk permission is checked FIRST, before anything is read or
    // written, through the one chokepoint: a caller holding `reschedule` alone is
    // denied 403 for a body that asks to lift policy. (ADR-0092: a hand-written
    // call passes the client IP so the machine-credential restriction holds.)
    if (prepared.request.overridePolicy) {
      const override = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        BOOKING_GUARDS.reservations.override,
        { clientIp: resolveClientIp(request, clientAddress) }
      );

      if (!override.allowed) {
        return override.denied;
      }
    }

    const actor = auth.context.tenantUserId;

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, ...prepared.request },
      async () => {
        const result = await rescheduleReservation(
          tx,
          {
            tenantId,
            actorTenantUserId: actor,
            staff: await resolveStaffAvailability(
              tx,
              tenantId,
              loadStaffAvailabilityPort
            ),
            ...(locals.correlationId
              ? { correlationId: locals.correlationId }
              : {})
          },
          prepared.id,
          prepared.request,
          prepared.request.overridePolicy
        );

        switch (result.outcome) {
          case "not_found":
            return reservationNotFound();
          case "refused":
            return refusalResponse(result);
          case "invalid":
            return fail(
              400,
              result.errors.some((issue) => issue.code === "STAY_DATES_INVALID")
                ? "STAY_DATES_INVALID"
                : "VALIDATION_ERROR",
              "Request is invalid.",
              {},
              result.errors
            );
          case "ok":
            return {
              status: 200,
              body: {
                reservation: result.reservation,
                previous: result.previous,
                replayed: result.replayed,
                policyLifted: result.policyLifted
              }
            };
        }
      }
    );
  }
});
