/**
 * `BookingPort` -- claim, confirm, cancel and move capacity (Issue #941,
 * ADR-0131, ADR-0011; contract: `docs/awcms/cross-domain-contracts.md` section 3
 * and `docs/awcms/booking.md` section 10.1).
 *
 * A consumer that sells or schedules capacity (a commerce adapter turning a hold
 * into an order and a payment into a confirm, a portal or kiosk route in this
 * repository) depends on THIS type, never on `booking`'s `application/` or
 * `domain/` code or its tables. It lives in neutral ground (`_shared`, importing
 * nothing from any module) for the reason every sibling port documents: a
 * consumer that imported the booking code would depend on its internals and,
 * the day booking needs something from the consumer, complete a cycle the
 * boundary gate forbids. `booking` itself has no `commerce` dependency
 * (booking.md section 10.2).
 *
 * ## The caller authorizes; the port does not
 *
 * The port performs NO access check. It is a typed seam over the module's
 * application layer, and a typed seam is not a chokepoint: the consumer's route
 * or job MUST authorize the actor against ITS OWN permission before calling
 * (as `InventoryLedgerPort` and the other ports document), and passes the actor
 * for the stamps. The module audits its own state changes inside the adapter,
 * and publishes its own domain events in the same transaction.
 *
 * ## Refusals are values
 *
 * A business refusal (`SLOT_UNAVAILABLE`, `HOLD_EXPIRED`, `INVALID_STATE`, ...)
 * is RETURNED as `{ ok: false, reason }`, never thrown; a port throws only for
 * defects. A caller must not turn a returned refusal into a thrown error inside
 * its own transaction without a savepoint, and must not return a 4xx from inside
 * `withTenant` after writing (that COMMITS the write, booking.md section 5.2).
 * A refusal writes nothing the caller has to undo, except that an elapsed hold on
 * the units asked for may have been expired on the way (a true fact).
 *
 * ## Idempotency
 *
 * `hold`, `confirm`, `cancel` and `reschedule` take an `idempotencyKey`. A replay
 * of the same key with the same request returns the original outcome with
 * `replayed: true` and writes nothing; the same key with a different request is
 * `IDEMPOTENCY_CONFLICT`. Asking for the state a reservation is already in
 * (confirming a confirmed one) is `replayed: true` too, whatever the key. The
 * natural key `(tenant, externalRef.type, externalRef.id)` lets an adapter retry a
 * `hold` with a FRESH key without duplicating a live reservation
 * (`EXTERNAL_REF_IN_USE`). The exclusion constraint backstops both layers.
 *
 * ## What the port deliberately does not carry
 *
 * Price, deposit, payment status, customer name or contact, free-text notes.
 * Payment is the adapter's: it decides WHEN to ask for a `confirm`. An input that
 * names a payment field is `PAYMENT_FIELD_NOT_ACCEPTED`. The customer is the
 * opaque `customerRef` of the commerce authority (booking.md section 4, O12),
 * never a name.
 *
 * ## Time
 *
 * Every instant is an RFC 3339 UTC string ending in `Z`; every interval is
 * half-open `[start, end)`. A slot is asked with `startsAt`; a nightly stay with
 * two LOCAL dates in the resource's zone (`stay`), because a night is a calendar
 * concept (ADR-0135). A `quote` is not a promise: only a `hold` or a `confirm` is.
 */

export type BookingInstant = string;

/** The final refusal union (the sketch of cross-domain-contracts section 3, completed by what the claim can say). */
export type BookingRefusal =
  | "SLOT_UNAVAILABLE"
  | "OUTSIDE_SCHEDULE"
  | "LEAD_TIME_VIOLATION"
  | "HORIZON_EXCEEDED"
  | "PARTY_SIZE_OUT_OF_RANGE"
  | "QUANTITY_EXCEEDS_UNITS"
  | "BOOKING_MODE_MISMATCH"
  | "MIN_STAY_VIOLATION"
  | "MAX_STAY_EXCEEDED"
  | "STAY_DATES_INVALID"
  | "STAY_POOL_INCONSISTENT"
  | "STAFF_UNAVAILABLE"
  | "HOLD_EXPIRED"
  | "HOLD_LIMIT_EXCEEDED"
  | "CONTENTION_RETRY"
  | "EXTERNAL_REF_IN_USE"
  | "RESOURCE_NOT_FOUND"
  | "OFFERING_NOT_FOUND"
  | "RESERVATION_NOT_FOUND"
  | "RESOURCE_REQUIRED"
  | "INVALID_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYMENT_FIELD_NOT_ACCEPTED"
  | "VALIDATION_ERROR";

