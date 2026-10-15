/**
 * The reservation transitions of `booking` (Issue #941, ADR-0131; docs/awcms/
 * booking.md sections 3, 5 and 7.4): create, confirm, cancel, reschedule, check
 * in, complete (check out) and no-show. The application layer the routes call,
 * and the one the `BookingPort` adapter calls (`booking-port-adapter.ts`).
 *
 * ## Every transition, in the same transaction
 *
 *   1. lock the reservation `FOR UPDATE` (the one row every writer of that
 *      reservation serialises on: a confirm racing the sweep, two cancels, a
 *      cancel racing a reschedule), and read the DATABASE clock in the same
 *      statement;
 *   2. decide with the pure state machine (`evaluateTransition`) and the policy
 *      that is specific to the verb, and REFUSE as a value before writing
 *      anything: `withTenant` commits a returned 4xx, so a refusal that came
 *      after a write would commit the write (booking.md section 5.2);
 *   3. write the reservation, release its allocations where the verb says so,
 *      append exactly ONE history row (booking.md section 13), write one audit
 *      row, and append the domain event to the outbox.
 *
 * The `confirmed -> ...` triggers of `sql/180` enforce the same table a second
 * time, so a bug here fails with a trigger error and never commits an illegal
 * transition.
 *
 * ## The second idempotency layer is the state check (booking.md section 5.2)
 *
 * Asking for the state a reservation is already in -- confirming a confirmed one,
 * cancelling a cancelled one -- returns it with `replayed: true` and writes
 * NOTHING (no history row, no audit row, no event), whichever `Idempotency-Key`
 * (or a fresh one) it arrives with. The first layer (the stored response) and the
 * third (the exclusion constraint and the external-reference unique index) are
 * not this file's.
 *
 * ## What a refusal says
 *
 * An unknown id, another tenant's id and a soft-hidden one are the same
 * `not_found`; the route turns it into one neutral 404. Codes follow booking.md
 * section 3: `INVALID_STATE`, `HOLD_EXPIRED` (also for a hold the sweep already
 * expired: a payment observed after expiry learns it was too late), the policy
 * codes, and the verb-specific `NO_SHOW_TOO_EARLY` and `CHECK_IN_TOO_EARLY`.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  PLACEMENT_REFUSALS,
  validatePlaceHold,
  type PlaceHoldInput,
  type ValidationIssue
} from "../domain/booking-allocation";
import { BOOKING_AUDIT_EVENTS } from "../domain/booking-audit";
import { BOOKING_MODULE_KEY } from "../domain/booking-permissions";
import {
  POLICY_DEFAULTS,
  POLICY_REFUSALS,
  isLateCancellation,
  noShowEarliestMs,
  type PolicyReason,
  type PolicyRefusalCode
} from "../domain/booking-policy";
import {
  evaluateTransition,
  type ReservationAction,
  type ReservationStatus
} from "../domain/booking-reservation-state";
import type {
  CreateReservationRequest,
  RescheduleRequest
} from "../domain/booking-reservation-validation";
import { localDateOf } from "../domain/booking-time";
import { asUuid } from "../domain/booking-validation";
import { databaseNowIso, emitReservationEvents } from "./booking-event-emit";
import { placeHold, type PlaceHoldContext } from "./booking-hold-service";
import { evaluateClaimPolicy } from "./booking-reservation-policy";
import {
  getReservation,
  type ReservationView
} from "./booking-reservation-directory";

type Sql = Bun.SQL;

export type ReservationContext = PlaceHoldContext;

/** The verbs that move one reservation in place. `reschedule` replaces it and has its own function. */
export type TransitionAction =
  "confirm" | "cancel" | "check_in" | "complete" | "no_show";

