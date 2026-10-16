/**
 * The `BookingPort` implemented by `booking`'s application layer (Issue #941,
 * ADR-0131, ADR-0011; `docs/awcms/cross-domain-contracts.md` section 3).
 *
 * A consumer's composition root (a route, a job) injects this; the consumer
 * depends on `_shared/ports/booking-port.ts` and never imports this file. Every
 * method is a thin translation: the port's input to the service's, the service's
 * refusal to the port's `{ ok: false, reason }`. The behaviour -- the claim, the
 * state machine, the audit row, the domain event -- is the service's, so a
 * transition made through the port is identical to one made through the HTTP
 * route, including what it publishes.
 *
 * ## What the port adds
 *
 *   * **Idempotency by key**, on the same store as the routes (booking.md section
 *     5.2 layer 1) but under its own scopes: the same key and request replays the
 *     original outcome with `replayed: true`; the same key with a different request
 *     is `IDEMPOTENCY_CONFLICT`. Only a SUCCESS is stored, so a refusal can be
 *     retried after the caller fixes something. (The save may throw
 *     `IdempotencyRaceLostError` when a concurrent call with the same key wins; the
 *     caller's `withTenant` turns that into the replay, as it does for a route.)
 *   * **No override.** Lifting hours, lead time or horizon is a human act behind
 *     the high-risk `reservations.override` permission and its action-time
 *     separation-of-duties check; an adapter cannot ask for it.
 *   * **A payment field is refused by name** (`PAYMENT_FIELD_NOT_ACCEPTED`), at
 *     runtime as well as by the type, because the adapter is exactly the caller
 *     that would try to tuck its payment into the reservation.
 *
 * The port authorizes nothing (the CONSUMER's route does) and runs inside the
 * caller's tenant transaction.
 */
