import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  listReservations,
  parseReservationCursor,
  type ReservationListFilters
} from "../../../../../modules/booking/application/booking-reservation-directory";
import { createReservation } from "../../../../../modules/booking/application/booking-reservation-service";
import { resolveStaffAvailability } from "../../../../../modules/booking/application/booking-staff-availability-consumer";
import { loadStaffAvailabilityPort } from "../../../../../modules/booking/module";
import {
  asUuid,
  readIdempotencyKey,
  readReservationBody,
  refusalResponse,
  runIdempotent
} from "../../../../../modules/booking/application/booking-route-support";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";
import { RESERVATION_STATUSES } from "../../../../../modules/booking/domain/booking-reservation-state";
import {
  validateCreateReservation,
  type CreateReservationRequest
} from "../../../../../modules/booking/domain/booking-reservation-validation";

type ListPrepared = {
  filters: ReservationListFilters;
  cursor: ReturnType<typeof parseReservationCursor>;
};

/**
 * `GET /api/v1/booking/reservations` -- this tenant's reservations, newest first,
 * keyset paginated (`cursor`). Filters: `status`, `lineageId` (every reservation
 * of one booking across reschedules) and the adapter's natural key
 * (`externalRefType` + `externalRef`, both or neither). The customer note is never
 * returned (it is behind `booking.reservation_notes.read`). Gated by
 * `booking.reservations.read`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const status = url.searchParams.get("status");
    const lineageId = url.searchParams.get("lineageId");
    const externalRefType = url.searchParams.get("externalRefType");
    const externalRef = url.searchParams.get("externalRef");
    const cursorText = url.searchParams.get("cursor");

    if (
      status &&
      !(RESERVATION_STATUSES as readonly string[]).includes(status)
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "status is not a reservation status."
      );
    }

    if (lineageId && !asUuid(lineageId)) {
      return fail(400, "VALIDATION_ERROR", "lineageId must be a UUID.");
    }

    if (Boolean(externalRefType) !== Boolean(externalRef)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Send externalRefType and externalRef together."
      );
    }

    const cursor = cursorText ? parseReservationCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      filters: {
        ...(status ? { status } : {}),
        ...(lineageId ? { lineageId: asUuid(lineageId)! } : {}),
        ...(externalRefType && externalRef
          ? { externalRefType, externalRef }
          : {})
      },
      cursor
    };
  },
  authorize: BOOKING_GUARDS.reservations.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await listReservations(
        tx,
        tenantId,
        prepared.filters,
        prepared.cursor ?? undefined
      )
    )
});

type CreatePrepared = {
  idempotencyKey: string;
  request: CreateReservationRequest;
};

const CREATE_SCOPE = "booking_reservation_create";

/**
 * `POST /api/v1/booking/reservations` -- place a hold, or create a confirmed
 * reservation when the offering confirms immediately (booking.md sections 3, 5
 * and 8). The CLAIM is won all-or-none under the database's exclusion
 * constraints: a taken slot is `409 SLOT_UNAVAILABLE` and leaves nothing behind;
 * the server owns the status, the interval (derived from the offering and the
 * start, or from the stay's dates in the resource's zone), the buffers and the
 * hold expiry (database clock, `holdSeconds` clamped). A body naming a payment
 * field (`paid`, `deposit`, `amount`, ...) is `400 PAYMENT_FIELD_NOT_ACCEPTED`
 * naming it. Holds are capped per customer and per tenant (default 5 and 500;
 * `429 HOLD_LIMIT_EXCEEDED`).
 *
 * Policy -- opening hours (`OUTSIDE_SCHEDULE`), lead time, horizon -- is refused
 * with `409` unless `overridePolicy: true` AND the caller also holds
 * `booking.reservations.override` (HIGH-RISK; checked first through the one
 * chokepoint, so action-time separation-of-duties rules apply; audited `critical`).
 * An override never lifts a conflict.
 *
 * Gated by `booking.reservations.create`; `Idempotency-Key` required (a replay
 * returns the SAME response and writes nothing; an adapter retrying with a fresh
 * key against a live `externalRef` gets `409 EXTERNAL_REF_IN_USE`). Audited;
 * publishes `awcms.booking.reservation.created` and `.held` or `.confirmed`.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const body = await readReservationBody(request, validateCreateReservation);

    return body instanceof Response ? body : { idempotencyKey, request: body };
  },
  authorize: BOOKING_GUARDS.reservations.create,
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
    // The high-risk permission FIRST, before anything is read or written, through
    // the one chokepoint (ADR-0063): a caller holding `create` alone is denied 403
    // for a body that asks to lift policy, and a holder of `override` alone cannot
    // create. ADR-0092: a hand-written call passes the client IP explicitly.
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
      CREATE_SCOPE,
      prepared.idempotencyKey,
      actor,
      prepared.request,
      async () => {
        const result = await createReservation(
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
          prepared.request,
          prepared.request.overridePolicy
        );

        switch (result.outcome) {
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
              status: 201,
              body: {
                reservation: result.reservation,
                replayed: false,
                policyLifted: result.policyLifted
              }
            };
        }
      }
    );
  }
});