/** The refusals only this file can make, beyond the state machine's and the claim's. */
export const RESERVATION_REFUSALS = {
  INVALID_STATE: 409,
  HOLD_EXPIRED: 409,
  NO_SHOW_TOO_EARLY: 409,
  CHECK_IN_TOO_EARLY: 409,
  RESOURCE_REQUIRED: 400,
  ...POLICY_REFUSALS,
  ...PLACEMENT_REFUSALS
} as const;

export type ReservationRefusalCode = keyof typeof RESERVATION_REFUSALS;

export type ServiceRefusal = {
  outcome: "refused";
  code: ReservationRefusalCode;
  message: string;
  httpStatus: number;
};

export type CreateReservationOutcome =
  | {
      outcome: "ok";
      reservation: ReservationView;
      /** The policy rules `reservations.override` lifted for this call; empty when none needed lifting. */
      policyLifted: PolicyRefusalCode[];
    }
  | ServiceRefusal
  | { outcome: "invalid"; errors: ValidationIssue[] };

export type TransitionOutcome =
  | { outcome: "ok"; reservation: ReservationView; replayed: boolean }
  | { outcome: "not_found" }
  | ServiceRefusal;

export type RescheduleOutcome =
  | {
      outcome: "ok";
      /** The replacement. */
      reservation: ReservationView;
      /** The superseded reservation, now `rescheduled`. */
      previous: ReservationView;
      replayed: boolean;
      policyLifted: PolicyRefusalCode[];
    }
  | { outcome: "not_found" }
  | ServiceRefusal
  | { outcome: "invalid"; errors: ValidationIssue[] };

function refuse(code: ReservationRefusalCode, message: string): ServiceRefusal {
  return {
    outcome: "refused",
    code,
    message,
    httpStatus: RESERVATION_REFUSALS[code]
  };
}

function policyRefusal(reason: PolicyReason): ServiceRefusal {
  return refuse(reason.code, reason.detail);
}

