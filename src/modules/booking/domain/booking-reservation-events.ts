/**
 * `booking` domain events (Issue #941, ADR-0131; docs/awcms/booking.md section
 * 7.4, docs/awcms/cross-domain-contracts.md section 7).
 *
 * The nine reservation events, their payload and the pure function that builds
 * it. No imports from the module's application layer, so the producer, the
 * `domain_event_runtime` registry and the AsyncAPI parity gate reference the same
 * literals.
 *
 * ## What an event carries
 *
 * Ids, enums, counts, the dates of a stay and UTC instants. **Never** a customer
 * name, contact, reference or note, a reason text, an actor in the payload (the envelope carries `actorTenantUserId`), or an amount: there
 * is no price and no payment state anywhere in this module (booking.md section
 * 3). `externalRefType` / `externalRef` are the ADAPTER's own opaque pair, which
 * it minted and needs back to correlate (an order id); they are carried because
 * without them a consumer cannot find its own order, and they never hold a
 * person (a person is `external_customer_ref`, which no event carries).
 *
 * The facts about the reservation come from ONE database function
 * (`awcms_booking_reservation_event_facts`, `sql/209`), so a transition, the
 * lazy reclaim and the sweep cannot carry different things; this file adds only
 * what the transition itself knows (status, previous status, the instant).
 */
import type { ReservationEventKind } from "./booking-reservation-state";

export const BOOKING_EVENT_VERSION = "1.0";
export const BOOKING_RESERVATION_AGGREGATE_TYPE = "reservation";

export const BOOKING_EVENT_TYPES: Readonly<
  Record<ReservationEventKind, string>
> = {
  created: "awcms.booking.reservation.created",
  held: "awcms.booking.reservation.held",
  confirmed: "awcms.booking.reservation.confirmed",
  rescheduled: "awcms.booking.reservation.rescheduled",
  cancelled: "awcms.booking.reservation.cancelled",
  checked_in: "awcms.booking.reservation.checked_in",
  completed: "awcms.booking.reservation.completed",
  no_show: "awcms.booking.reservation.no_show",
  expired: "awcms.booking.reservation.expired"
};

export type StayFact = {
  resourceId: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  timezone: string;
};

/** What `awcms_booking_reservation_event_facts` returns (camelCase keys, UTC instants). */
export type ReservationFacts = {
  reservationId: string;
  reservationNo: string;
  lineageId: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  externalRefType: string | null;
  externalRef: string | null;
  resourceIds: string[];
  offeringIds: string[];
  stays: StayFact[];
};

export type ReservationEventStatus =
  | "held"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "cancelled"
  | "rescheduled"
  | "no_show"
  | "expired";

export type ReservationEventInput = {
  facts: ReservationFacts;
  /** The reservation's status AFTER the transition. */
  status: ReservationEventStatus;
  /** Its status before; `null` for the events of a creation. */
  previousStatus: "held" | "confirmed" | "checked_in" | null;
  /** RFC 3339 UTC, from the DATABASE clock. */
  occurredAt: string;
  correlationId?: string | null;
  /** `cancelled` only. */
  lateCancellation?: boolean;
  /** `rescheduled` only: the replacement's id. */
  supersededById?: string;
  /** The events of a replacement reservation: the id it replaced. */
  rescheduledFromId?: string;
};

/** The closed payload of a reservation event (the AsyncAPI `BookingReservationPayload`, additionalProperties false). */
export function buildReservationEventPayload(
  input: ReservationEventInput
): Record<string, unknown> {
  const { facts } = input;

  return {
    reservationId: facts.reservationId,
    reservationNo: facts.reservationNo,
    lineageId: facts.lineageId,
    status: input.status,
    previousStatus: input.previousStatus,
    startsAt: facts.startsAt,
    endsAt: facts.endsAt,
    resourceIds: facts.resourceIds,
    offeringIds: facts.offeringIds,
    partySize: facts.partySize,
    externalRefType: facts.externalRefType,
    externalRef: facts.externalRef,
    ...(input.lateCancellation === undefined
      ? {}
      : { lateCancellation: input.lateCancellation }),
    ...(input.supersededById === undefined
      ? {}
      : { supersededById: input.supersededById }),
    ...(input.rescheduledFromId === undefined
      ? {}
      : { rescheduledFromId: input.rescheduledFromId }),
    // Additive, absent unless the reservation holds a stay (booking.md section 3.1).
    ...(facts.stays.length > 0 ? { stays: facts.stays } : {}),
    occurredAt: input.occurredAt,
    ...(input.correlationId ? { correlationId: input.correlationId } : {})
  };
}

/** Parses the jsonb the facts function returned. A defect, not a refusal, if it is malformed. */
export function parseReservationFacts(raw: unknown): ReservationFacts {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (typeof value !== "object" || value === null) {
    throw new Error("booking: reservation event facts are missing");
  }

  const facts = value as ReservationFacts;

  if (
    typeof facts.reservationId !== "string" ||
    !Array.isArray(facts.resourceIds)
  ) {
    throw new Error("booking: reservation event facts are malformed");
  }

  return facts;
}
