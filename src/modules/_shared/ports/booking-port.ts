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
 * `hold`, `confirm`, `cancel`, `reschedule`, `checkIn`, `checkOut` and
 * `markNoShow` take an `idempotencyKey`. A replay
 * of the same key with the same request returns the original outcome with
 * `replayed: true` and writes nothing; the same key with a different request is
 * `IDEMPOTENCY_CONFLICT`. Asking for the state a reservation is already in
 * (confirming a confirmed one) is `replayed: true` too, whatever the key. The
 * natural key `(tenant, externalRef.type, externalRef.id)` lets an adapter retry a
 * `hold` with a FRESH key without duplicating a live reservation
 * (`EXTERNAL_REF_IN_USE`). The exclusion constraint backstops both layers.
 *
 * ## Reads (contract 1.1.0)
 *
 * `get`, `getOffering`, `listOfferings` and `availability` are reads: they take
 * no idempotency key and write nothing. A reservation read carries NO customer
 * or contact data, not even the opaque `customerRef` (the consumer that placed
 * the hold already knows whom it held for; a read must not be a way to learn it
 * for a reservation the consumer did not place). Not found is a VALUE
 * (`RESERVATION_NOT_FOUND` / `OFFERING_NOT_FOUND`), the same neutral answer for
 * an unknown id and another tenant's. `availability` needs no actor and returns
 * counts and slots only; the caller still supplies the `tenantId` its own
 * transaction is scoped to (RLS FORCE applies, and every query also names the
 * tenant).
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
  | "CHECK_IN_TOO_EARLY"
  | "NO_SHOW_TOO_EARLY"
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

/** What `get` finds. Exactly one of `reservationId` and `reservationNo`. */
export type BookingGetInput =
  | { tenantId: string; reservationId: string; reservationNo?: undefined }
  | { tenantId: string; reservationNo: string; reservationId?: undefined };

export type BookingStayRecord = {
  offeringId: string;
  /** Local `YYYY-MM-DD` dates in `timezone`; check-out is exclusive. */
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  timezone: string;
};

/**
 * A reservation as the port reads it. Deliberately without `customerRef`, party
 * size, notes, cancel reason or actor: a read of the schedule, not of a person.
 */
export type BookingReservationRecord = {
  reservationId: string;
  reservationNo: string;
  status: string;
  startsAt: BookingInstant;
  endsAt: BookingInstant;
  holdExpiresAt: BookingInstant | null;
  lineageId: string;
  /** The replacement a reschedule made; the reservation is then `rescheduled`. */
  supersededById: string | null;
  /** One entry per stay item; empty for a slot reservation. */
  stays: BookingStayRecord[];
  /** The adapter's own order reference, as it was given to `hold`. */
  externalRef: { type: string; id: string } | null;
};

export type BookingGetResult =
  | { ok: true; reservation: BookingReservationRecord }
  | { ok: false; reason: BookingRefusal };

export type BookingOfferingRecord = {
  offeringId: string;
  code: string;
  name: string;
  granularity: "time" | "stay";
  confirmationMode: "immediate" | "hold_then_confirm";
  status: "active" | "inactive";
  minParty: number;
  maxParty: number;
  /** Time offerings only; `null` for a stay. */
  durationSeconds: number | null;
  /** Stay offerings only; `null` for a time offering. */
  minNights: number | null;
  maxNights: number | null;
};

export type BookingOfferingResult =
  | { ok: true; offering: BookingOfferingRecord }
  | { ok: false; reason: BookingRefusal };

export type BookingListOfferingsInput = {
  tenantId: string;
  /** The previous page's `nextCursor`; absent or `null` is the first page. */
  cursor?: string | null;
  /** 1..100; default 50. */
  limit?: number;
  status?: "active" | "inactive";
};

export type BookingOfferingPageResult =
  | { ok: true; offerings: BookingOfferingRecord[]; nextCursor: string | null }
  | { ok: false; reason: BookingRefusal };

/**
 * An offering plus a window on one resource (the offering does not fix a
 * resource; the caller's page already knows which one it sells). A slot
 * resource is asked with `from`/`to` (at most 31 days); a stay resource with two
 * local dates.
 */