async function auditOverride(
  tx: Sql,
  ctx: ReservationContext,
  reservationId: string,
  reservationNo: string,
  lifted: readonly PolicyRefusalCode[],
  verb: "create" | "reschedule"
): Promise<void> {
  await recordAuditEvent(tx, {
    tenantId: ctx.tenantId,
    ...(ctx.actorTenantUserId
      ? { actorTenantUserId: ctx.actorTenantUserId }
      : {}),
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.reservationOverridden.action,
    resourceType: "booking_reservation",
    resourceId: reservationId,
    severity: BOOKING_AUDIT_EVENTS.reservationOverridden.severity,
    message: `Reservation ${reservationNo} was ${verb === "create" ? "created" : "rescheduled"} outside the booking policy by an override.`,
    // Which rules were lifted, as codes. Never a customer or a reason text.
    attributes: { verb, liftedRules: [...lifted] },
    ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * `POST /reservations`: policy first (so a refusal costs no write), then the
 * claim. `liftPolicy` is true only when the CALLER asked to override AND the
 * route has already authorised `reservations.override` for this request; it lifts
 * hours, lead time and horizon and nothing else, and an allocation conflict is
 * `SLOT_UNAVAILABLE` whatever it says.
 */
export async function createReservation(
  tx: Sql,
  ctx: ReservationContext,
  request: CreateReservationRequest,
  liftPolicy: boolean
): Promise<CreateReservationOutcome> {
  const issues = validatePlaceHold(request.claim);

  if (issues.length > 0) {
    return { outcome: "invalid", errors: issues };
  }

  const claim = request.claim;
  const reasons = await evaluateClaimPolicy(tx, ctx.tenantId, {
    offeringId: claim.offeringId,
    ...(claim.resourceId === undefined ? {} : { resourceId: claim.resourceId }),
    ...(claim.poolId === undefined ? {} : { poolId: claim.poolId }),
    ...(claim.startsAtMs === undefined ? {} : { startsAtMs: claim.startsAtMs }),
    ...(claim.stay === undefined ? {} : { stay: claim.stay })
  });

  if (reasons.length > 0 && !liftPolicy) {
    return policyRefusal(reasons[0]!);
  }

  const placed = await placeHold(tx, ctx, claim);

  if (placed.outcome === "invalid") {
    return placed;
  }

  if (placed.outcome === "refused") {
    return refuse(placed.code, placed.message);
  }

  const lifted = [...new Set(reasons.map((reason) => reason.code))];

  if (lifted.length > 0) {
    await auditOverride(
      tx,
      ctx,
      placed.reservation.reservationId,
      placed.reservation.reservationNo,
      lifted,
      "create"
    );
  }

  const reservation = await getReservation(
    tx,
    ctx.tenantId,
    placed.reservation.reservationId
  );

  if (!reservation) {
    throw new Error("booking: a reservation just created cannot be read");
  }

  return { outcome: "ok", reservation, policyLifted: lifted };
}

// ---------------------------------------------------------------------------
// In-place transitions
// ---------------------------------------------------------------------------

type LockedReservation = {
  id: string;
  status: ReservationStatus;
  hold_expires_at: Date | null;
  hold_elapsed: boolean | null;
  starts_at_ms: number;
  now_ms: number;
  superseded_by_id: string | null;
};

/**
 * Locks one reservation, THEN reads the database clock in a second statement.
 * Reading both in the one `SELECT ... FOR UPDATE` would evaluate the clock
 * before the lock wait: a confirm that queued behind the sweep (or behind
 * another writer) would judge "elapsed" by a moment BEFORE it got the row, and
 * could pass the application check only to be refused by the `held -> confirmed`
 * trigger (a 500) when the hold elapsed during the wait. The clock read after the
 * lock is the same instant the trigger will judge.
 */
async function lockReservation(
  tx: Sql,
  tenantId: string,
  reservationId: string
): Promise<LockedReservation | null> {
  const locked = (await tx`
    SELECT r.id FROM awcms_booking_reservations r
    WHERE r.tenant_id = ${tenantId} AND r.id = ${reservationId}
    FOR UPDATE OF r
  `) as { id: string }[];

  if (locked.length === 0) {
    return null;
  }

  const rows = (await tx`
    SELECT r.id, r.status, r.hold_expires_at,
           (r.hold_expires_at <= clock_timestamp()) AS hold_elapsed,
           (extract(epoch FROM r.starts_at) * 1000)::float8 AS starts_at_ms,
           (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms,
           r.superseded_by_id
    FROM awcms_booking_reservations r
    WHERE r.tenant_id = ${tenantId} AND r.id = ${reservationId}
  `) as LockedReservation[];

  return rows[0] ?? null;
}

/**
 * Is this the `sql/180` guard trigger refusing an elapsed hold? Matches the
 * SQLSTATE (55000, object_not_in_prerequisite_state) AND the `HOLD_EXPIRED` tag
 * the trigger puts in its message, so the module's other 55000 refusals (a
 * shortened hold, an illegal transition) are never mistaken for it.
 */
function isHoldExpiredTrigger(error: unknown): boolean {
  return (
    error instanceof Bun.SQL.PostgresError &&
    String(error.errno) === "55000" &&
    /awcms_booking: HOLD_EXPIRED:/.test(error.message)
  );
}

/** The state each verb leaves a reservation in: asking for it again is a replay. */
const TARGET_STATUS: Readonly<Record<TransitionAction, ReservationStatus>> = {
  confirm: "confirmed",
  cancel: "cancelled",
  check_in: "checked_in",
  complete: "completed",
  no_show: "no_show"
};

const AUDIT_FOR: Readonly<
  Record<
    TransitionAction,
    (typeof BOOKING_AUDIT_EVENTS)[keyof typeof BOOKING_AUDIT_EVENTS]
  >
> = {
  confirm: BOOKING_AUDIT_EVENTS.reservationConfirmed,
  cancel: BOOKING_AUDIT_EVENTS.reservationCancelled,
  check_in: BOOKING_AUDIT_EVENTS.reservationCheckedIn,
  complete: BOOKING_AUDIT_EVENTS.reservationCompleted,
  no_show: BOOKING_AUDIT_EVENTS.reservationNoShow
};

async function readSettingsGrace(tx: Sql, tenantId: string): Promise<number> {
  const rows = (await tx`
    SELECT no_show_grace_seconds FROM awcms_booking_settings
    WHERE tenant_id = ${tenantId}
  `) as { no_show_grace_seconds: number | null }[];

  return rows[0]?.no_show_grace_seconds ?? POLICY_DEFAULTS.noShowGraceSeconds;
}

/** The latest cancellation cutoff of the reservation's offerings (the most restrictive), or `null` when none defines one. */
async function readCancellationCutoff(
  tx: Sql,
  tenantId: string,
  reservationId: string
): Promise<number | null> {
  const rows = (await tx`
    SELECT max(o.cancellation_cutoff_seconds) AS cutoff
    FROM awcms_booking_reservation_items i
    JOIN awcms_booking_service_offerings o
      ON o.tenant_id = i.tenant_id AND o.id = i.offering_id
    WHERE i.tenant_id = ${tenantId} AND i.reservation_id = ${reservationId}
  `) as { cutoff: number | null }[];

  return rows[0]?.cutoff == null ? null : Number(rows[0].cutoff);
}

/** The earliest stay item's check-in date and zone, or `null` for a reservation of slots only. */
async function readStayArrival(
  tx: Sql,
  tenantId: string,
  reservationId: string
): Promise<{ checkInDate: string; timezone: string } | null> {
  const rows = (await tx`
    SELECT to_char(check_in_date, 'YYYY-MM-DD') AS check_in_date, timezone
    FROM awcms_booking_reservation_items
    WHERE tenant_id = ${tenantId} AND reservation_id = ${reservationId}
      AND granularity = 'stay'
    ORDER BY check_in_date
    LIMIT 1
  `) as { check_in_date: string; timezone: string }[];

  return rows[0]
    ? { checkInDate: rows[0].check_in_date, timezone: rows[0].timezone }
    : null;
}

async function viewOf(
  tx: Sql,
  tenantId: string,
  reservationId: string
): Promise<ReservationView> {
  const view = await getReservation(tx, tenantId, reservationId);

  if (!view) {
    throw new Error("booking: a reservation just written cannot be read");
  }

  return view;
}

/**
 * `confirm`, `cancel`, `check_in`, `complete` and `no_show` on one reservation.
 * `input.reasonCode` is a cancellation's short code (never free text).
 */
export async function transitionReservation(
  tx: Sql,
  ctx: ReservationContext,
  reservationId: string,
  action: TransitionAction,
  input: { reasonCode?: string | null } = {}
): Promise<TransitionOutcome> {
  const row = await lockReservation(tx, ctx.tenantId, reservationId);

  if (!row) {
    return { outcome: "not_found" };
  }

  // Layer 2 of the three idempotency layers: already there, write nothing.
  if (row.status === TARGET_STATUS[action]) {
    return {
      outcome: "ok",
      reservation: await viewOf(tx, ctx.tenantId, row.id),
      replayed: true
    };
  }

  // A payment observed after the sweep expired the hold is "too late", the same
  // answer as a hold that has elapsed but not yet been swept.
  if (action === "confirm" && row.status === "expired") {
    return refuse("HOLD_EXPIRED", "The hold has expired.");
  }

  const nowMs = Math.floor(Number(row.now_ms));
  const decision = evaluateTransition({
    from: row.status,
    action: action as ReservationAction,
    now: new Date(nowMs),
    holdExpiresAt: row.hold_expires_at ? new Date(row.hold_expires_at) : null,
    ...(row.hold_elapsed === null ? {} : { holdElapsed: row.hold_elapsed })
  });

  if (!decision.ok) {
    return refuse(decision.code, decision.message);
  }

  if (action === "no_show") {
    const grace = await readSettingsGrace(tx, ctx.tenantId);

    if (nowMs < noShowEarliestMs(Math.floor(Number(row.starts_at_ms)), grace)) {
      return refuse(
        "NO_SHOW_TOO_EARLY",
        "A no-show can be marked only after the start time plus the grace period."
      );
    }
  }

  if (action === "check_in") {
    const arrival = await readStayArrival(tx, ctx.tenantId, row.id);

    // A stay is checked in from its check-in DATE in the resource's zone. There
    // is deliberately no time-of-day check: an early arrival is a front-desk
    // decision (booking.md section 3.1).
    if (arrival && localDateOf(arrival.timezone, nowMs) < arrival.checkInDate) {
      return refuse(
        "CHECK_IN_TOO_EARLY",
        `A stay cannot be checked in before ${arrival.checkInDate}.`
      );
    }
  }

  const lateCancellation =
    action === "cancel"
      ? isLateCancellation({
          nowMs,
          startsAtMs: Math.floor(Number(row.starts_at_ms)),
          cutoffSeconds: await readCancellationCutoff(tx, ctx.tenantId, row.id)
        })
      : false;
  const reasonCode = action === "cancel" ? (input.reasonCode ?? null) : null;

  // The `held -> confirmed` guard trigger (sql/180) judges the hold by its OWN
  // `clock_timestamp()`, a few milliseconds after the read above. A hold that
  // elapses in that window makes the UPDATE raise 55000 HOLD_EXPIRED even though
  // the application judged it live (#1025). That is the same answer as an
  // elapsed hold, so it becomes the refusal, not a 500. The UPDATE runs in a
  // savepoint so the failed statement cannot leave the transaction aborted; it
  // is the first write, so nothing (history, audit, outbox) exists to undo.
  const savepoint = "booking_transition_update";
  let updated: { id: string }[];

  await tx.unsafe(`SAVEPOINT ${savepoint}`);

  try {
    updated = (await applyUpdate(tx, ctx, row, action, decision.to, {
      lateCancellation,
      reasonCode
    })) as { id: string }[];
    await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    await tx.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);

    if (isHoldExpiredTrigger(error)) {
      return refuse("HOLD_EXPIRED", "The hold has expired.");
    }

    throw error;
  }

  if (updated.length !== 1) {
    // Unreachable while the row is locked and its status was just read.
    throw new Error("booking: the reservation changed under its own lock");
  }

  let releasedAllocations = 0;

  if (decision.allocations === "release" && decision.releasedReason) {
    const released = (await tx`
      UPDATE awcms_booking_resource_allocations a
      SET released_at = clock_timestamp(),
          released_reason = ${decision.releasedReason}
      FROM awcms_booking_reservation_items i
      WHERE a.tenant_id = ${ctx.tenantId}
        AND i.tenant_id = ${ctx.tenantId}
        AND i.reservation_id = ${row.id}
        AND a.item_id = i.id
        AND a.released_at IS NULL
      RETURNING a.id
    `) as { id: string }[];

    releasedAllocations = released.length;
  }

  // Exactly ONE history row per transition (booking.md section 13). `detail`
  // holds closed keys: counts and flags, never text.
  await tx`
    INSERT INTO awcms_booking_reservation_events
      (tenant_id, reservation_id, seq, kind, from_status, to_status,
       actor_user_id, correlation_id, reason_code, detail)
    SELECT ${ctx.tenantId}, ${row.id}, coalesce(max(ev.seq), 0) + 1,
           ${decision.eventKind}, ${row.status}, ${decision.to},
           ${ctx.actorTenantUserId}, ${asUuid(ctx.correlationId) ?? null}::uuid,
           ${reasonCode},
           ${
             action === "cancel"
               ? { lateCancellation, releasedAllocations }
               : {}
           }::jsonb
    FROM awcms_booking_reservation_events ev
    WHERE ev.tenant_id = ${ctx.tenantId} AND ev.reservation_id = ${row.id}
  `;

  const reservation = await viewOf(tx, ctx.tenantId, row.id);
  const audit = AUDIT_FOR[action];

  await recordAuditEvent(tx, {
    tenantId: ctx.tenantId,
    ...(ctx.actorTenantUserId
      ? { actorTenantUserId: ctx.actorTenantUserId }
      : {}),
    moduleKey: BOOKING_MODULE_KEY,
    action: audit.action,
    resourceType: "booking_reservation",
    resourceId: row.id,
    severity: audit.severity,
    message: `Reservation ${reservation.reservationNo} moved from ${row.status} to ${decision.to}.`,
    // Which reservation and which transition. Never the customer reference, the
    // note or a reason text (ADR-0094); the reason CODE is on the history row.
    attributes: {
      fromStatus: row.status,
      toStatus: decision.to,
      ...(action === "cancel" ? { lateCancellation, releasedAllocations } : {})
    },
    ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
  });

  await emitReservationEvents(tx, ctx.tenantId, row.id, [
    {
      kind: decision.eventKind!,
      status: decision.to,
      previousStatus: row.status as "held" | "confirmed" | "checked_in",
      occurredAt: await databaseNowIso(tx),
      correlationId: ctx.correlationId ?? null,
      actorTenantUserId: ctx.actorTenantUserId,
      ...(action === "cancel" ? { lateCancellation } : {})
    }
  ]);

  return { outcome: "ok", reservation, replayed: false };
}

/** The UPDATE of one verb: only the columns its transition may change (`sql/180`). */
async function applyUpdate(
  tx: Sql,
  ctx: ReservationContext,
  row: LockedReservation,
  action: TransitionAction,
  to: ReservationStatus,
  extra: { lateCancellation: boolean; reasonCode: string | null }
): Promise<unknown[]> {
  if (action === "confirm") {
    return tx`
      UPDATE awcms_booking_reservations
      SET status = 'confirmed', hold_expires_at = NULL,
          status_changed_at = clock_timestamp(),
          status_changed_by = ${ctx.actorTenantUserId},
          updated_at = clock_timestamp()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${row.id}
        AND status = ${row.status}
      RETURNING id
    `;
  }

  if (action === "cancel") {
    return tx`
      UPDATE awcms_booking_reservations
      SET status = 'cancelled', late_cancellation = ${extra.lateCancellation},
          cancel_reason_code = ${extra.reasonCode},
          status_changed_at = clock_timestamp(),
          status_changed_by = ${ctx.actorTenantUserId},
          updated_at = clock_timestamp()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${row.id}
        AND status = ${row.status}
      RETURNING id
    `;
  }

  return tx`
    UPDATE awcms_booking_reservations
    SET status = ${to}, status_changed_at = clock_timestamp(),
        status_changed_by = ${ctx.actorTenantUserId},
        updated_at = clock_timestamp()
    WHERE tenant_id = ${ctx.tenantId} AND id = ${row.id}
      AND status = ${row.status}
    RETURNING id
  `;
}

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

type RescheduleSource = {
  id: string;
  status: ReservationStatus;
  lineage_id: string;
  party_size: number;
  external_customer_ref: string | null;
  external_ref_type: string | null;
  external_ref: string | null;
  customer_note: string | null;
  source: string;
  superseded_by_id: string | null;
};

type RescheduleItem = {
  offering_id: string;
  granularity: "time" | "stay";
  quantity: number;
};

/**
 * Does the successor of an already-rescheduled reservation match what a repeated
 * request asks for? Then the repeat is a replay (layer 2); otherwise it is a
 * different request against a reservation that can no longer be rescheduled.
 */
async function successorMatches(
  tx: Sql,
  tenantId: string,
  successorId: string,
  request: RescheduleRequest
): Promise<boolean> {
  const rows = (await tx`
    SELECT i.granularity,
           (extract(epoch FROM i.starts_at) * 1000)::float8 AS starts_at_ms,
           to_char(i.check_in_date, 'YYYY-MM-DD') AS check_in_date,
           to_char(i.check_out_date, 'YYYY-MM-DD') AS check_out_date,
           (SELECT string_agg(DISTINCT a.resource_id::text, ',')
            FROM awcms_booking_resource_allocations a
            WHERE a.tenant_id = i.tenant_id AND a.item_id = i.id) AS resource_ids
    FROM awcms_booking_reservation_items i
    WHERE i.tenant_id = ${tenantId} AND i.reservation_id = ${successorId}
    ORDER BY i.line_no LIMIT 1
  `) as {
    granularity: "time" | "stay";
    starts_at_ms: number;
    check_in_date: string | null;
    check_out_date: string | null;
    resource_ids: string | null;
  }[];
  const item = rows[0];

  if (!item) {
    return false;
  }

  const sameWhen =
    request.stay !== undefined
      ? item.granularity === "stay" &&
        item.check_in_date === request.stay.checkInDate &&
        item.check_out_date === request.stay.checkOutDate
      : item.granularity === "time" &&
        Math.floor(Number(item.starts_at_ms)) === request.startsAtMs;
  const sameResource =
    request.resourceId === undefined ||
    (item.resource_ids ?? "").split(",").includes(request.resourceId);

  return sameWhen && sameResource;
}

/**
 * Reschedules a CONFIRMED reservation into a new one (booking.md section 5.3),
 * in one transaction: lock the old, release its allocations, mark it
 * `rescheduled`, insert the replacement under the same lineage with the old
 * reservation's customer, party, source, note and external reference, claim the
 * new interval -- and roll ALL of it back to the untouched original when any step
 * is refused. Intervals are never edited in place.
 *
 * The old allocations are released first, inside the claim's savepoint, so moving
 * or extending over one's own slot or nights does not conflict with itself (T5a).
 */
export async function rescheduleReservation(
  tx: Sql,
  ctx: ReservationContext,
  reservationId: string,
  request: RescheduleRequest,
  liftPolicy: boolean
): Promise<RescheduleOutcome> {
  const locked = await lockReservation(tx, ctx.tenantId, reservationId);

  if (!locked) {
    return { outcome: "not_found" };
  }

  const sources = (await tx`
    SELECT id, status, lineage_id, party_size, external_customer_ref,
           external_ref_type, external_ref, customer_note, source,
           superseded_by_id
    FROM awcms_booking_reservations
    WHERE tenant_id = ${ctx.tenantId} AND id = ${locked.id}
  `) as RescheduleSource[];
  const old = sources[0]!;

  if (old.status === "rescheduled" && old.superseded_by_id) {
    if (
      await successorMatches(tx, ctx.tenantId, old.superseded_by_id, request)
    ) {
      return {
        outcome: "ok",
        reservation: await viewOf(tx, ctx.tenantId, old.superseded_by_id),
        previous: await viewOf(tx, ctx.tenantId, old.id),
        replayed: true,
        policyLifted: []
      };
    }

    return refuse(
      "INVALID_STATE",
      "Cannot reschedule a reservation that is rescheduled."
    );
  }

  const decision = evaluateTransition({
    from: old.status,
    action: "reschedule",
    now: new Date(Math.floor(Number(locked.now_ms))),
    holdExpiresAt: locked.hold_expires_at
      ? new Date(locked.hold_expires_at)
      : null
  });

  if (!decision.ok) {
    return refuse(decision.code, decision.message);
  }

  const items = (await tx`
    SELECT offering_id, granularity, quantity
    FROM awcms_booking_reservation_items
    WHERE tenant_id = ${ctx.tenantId} AND reservation_id = ${old.id}
    ORDER BY line_no
  `) as RescheduleItem[];

  if (items.length !== 1) {
    // v1 claims one item per reservation (placeHold); a multi-item reservation is
    // not something this verb can move atomically.
    return refuse(
      "INVALID_STATE",
      "Only a reservation with a single item can be rescheduled."
    );
  }

  const item = items[0]!;
  const heldResources = (await tx`
    SELECT DISTINCT a.resource_id::text AS resource_id
    FROM awcms_booking_reservation_items i
    JOIN awcms_booking_resource_allocations a
      ON a.tenant_id = i.tenant_id AND a.item_id = i.id
    WHERE i.tenant_id = ${ctx.tenantId} AND i.reservation_id = ${old.id}
  `) as { resource_id: string }[];

  let target: { resourceId?: string; poolId?: string };

  if (request.resourceId !== undefined) {
    target = { resourceId: request.resourceId };
  } else if (request.poolId !== undefined) {
    target = { poolId: request.poolId };
  } else if (heldResources.length === 1) {
    target = { resourceId: heldResources[0]!.resource_id };
  } else {
    return refuse(
      "RESOURCE_REQUIRED",
      "The reservation spans several resources; send resourceId or poolId to say where it moves."
    );
  }

  const claim: PlaceHoldInput = {
    offeringId: item.offering_id,
    ...target,
    ...(request.startsAtMs === undefined
      ? {}
      : { startsAtMs: request.startsAtMs }),
    ...(request.stay === undefined ? {} : { stay: request.stay }),
    partySize: Number(old.party_size),
    quantity: Number(item.quantity),
    externalCustomerRef: old.external_customer_ref,
    externalRef:
      old.external_ref_type !== null && old.external_ref !== null
        ? { type: old.external_ref_type, id: old.external_ref }
        : null,
    source: old.source,
    customerNote: old.customer_note
  };
  const issues = validatePlaceHold(claim);

  if (issues.length > 0) {
    return { outcome: "invalid", errors: issues };
  }

  const reasons = await evaluateClaimPolicy(tx, ctx.tenantId, {
    offeringId: claim.offeringId,
    ...target,
    ...(claim.startsAtMs === undefined ? {} : { startsAtMs: claim.startsAtMs }),
    ...(claim.stay === undefined ? {} : { stay: claim.stay })
  });

  if (reasons.length > 0 && !liftPolicy) {
    return policyRefusal(reasons[0]!);
  }

  const placed = await placeHold(tx, ctx, claim, {
    replaces: {
      reservationId: old.id,
      lineageId: old.lineage_id,
      newReservationId: crypto.randomUUID()
    }
  });

  if (placed.outcome === "invalid") {
    return placed;
  }

  if (placed.outcome === "refused") {
    return refuse(placed.code, placed.message);
  }

  const lifted = [...new Set(reasons.map((reason) => reason.code))];
  const replacement = await viewOf(
    tx,
    ctx.tenantId,
    placed.reservation.reservationId
  );
  const previous = await viewOf(tx, ctx.tenantId, old.id);

  await recordAuditEvent(tx, {
    tenantId: ctx.tenantId,
    ...(ctx.actorTenantUserId
      ? { actorTenantUserId: ctx.actorTenantUserId }
      : {}),
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.reservationRescheduled.action,
    resourceType: "booking_reservation",
    resourceId: old.id,
    severity: BOOKING_AUDIT_EVENTS.reservationRescheduled.severity,
    message: `Reservation ${previous.reservationNo} was rescheduled into ${replacement.reservationNo}.`,
    attributes: {
      fromReservationId: old.id,
      toReservationId: replacement.id,
      lineageId: replacement.lineageId,
      startsAt: replacement.startsAt,
      endsAt: replacement.endsAt
    },
    ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
  });

  if (lifted.length > 0) {
    await auditOverride(
      tx,
      ctx,
      replacement.id,
      replacement.reservationNo,
      lifted,
      "reschedule"
    );
  }

  return {
    outcome: "ok",
    reservation: replacement,
    previous,
    replayed: false,
    policyLifted: lifted
  };
}