/** Exactly one of `startsAt` (a slot) and `stay` (a night range) is sent. */
export type BookingWhen =
  | { startsAt: BookingInstant; stay?: undefined }
  | {
      startsAt?: undefined;
      /** Local `YYYY-MM-DD` dates in the resource's time zone; check-out is exclusive. */
      stay: { checkInDate: string; checkOutDate: string };
    };

export type BookingQuoteInput = BookingWhen & {
  tenantId: string;
  offeringId: string;
  /** A quote asks one resource; a hold may ask a pool instead (`poolId`). */
  resourceId: string;
  partySize: number;
  /** Units claimed at once, all-or-none; default 1. */
  quantity?: number;
  /** Opaque; resolved only by the staff-availability port (not consulted yet). */
  staffRef?: string;
  correlationId: string;
};

export type BookingQuoteResult =
  | {
      ok: true;
      /** A slot's service end; for a stay the derived departure instant. */
      endsAt: BookingInstant;
      /** What the exclusion constraint tests: the service interval widened by the buffers. Equal to the interval for a stay. */
      occupiedFrom: BookingInstant;
      occupiedTo: BookingInstant;
      unitsNeeded: number;
      /** Stays only. */
      nights?: number;
      checkInAt?: BookingInstant;
      checkOutAt?: BookingInstant;
    }
  | { ok: false; reason: BookingRefusal };

export type BookingHoldInput = BookingWhen & {
  tenantId: string;
  offeringId: string;
  /** Exactly one of `resourceId` and `poolId`. */
  resourceId?: string;
  poolId?: string;
  partySize: number;
  quantity?: number;
  staffRef?: string;
  /** Opaque token of the commerce authority; never a name or a contact. */
  customerRef?: string;
  /** Clamped by the module to `[60, max_hold_seconds]`. */
  holdSeconds?: number;
  /** The adapter's own order reference. */
  externalRef?: { type: string; id: string };
  idempotencyKey: string;
  correlationId: string;
  /**
   * The acting tenant user, for the stamps, the audit row and the idempotency
   * namespace (ADR-0145). REQUIRED: a caller without a user (a system job) must
   * pass its own service-account tenant user, never an anonymous placeholder.
   */
  actorTenantUserId: string;
};

export type BookingOutcome =
  | {
      ok: true;
      reservationId: string;
      status: string;
      holdExpiresAt: BookingInstant | null;
      replayed: boolean;
    }
  | { ok: false; reason: BookingRefusal };

type Targeted = {
  tenantId: string;
  reservationId: string;
  idempotencyKey: string;
  correlationId: string;
  actorTenantUserId: string;
};

export interface BookingPort {
  /** Non-binding. Writes nothing. A quote is not a promise. */
  quote(tx: Bun.SQL, input: BookingQuoteInput): Promise<BookingQuoteResult>;

  /** Claims the capacity as a hold (or confirmed when the offering is `immediate`). */
  hold(tx: Bun.SQL, input: BookingHoldInput): Promise<BookingOutcome>;

  /** held -> confirmed. Re-checks the hold has not expired under the row lock. */
  confirm(tx: Bun.SQL, input: Targeted): Promise<BookingOutcome>;

  /** held | confirmed -> cancelled. The module records `lateCancellation`; any fee is the adapter's decision. */
  cancel(
    tx: Bun.SQL,
    input: Targeted & { reasonCode: string }
  ): Promise<BookingOutcome>;

  /**
   * One transaction: release the old allocations, insert the replacement under
   * the same lineage, supersede the old. A refusal rolls back to the untouched
   * original. `reservationId` in the outcome is the REPLACEMENT's.
   */
  reschedule(
    tx: Bun.SQL,
    input: Targeted &
      BookingWhen & {
        /** Move elsewhere; absent = where the reservation is. */
        resourceId?: string;
        poolId?: string;
      }
  ): Promise<BookingOutcome>;
}
