/**
 * Domain-event emission for `booking` (Issue #941, ADR-0131; docs/awcms/booking.md
 * section 7.4). Every call is a plain database write in the caller's OWN
 * transaction (`appendDomainEvent` makes no network call, ADR-0006), which is
 * what makes "a refused or rolled-back call publishes nothing" true by
 * construction, and "a replay publishes nothing" true because a replay never
 * reaches a transition.
 *
 * ## One source for the facts
 *
 * What an event says ABOUT the reservation (number, lineage, interval, resources,
 * offerings, the adapter's opaque reference, stay dates) comes from one database
 * function, `awcms_booking_reservation_event_facts` (`sql/209`), for a request
 * transition, for lazy reclaim and, through the sweep's own function, for the
 * reaper. The transition adds only what it itself knows. So the three producers
 * cannot drift into carrying different facts, and none can carry the customer
 * reference or the note, which the function does not read.
 */
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  BOOKING_EVENT_TYPES,
  BOOKING_EVENT_VERSION,
  BOOKING_RESERVATION_AGGREGATE_TYPE,
  buildReservationEventPayload,
  parseReservationFacts,
  type ReservationEventStatus,
  type ReservationFacts
} from "../domain/booking-reservation-events";
import { BOOKING_MODULE_KEY } from "../domain/booking-permissions";
import type { ReservationEventKind } from "../domain/booking-reservation-state";

type Sql = Bun.SQL;

export type PendingReservationEvent = {
  kind: ReservationEventKind;
  status: ReservationEventStatus;
  previousStatus: "held" | "confirmed" | "checked_in" | null;
  /** RFC 3339 UTC from the database clock. */
  occurredAt: string;
  correlationId?: string | null;
  actorTenantUserId?: string | null;
  lateCancellation?: boolean;
  supersededById?: string;
  rescheduledFromId?: string;
};

/** The database clock as an RFC 3339 UTC instant (the only clock, booking.md section 5.1). */
export async function databaseNowIso(tx: Sql): Promise<string> {
  const rows = (await tx`
    SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now
  `) as { now: string }[];

  return rows[0]!.now;
}

/** The facts of a reservation, or `null` when there is none in this tenant. */
export async function loadReservationFacts(
  tx: Sql,
  tenantId: string,
  reservationId: string
): Promise<ReservationFacts | null> {
  const rows = (await tx`
    SELECT awcms_booking_reservation_event_facts(
             ${tenantId}::uuid, ${reservationId}::uuid) AS facts
  `) as { facts: unknown }[];

  return rows[0]?.facts == null ? null : parseReservationFacts(rows[0].facts);
}

/** Appends one event whose facts the caller already holds (the sweep returns them). */
export async function emitReservationEventFromFacts(
  tx: Sql,
  tenantId: string,
  facts: ReservationFacts,
  event: PendingReservationEvent
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: BOOKING_EVENT_TYPES[event.kind],
    eventVersion: BOOKING_EVENT_VERSION,
    aggregateType: BOOKING_RESERVATION_AGGREGATE_TYPE,
    aggregateId: facts.reservationId,
    correlationId: event.correlationId ?? null,
    producerModule: BOOKING_MODULE_KEY,
    actorTenantUserId: event.actorTenantUserId ?? null,
    payload: buildReservationEventPayload({
      facts,
      status: event.status,
      previousStatus: event.previousStatus,
      occurredAt: event.occurredAt,
      correlationId: event.correlationId ?? null,
      ...(event.lateCancellation === undefined
        ? {}
        : { lateCancellation: event.lateCancellation }),
      ...(event.supersededById === undefined
        ? {}
        : { supersededById: event.supersededById }),
      ...(event.rescheduledFromId === undefined
        ? {}
        : { rescheduledFromId: event.rescheduledFromId })
    })
  });
}

/**
 * Appends `events` for one reservation, in order, reading its facts once. A
 * reservation that cannot be read (it is in no tenant this transaction can see)
 * is a defect, not a refusal: the caller has just written it.
 */
export async function emitReservationEvents(
  tx: Sql,
  tenantId: string,
  reservationId: string,
  events: readonly PendingReservationEvent[]
): Promise<void> {
  const facts = await loadReservationFacts(tx, tenantId, reservationId);

  if (!facts) {
    throw new Error(
      "booking: cannot publish an event for a reservation it cannot read"
    );
  }

  for (const event of events) {
    await emitReservationEventFromFacts(tx, tenantId, facts, event);
  }
}