import type {
  BookingHoldInput,
  BookingOutcome,
  BookingPort,
  BookingQuoteInput,
  BookingQuoteResult,
  BookingRefusal
} from "../../_shared/ports/booking-port";
import {
  computeRequestHash,
  IdempotencyRaceLostError,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../_shared/idempotency";
import type { PlaceHoldInput } from "../domain/booking-allocation";
import {
  REASON_CODE_PATTERN,
  isPaymentFieldName
} from "../domain/booking-reservation-validation";
import { parseInstant } from "../domain/booking-validation";
import { lockIdempotencyKey } from "./booking-route-support";
import {
  NO_OP_STAFF_AVAILABILITY,
  type StaffAvailabilityConsumer
} from "../domain/booking-staff-availability";
import { answerAvailability } from "./booking-availability-directory";
import { evaluateClaimPolicy } from "./booking-reservation-policy";
import {
  createReservation,
  rescheduleReservation,
  transitionReservation,
  type ReservationContext,
  type TransitionAction
} from "./booking-reservation-service";
import type { ReservationView } from "./booking-reservation-directory";

type Sql = Bun.SQL;

const REFUSALS = new Set<string>([
  "SLOT_UNAVAILABLE",
  "OUTSIDE_SCHEDULE",
  "LEAD_TIME_VIOLATION",
  "HORIZON_EXCEEDED",
  "PARTY_SIZE_OUT_OF_RANGE",
  "QUANTITY_EXCEEDS_UNITS",
  "BOOKING_MODE_MISMATCH",
  "MIN_STAY_VIOLATION",
  "MAX_STAY_EXCEEDED",
  "STAY_DATES_INVALID",
  "STAY_POOL_INCONSISTENT",
  "STAFF_UNAVAILABLE",
  "HOLD_EXPIRED",
  "HOLD_LIMIT_EXCEEDED",
  "CONTENTION_RETRY",
  "EXTERNAL_REF_IN_USE",
  "RESOURCE_NOT_FOUND",
  "OFFERING_NOT_FOUND",
  "RESERVATION_NOT_FOUND",
  "RESOURCE_REQUIRED",
  "INVALID_STATE",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_FIELD_NOT_ACCEPTED",
  "VALIDATION_ERROR"
]);

/** A service refusal code as the port's union. A code the port does not name (a verb the port does not offer) is a state refusal. */
function toReason(code: string): BookingRefusal {
  return REFUSALS.has(code) ? (code as BookingRefusal) : "INVALID_STATE";
}

function refused(code: string): { ok: false; reason: BookingRefusal } {
  return { ok: false, reason: toReason(code) };
}

function outcomeOf(
  reservation: ReservationView,
  replayed: boolean
): BookingOutcome {
  return {
    ok: true,
    reservationId: reservation.id,
    status: reservation.status,
    holdExpiresAt: reservation.holdExpiresAt,
    replayed
  };
}

/**
 * Resolves the staff constraint for a tenant. Injected by the composition root
 * (`booking/module.ts` owns the lazy import of the hr_workforce adapter,
 * ADR-0011); this file never reaches `hr_workforce`.
 */
export type StaffResolver = (
  tx: Sql,
  tenantId: string
) => Promise<StaffAvailabilityConsumer>;

function contextOf(
  input: {
    tenantId: string;
    correlationId: string;
    actorTenantUserId: string;
  },
  staff: StaffAvailabilityConsumer
): ReservationContext {
  return {
    tenantId: input.tenantId,
    actorTenantUserId: input.actorTenantUserId,
    correlationId: input.correlationId,
    staff
  };
}

/**
 * Layer 1 for the port: at most once per `(scope, key, actor)`. `payload` is the
 * request WITHOUT the key and the correlation id (neither is part of what was
 * asked). Returns the stored outcome with `replayed: true`, a conflict, or the
 * produced outcome (stored when it succeeded).
 */
async function once(
  tx: Sql,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actor: string,
  payload: unknown,
  produce: () => Promise<BookingOutcome>
): Promise<BookingOutcome> {
  const requestHash = computeRequestHash({
    actor,
    request: payload
  });
  const idempotencyActor = userIdempotencyActor(actor);

  // Concurrent calls with one key queue here, so a retry replays the winner's
  // outcome instead of being refused by the winner's uncommitted booking.
  await lockIdempotencyKey(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    idempotencyActor
  );

  const existing = await findIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    idempotencyActor
  );

  if (existing) {
    return replayOf(existing.requestHash, requestHash, existing.responseBody);
  }

  // The produce+save pair runs in a savepoint: if the save loses a race anyway
  // (a caller that bypassed the lock), the loser's writes are rolled back and it
  // answers with the winner's stored outcome instead of throwing.
  const savepoint = "booking_port_once";

  await tx.unsafe(`SAVEPOINT ${savepoint}`);

  try {
    const produced = await produce();

    if (produced.ok) {
      await saveIdempotencyRecord(
        tx,
        tenantId,
        scope,
        idempotencyKey,
        idempotencyActor,
        requestHash,
        200,
        produced
      );
    }

    await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);

    return produced;
  } catch (error) {
    await tx.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);

    if (error instanceof IdempotencyRaceLostError) {
      return error.replay
        ? ({
            ...(error.replay.responseBody as BookingOutcome),
            replayed: true
          } as BookingOutcome)
        : { ok: false, reason: "IDEMPOTENCY_CONFLICT" };
    }

    throw error;
  }
}

function replayOf(
  storedHash: string,
  requestHash: string,
  body: unknown
): BookingOutcome {
  if (storedHash !== requestHash) {
    return { ok: false, reason: "IDEMPOTENCY_CONFLICT" };
  }

  return { ...(body as BookingOutcome), replayed: true } as BookingOutcome;
}

function withoutBookkeeping(input: object): Record<string, unknown> {
  const copy: Record<string, unknown> = {
    ...(input as Record<string, unknown>)
  };

  delete copy.idempotencyKey;
  delete copy.correlationId;
  delete copy.actorTenantUserId;

  return copy;
}

function paymentField(input: object): string | undefined {
  return Object.keys(input).find(isPaymentFieldName);
}