export type BookingAvailabilityInput = {
  tenantId: string;
  offeringId: string;
  resourceId: string;
  /** Units wanted at once; default 1. */
  quantity?: number;
} & (
  | {
      from: BookingInstant;
      to: BookingInstant;
      /** 1..500; default 100. */
      limit?: number;
      stay?: undefined;
    }
  | {
      from?: undefined;
      to?: undefined;
      limit?: undefined;
      stay: { checkInDate: string; checkOutDate: string };
    }
);

export type BookingAvailabilityResult =
  | {
      ok: true;
      mode: "slot";
      timezone: string;
      from: BookingInstant;
      to: BookingInstant;
      slots: {
        startsAt: BookingInstant;
        endsAt: BookingInstant;
        freeUnits: number;
      }[];
      /** More slots exist than `limit` (or the evaluation bound) returned. */
      truncated: boolean;
    }
  | {
      ok: true;
      mode: "stay";
      timezone: string;
      checkInDate: string;
      checkOutDate: string;
      nights: number | null;
      /** Units free on every night of the range (0 when not available). */
      freeUnits: number;
      available: boolean;
      /** Set when `available` is false; the same union a `quote` refuses with. */
      reason?: BookingRefusal;
    }
  | { ok: false; reason: BookingRefusal };

export type Targeted = {
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

  /**
   * confirmed -> checked_in. A stay cannot be checked in before its check-in
   * DATE in the resource's zone (`CHECK_IN_TOO_EARLY`); there is no time-of-day
   * check. Asking for a reservation that is already checked in is `replayed: true`.
   */
  checkIn(tx: Bun.SQL, input: Targeted): Promise<BookingOutcome>;

  /** checked_in -> completed (the module's `complete` transition). */
  checkOut(tx: Bun.SQL, input: Targeted): Promise<BookingOutcome>;

  /**
   * confirmed -> no_show, allowed only after the start plus the tenant's grace
   * (`NO_SHOW_TOO_EARLY` before). The slot stays consumed. Whether the actor may
   * mark a no-show (the HTTP route restricts it to staff) is the CALLER's check.
   */
  markNoShow(tx: Bun.SQL, input: Targeted): Promise<BookingOutcome>;

  /**
   * One reservation, by id or by its human number. No customer, contact or note
   * data. A reservation that does not exist for the tenant is
   * `RESERVATION_NOT_FOUND`.
   *
   * SECURITY: this is an UNAUTHENTICATED lookup (no actor, no ABAC check; the
   * caller authorizes). `reservationNo` is a human-shaped number: a consumer must
   * NEVER expose this read publicly by number, or it becomes an enumeration
   * oracle for the tenant's bookings (schedule and state).
   */
  get(tx: Bun.SQL, input: BookingGetInput): Promise<BookingGetResult>;

  /** One offering of the tenant (not a deleted one). */
  getOffering(
    tx: Bun.SQL,
    input: { tenantId: string; offeringId: string }
  ): Promise<BookingOfferingResult>;

  /**
   * The tenant's offerings (not deleted ones), newest first, keyset paged. Pass
   * the previous page's `nextCursor` to continue; `null` means the end.
   */
  listOfferings(
    tx: Bun.SQL,
    input: BookingListOfferingsInput
  ): Promise<BookingOfferingPageResult>;

  /**
   * Availability for one offering on one resource over a window, for a public
   * booking page. Needs NO actor and returns slots or a stay's free-unit count
   * only. Writes nothing; a result is not a promise (only `hold` is).
   *
   * Anonymous means it reveals nothing of the tenant's policy or size: an
   * unavailable stay is always `available: false`, `nights: null`,
   * `reason: SLOT_UNAVAILABLE` (never a min/max-stay, lead-time, horizon or
   * schedule code), and an over-capacity `quantity` or an unknown `resourceId`
   * is the same "no availability" answer as a fully-booked window (empty
   * `slots`). Every answer without free capacity carries `timezone: "UTC"`.
   *
   * SECURITY: by design it takes NO actor and does NO ABAC check. Any consumer
   * route exposing it MUST rate-limit and cache-bound it itself; the port bounds
   * only one call (31-day window, 500 slots).
   */
  availability(
    tx: Bun.SQL,
    input: BookingAvailabilityInput
  ): Promise<BookingAvailabilityResult>;
}