function whenOf(input: {
  startsAt?: string;
  stay?: { checkInDate: string; checkOutDate: string };
}):
  | { startsAtMs: number }
  | { stay: { checkInDate: string; checkOutDate: string } }
  | null {
  if ((input.startsAt === undefined) === (input.stay === undefined)) {
    return null;
  }

  if (input.stay) {
    return { stay: input.stay };
  }

  const startsAtMs = parseInstant(input.startsAt);

  return startsAtMs === null ? null : { startsAtMs };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const STAY_REASON_TO_REFUSAL: Readonly<Record<string, BookingRefusal>> = {
  STAY_DATES_INVALID: "STAY_DATES_INVALID",
  MIN_STAY_VIOLATION: "MIN_STAY_VIOLATION",
  MAX_STAY_EXCEEDED: "MAX_STAY_EXCEEDED",
  LEAD_TIME_NOT_MET: "LEAD_TIME_VIOLATION",
  BEYOND_HORIZON: "HORIZON_EXCEEDED",
  OUTSIDE_SCHEDULE: "OUTSIDE_SCHEDULE",
  BLOCKED: "SLOT_UNAVAILABLE",
  NO_UNIT_AVAILABLE: "SLOT_UNAVAILABLE"
};

async function quote(
  tx: Sql,
  input: BookingQuoteInput,
  resolveStaff: StaffResolver
): Promise<BookingQuoteResult> {
  const payment = paymentField(input);

  if (payment) {
    return refused("PAYMENT_FIELD_NOT_ACCEPTED");
  }

  const when = whenOf(input);

  if (!when) {
    return refused("VALIDATION_ERROR");
  }

  const quantity = input.quantity ?? 1;
  const policy = await evaluateClaimPolicy(tx, input.tenantId, {
    offeringId: input.offeringId,
    resourceId: input.resourceId,
    ...when
  });

  if (policy.length > 0) {
    return refused(policy[0]!.code);
  }

  if ("stay" in when) {
    const answered = await answerAvailability(tx, input.tenantId, {
      mode: "stay",
      resourceId: input.resourceId,
      offeringId: input.offeringId,
      quantity,
      checkInDate: when.stay.checkInDate,
      checkOutDate: when.stay.checkOutDate
    });

    if (answered.outcome !== "ok") {
      return refused(
        answered.outcome === "not_found"
          ? answered.what === "resource"
            ? "RESOURCE_NOT_FOUND"
            : "OFFERING_NOT_FOUND"
          : answered.outcome === "mode_mismatch"
            ? "BOOKING_MODE_MISMATCH"
            : "QUANTITY_EXCEEDS_UNITS"
      );
    }

    const stay = answered.answer;

    if (stay.mode !== "stay" || !stay.available) {
      return refused(
        stay.mode === "stay" && stay.reasons[0]
          ? (STAY_REASON_TO_REFUSAL[stay.reasons[0].code] ?? "SLOT_UNAVAILABLE")
          : "SLOT_UNAVAILABLE"
      );
    }

    return {
      ok: true,
      endsAt: stay.departureAt!,
      occupiedFrom: stay.arrivalAt!,
      occupiedTo: stay.departureAt!,
      unitsNeeded: quantity,
      nights: stay.nights!,
      checkInAt: stay.arrivalAt!,
      checkOutAt: stay.departureAt!
    };
  }

  const offerings = (await tx`
    SELECT duration_seconds, setup_seconds, cleanup_seconds
    FROM awcms_booking_service_offerings
    WHERE tenant_id = ${input.tenantId} AND id = ${input.offeringId}
      AND deleted_at IS NULL AND status = 'active' AND granularity = 'time'
  `) as {
    duration_seconds: number;
    setup_seconds: number;
    cleanup_seconds: number;
  }[];
  const offering = offerings[0];

  if (!offering) {
    return refused("OFFERING_NOT_FOUND");
  }

  const endMs = when.startsAtMs + Number(offering.duration_seconds) * 1000;
  const staff = await resolveStaff(tx, input.tenantId);
  const answered = await answerAvailability(
    tx,
    input.tenantId,
    {
      mode: "slot",
      resourceId: input.resourceId,
      offeringId: input.offeringId,
      quantity,
      fromMs: when.startsAtMs,
      toMs: endMs,
      limit: 1
    },
    staff
  );

  if (answered.outcome !== "ok") {
    return refused(
      answered.outcome === "not_found"
        ? answered.what === "resource"
          ? "RESOURCE_NOT_FOUND"
          : "OFFERING_NOT_FOUND"
        : answered.outcome === "mode_mismatch"
          ? "BOOKING_MODE_MISMATCH"
          : "QUANTITY_EXCEEDS_UNITS"
    );
  }

  const slot =
    answered.answer.mode === "slot" ? answered.answer.slots[0] : null;

  if (!slot || slot.startsAt !== iso(when.startsAtMs)) {
    return refused("SLOT_UNAVAILABLE");
  }

  return {
    ok: true,
    endsAt: iso(endMs),
    occupiedFrom: iso(when.startsAtMs - Number(offering.setup_seconds) * 1000),
    occupiedTo: iso(endMs + Number(offering.cleanup_seconds) * 1000),
    unitsNeeded: quantity
  };
}

async function hold(
  tx: Sql,
  input: BookingHoldInput,
  resolveStaff: StaffResolver
): Promise<BookingOutcome> {
  if (paymentField(input)) {
    return refused("PAYMENT_FIELD_NOT_ACCEPTED");
  }

  const when = whenOf(input);

  if (!when) {
    return refused("VALIDATION_ERROR");
  }

  const claim: PlaceHoldInput = {
    offeringId: input.offeringId,
    ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
    ...(input.poolId === undefined ? {} : { poolId: input.poolId }),
    ...when,
    partySize: input.partySize,
    quantity: input.quantity ?? 1,
    ...(input.holdSeconds === undefined
      ? {}
      : { holdSeconds: input.holdSeconds }),
    externalCustomerRef: input.customerRef ?? null,
    externalRef: input.externalRef ?? null,
    source: "adapter"
  };

  return once(
    tx,
    input.tenantId,
    "booking_port_hold",
    input.idempotencyKey,
    input.actorTenantUserId,
    withoutBookkeeping(input),
    async () => {
      const result = await createReservation(
        tx,
        contextOf(input, await resolveStaff(tx, input.tenantId)),
        { claim, overridePolicy: false },
        false
      );

      if (result.outcome === "ok") {
        return outcomeOf(result.reservation, false);
      }

      if (result.outcome === "invalid") {
        return refused(
          result.errors.some((issue) => issue.code === "STAY_DATES_INVALID")
            ? "STAY_DATES_INVALID"
            : "VALIDATION_ERROR"
        );
      }

      return refused(result.code);
    }
  );
}

async function transition(
  tx: Sql,
  scope: string,
  action: TransitionAction,
  input: {
    tenantId: string;
    reservationId: string;
    idempotencyKey: string;
    correlationId: string;
    actorTenantUserId: string;
  },
  reasonCode: string | null
): Promise<BookingOutcome> {
  return once(
    tx,
    input.tenantId,
    scope,
    input.idempotencyKey,
    input.actorTenantUserId,
    withoutBookkeeping(input),
    async () => {
      const result = await transitionReservation(
        tx,
        // A transition claims nothing: no staff constraint is intended here.
        contextOf(input, NO_OP_STAFF_AVAILABILITY),
        input.reservationId,
        action,
        { reasonCode }
      );

      if (result.outcome === "ok") {
        return outcomeOf(result.reservation, result.replayed);
      }

      return result.outcome === "not_found"
        ? refused("RESERVATION_NOT_FOUND")
        : refused(result.code);
    }
  );
}

/**
 * Builds the port. `resolveStaff` is the composition root's one decision about
 * the staff constraint (`booking/module.ts` `createComposedBookingPort`); pass
 * `async () => NO_OP_STAFF_AVAILABILITY` to say "no constraint" out loud.
 */
export function createBookingPort(resolveStaff: StaffResolver): BookingPort {
  return {
    quote: (tx, input) => quote(tx, input, resolveStaff),
    hold: (tx, input) => hold(tx, input, resolveStaff),
    confirm: (tx, input) =>
      transition(tx, "booking_port_confirm", "confirm", input, null),
    cancel: async (tx, input) =>
      // A short code, never free text (the same rule as the route's body).
      typeof input.reasonCode === "string" &&
      REASON_CODE_PATTERN.test(input.reasonCode)
        ? transition(
            tx,
            "booking_port_cancel",
            "cancel",
            input,
            input.reasonCode
          )
        : refused("VALIDATION_ERROR"),
    reschedule: async (tx, input) => {
      if (paymentField(input)) {
        return refused("PAYMENT_FIELD_NOT_ACCEPTED");
      }

      const when = whenOf(input);

      if (!when) {
        return refused("VALIDATION_ERROR");
      }

      return once(
        tx,
        input.tenantId,
        "booking_port_reschedule",
        input.idempotencyKey,
        input.actorTenantUserId,
        withoutBookkeeping(input),
        async () => {
          const result = await rescheduleReservation(
            tx,
            contextOf(input, await resolveStaff(tx, input.tenantId)),
            input.reservationId,
            {
              ...when,
              ...(input.resourceId === undefined
                ? {}
                : { resourceId: input.resourceId }),
              ...(input.poolId === undefined ? {} : { poolId: input.poolId }),
              overridePolicy: false
            },
            false
          );

          if (result.outcome === "ok") {
            return outcomeOf(result.reservation, result.replayed);
          }

          if (result.outcome === "invalid") {
            return refused("VALIDATION_ERROR");
          }

          return result.outcome === "not_found"
            ? refused("RESERVATION_NOT_FOUND")
            : refused(result.code);
        }
      );
    }
  };
}
