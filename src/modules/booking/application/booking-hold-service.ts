/**
 * Placing a hold (or an immediate confirmation) on `booking` capacity (Issue
 * #939, ADR-0131; docs/awcms/booking.md section 3, 5.1 and 8.1).
 *
 * `placeHold` is the CLAIM: it writes the reservation, its item snapshot, the
 * allocations that win the units, and the history rows, in the caller's
 * transaction. It is what the reservation route of Issue #941 calls after it has
 * authorized the request and enforced policy, and what the concurrency tests
 * drive directly. It has no HTTP surface of its own.
 *
 * ## What it decides, and what it leaves to the caller
 *
 * It decides everything that is about the CLAIM's integrity:
 *
 *   * the offering and the resources exist, are active, and agree on the mode:
 *     a time offering on slot resources, or a stay offering on stay resources
 *     (ADR-0135; `BOOKING_MODE_MISMATCH` otherwise);
 *   * the party fits the offering, and the pool has enough units at all;
 *   * the interval is DERIVED (the server owns the interval, booking.md section
 *     9): a slot from the offering and a start instant, never an end or a
 *     buffer; a stay from two local DATES in the resource's zone, never an
 *     instant -- the night count is date arithmetic, the arrival and departure
 *     instants come from the resource's check-in / check-out times and are
 *     SNAPSHOTTED onto the item, with the zone and the times, as facts;
 *   * the hold lifetime is clamped and measured on the DATABASE clock;
 *   * the per-customer / per-tenant caps on live holds (hold flooding);
 *   * elapsed holds on the target units are reclaimed first (lazy reclaim);
 *   * the allocator wins the units all-or-none, the history is appended.
 *
 * It does NOT decide business policy: opening hours (`OUTSIDE_SCHEDULE`), lead
 * time and horizon, and whether `reservations.override` lifts them. Those are
 * the create handler's, evaluated against the same availability engine the
 * search uses (`answerAvailability`), because only the handler knows whether the
 * caller holds the high-risk `override` permission. The seam is deliberate:
 * nothing here can lift a double-booking, and nothing here needs to know who
 * the caller is beyond a user id for the stamps.
 *
 * ## A refusal is a VALUE, and it rolls back what it wrote
 *
 * `withTenant` COMMITS a returned 4xx, so a handler that returns a refusal after
 * writing a reservation row would leave that row behind. The whole claim runs
 * inside a savepoint; a refusal is thrown inside it (rolling back the
 * reservation, the item and any allocation already won) and turned back into a
 * value outside it. No partial claim survives, in particular none for `k > 1`
 * units (booking.md section 5.2).
 *
 * ## Deadlocks
 *
 * Units chosen together are inserted in one global order, which removes the
 * ordinary cause. A residual `40P01` rolls back to the savepoint (releasing the
 * locks it took) and retries after a jittered backoff, at most
 * `ALLOCATOR_LIMITS.maxDeadlockRetries` times, then `CONTENTION_RETRY`. It never
 * loops unboundedly.
 *
 * ## Audit
 *
 * One `info` row per reservation created, naming the reservation, the offering,
 * the resources and the interval -- never the customer reference or the note
 * (ADR-0094). Lazy reclaim writes one aggregate row per call that expired
 * anything. A refused call writes nothing.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  ALLOCATOR_LIMITS,
  PLACEMENT_REFUSALS,
  classifyDatabaseFailure,
  deriveSlotWindow,
  resolveHoldSeconds,
  retryDelayMs,
  validatePlaceHold,
  type PlaceHoldInput,
  type PlacementRefusalCode,
  type ValidationIssue
} from "../domain/booking-allocation";
import { BOOKING_AUDIT_EVENTS } from "../domain/booking-audit";
import { BOOKING_MODULE_KEY } from "../domain/booking-permissions";
import { POLICY_DEFAULTS } from "../domain/booking-policy";
import {
  creationEventKinds,
  initialReservationStatus
} from "../domain/booking-reservation-state";
import {
  agreedStayTerms,
  checkNightLimits,
  deriveStay
} from "../domain/booking-stay";
import { parseLocalTime } from "../domain/booking-time";
import type { StaffAvailabilityConsumer } from "../domain/booking-staff-availability";
import { asUuid } from "../domain/booking-validation";
import {
  ContentionError,
  SlotUnavailableError,
  claimUnits,
  type ClaimedUnit
} from "./booking-allocator";
import {
  databaseNowIso,
  emitReservationEvents,
  type PendingReservationEvent
} from "./booking-event-emit";
import { reclaimExpiredHolds } from "./booking-hold-expiry";
import { claimStaff } from "./booking-staff-claim";

type Sql = Bun.SQL;

export type PlaceHoldContext = {
  tenantId: string;
  /** The acting tenant user, for the stamps and the audit row; `null` for a system caller. */
  actorTenantUserId: string | null;
  correlationId?: string;
  /**
   * The staff constraint (Issue #949), resolved by the composition root: a real
   * consumer only when `hr_workforce` is on for the tenant, else
   * `NO_OP_STAFF_AVAILABILITY`. REQUIRED, with no default: a caller that forgets
   * it would silently skip the constraint, so "no constraint" must be spelled.
   */
  staff: StaffAvailabilityConsumer;
};

/**
 * A reschedule is a placement that REPLACES a confirmed reservation (booking.md
 * section 5.3): inside the same savepoint, before the new claim, the old
 * reservation's allocations are released, the old reservation becomes
 * `rescheduled` naming the replacement, and the replacement is inserted
 * `confirmed` under the same lineage. A refusal rolls ALL of it back to the
 * untouched original. The caller has already locked the old reservation
 * `FOR UPDATE` and re-checked it is `confirmed`.
 */
export type PlaceHoldOptions = {
  replaces?: {
    reservationId: string;
    lineageId: string;
    /** Generated by the caller so the old row can name it before it exists (`sql/208`). */
    newReservationId: string;
  };
};

export type PlacedReservation = {
  reservationId: string;
  reservationNo: string;
  lineageId: string;
  status: "held" | "confirmed";
  /** `null` for an immediately confirmed reservation. */
  holdExpiresAt: string | null;
  offeringId: string;
  startsAt: string;
  endsAt: string;
  /** The occupied range a slot claims; `null` for a stay (a stay is dates, ADR-0135). */
  occupiedFrom: string | null;
  occupiedTo: string | null;
  /** The stay snapshot (dates, nights, zone); absent for a slot. `startsAt` / `endsAt` are then the derived arrival and departure instants. */
  stay?: PlacedStay;
  partySize: number;
  quantity: number;
  units: ClaimedUnit[];
};

export type PlacedStay = {
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  timezone: string;
};

export type PlaceHoldOutcome =
  | { outcome: "ok"; reservation: PlacedReservation }
  | {
      outcome: "refused";
      code: PlacementRefusalCode;
      message: string;
      httpStatus: number;
    }
  | { outcome: "invalid"; errors: ValidationIssue[] };

type OfferingRow = {
  id: string;
  code: string;
  name: string;
  granularity: "time" | "stay";
  duration_seconds: number | null;
  setup_seconds: number | null;
  cleanup_seconds: number | null;
  min_nights: number | null;
  max_nights: number | null;
  min_party: number;
  max_party: number;
  confirmation_mode: "immediate" | "hold_then_confirm";
};

type ResourceRow = {
  id: string;
  booking_mode: "slot" | "stay";
  timezone: string;
  /** `HH:MM:SS` for a stay resource, `null` for a slot resource. */
  stay_check_in_time: string | null;
  stay_check_out_time: string | null;
};

/** What a placement claims, derived once: the interval, and for a stay the snapshot the item records. */
type Window =
  | {
      kind: "time";
      startsIso: string;
      endsIso: string;
      occupiedFromMs: number;
      occupiedToMs: number;
    }
  | {
      kind: "stay";
      startsIso: string;
      endsIso: string;
      checkInDate: string;
      checkOutDate: string;
      nights: number;
      timezone: string;
      checkInTime: string;
      checkOutTime: string;
    };

type SettingsRow = {
  default_hold_seconds: number | null;
  max_hold_seconds: number | null;
  max_active_holds_per_customer: number | null;
  max_active_holds_per_tenant: number | null;
};

/** Carries a refusal out of the savepoint so everything the claim wrote rolls back with it. */
class PlacementRefusedError extends Error {
  readonly code: PlacementRefusalCode;

  constructor(code: PlacementRefusalCode, message: string) {
    super(message);
    this.name = "PlacementRefusedError";
    this.code = code;
  }
}

function refused(
  code: PlacementRefusalCode,
  message: string
): PlaceHoldOutcome {
  return {
    outcome: "refused",
    code,
    message,
    httpStatus: PLACEMENT_REFUSALS[code]
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadOffering(
  tx: Sql,
  tenantId: string,
  offeringId: string
): Promise<OfferingRow | null> {
  const rows = (await tx`
    SELECT id, code, name, granularity, duration_seconds, setup_seconds,
           cleanup_seconds, min_nights, max_nights, min_party, max_party,
           confirmation_mode
    FROM awcms_booking_service_offerings
    WHERE tenant_id = ${tenantId} AND id = ${offeringId}
      AND deleted_at IS NULL AND status = 'active'
  `) as OfferingRow[];

  return rows[0] ?? null;
}

/** The target resources in PREFERENCE order (`sort_order`, then id): one resource, or a live pool's. */
async function loadTargetResources(
  tx: Sql,
  tenantId: string,
  input: PlaceHoldInput
): Promise<ResourceRow[]> {
  if (input.resourceId !== undefined) {
    return (await tx`
      SELECT id, booking_mode, timezone,
             to_char(stay_check_in_time, 'HH24:MI:SS') AS stay_check_in_time,
             to_char(stay_check_out_time, 'HH24:MI:SS') AS stay_check_out_time
      FROM awcms_booking_resources
      WHERE tenant_id = ${tenantId} AND id = ${input.resourceId}
        AND deleted_at IS NULL AND status = 'active'
    `) as ResourceRow[];
  }

  return (await tx`
    SELECT r.id, r.booking_mode, r.timezone,
           to_char(r.stay_check_in_time, 'HH24:MI:SS') AS stay_check_in_time,
           to_char(r.stay_check_out_time, 'HH24:MI:SS') AS stay_check_out_time
    FROM awcms_booking_resources r
    JOIN awcms_booking_resource_pools p
      ON p.tenant_id = r.tenant_id AND p.id = r.pool_id
    WHERE r.tenant_id = ${tenantId} AND p.id = ${input.poolId!}
      AND p.deleted_at IS NULL
      AND r.deleted_at IS NULL AND r.status = 'active'
    ORDER BY r.sort_order, r.id
  `) as ResourceRow[];
}

async function countActiveUnits(
  tx: Sql,
  tenantId: string,
  resourceIds: readonly string[]
): Promise<number> {
  const list = resourceIds.join(",");
  const rows = (await tx`
    SELECT count(*)::int AS units
    FROM awcms_booking_resource_units
    WHERE tenant_id = ${tenantId}
      AND resource_id = ANY(string_to_array(${list}::text, ',')::uuid[])
      AND status = 'active'
  `) as { units: number }[];

  return Number(rows[0]?.units ?? 0);
}

async function loadSettings(tx: Sql, tenantId: string): Promise<SettingsRow> {
  const rows = (await tx`
    SELECT default_hold_seconds, max_hold_seconds,
           max_active_holds_per_customer, max_active_holds_per_tenant
    FROM awcms_booking_settings
    WHERE tenant_id = ${tenantId}
  `) as SettingsRow[];

  return (
    rows[0] ?? {
      default_hold_seconds: null,
      max_hold_seconds: null,
      max_active_holds_per_customer: null,
      max_active_holds_per_tenant: null
    }
  );
}

/**
 * Enforces the caps on LIVE holds (booking.md section 9, hold flooding). A cap is
 * a SUM, which no exclusion constraint expresses (section 8.1 rule 4): take the
 * tenant's hold lock, then re-read the count under it, so two requests cannot
 * both read "one below the cap" and both pass. It runs AFTER the claim has won
 * its units and inserted the hold, so the count includes the hold being placed
 * (and the exclusion constraint, not this lock, still decides contenders for the
 * same units). The lock is a transaction-scoped advisory lock keyed on the
 * tenant, so no other tenant's holds wait on it. Elapsed holds do not count:
 * they are about to be reclaimed.
 *
 * The caps always apply: a tenant that has configured none gets the module
 * defaults of `POLICY_DEFAULTS` (Issue #941 settled the N4 left open by #939).
 * EVERY path that creates a hold must come through here, so it takes this same
 * lock before it counts.
 */
async function enforceHoldCaps(
  tx: Sql,
  tenantId: string,
  customerRef: string | null,
  settings: SettingsRow
): Promise<void> {
  // `NULL` in the settings is the MODULE DEFAULT, not "unlimited" (booking.md
  // section 13, left open by Issue #939 as N4, settled by Issue #941): an
  // unconfigured tenant is capped, and a tenant that wants a higher ceiling sets
  // one. See `POLICY_DEFAULTS` for the numbers and the trade-off.
  const tenantCap =
    settings.max_active_holds_per_tenant ??
    POLICY_DEFAULTS.maxActiveHoldsPerTenant;
  // A walk-in or anonymous hold has no customer to count against; the tenant cap
  // is what bounds it.
  const customerCap =
    customerRef === null
      ? null
      : (settings.max_active_holds_per_customer ??
        POLICY_DEFAULTS.maxActiveHoldsPerCustomer);

  // The lock is taken for EVERY hold that wins its units (a default cap always
  // applies), so the winners of one tenant queue here until their transactions
  // end: the price of a sum that a race cannot get past. It is a
  // transaction-scoped advisory lock keyed on the tenant, so no other tenant's
  // holds wait on it.
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended(${`awcms_booking.holds:${tenantId}`}, 0))
  `;

  const rows = (await tx`
    SELECT count(*)::int AS tenant_holds,
           (count(*) FILTER (WHERE external_customer_ref = ${customerRef}))::int
             AS customer_holds
    FROM awcms_booking_reservations
    WHERE tenant_id = ${tenantId}
      AND status = 'held'
      AND hold_expires_at > clock_timestamp()
  `) as { tenant_holds: number; customer_holds: number }[];
  const row = rows[0]!;

  // The count includes the hold this very claim just inserted, so "at the cap"
  // is a count ABOVE it.
  if (Number(row.tenant_holds) > tenantCap) {
    throw new PlacementRefusedError(
      "HOLD_LIMIT_EXCEEDED",
      "The tenant already has the maximum number of active holds."
    );
  }

  if (customerCap !== null && Number(row.customer_holds) > customerCap) {
    throw new PlacementRefusedError(
      "HOLD_LIMIT_EXCEEDED",
      "This customer already has the maximum number of active holds."
    );
  }
}

type WriteResult = {
  reservationId: string;
  reservationNo: string;
  lineageId: string;
  holdExpiresAt: string | null;
  units: ClaimedUnit[];
};

/**
 * The first half of a reschedule (booking.md section 5.3), inside the claim's
 * savepoint: release the old reservation's live allocations (reason
 * `rescheduled`), mark it `rescheduled` naming its replacement, and append its
 * history row. The old reservation is `confirmed` and locked by the caller; the
 * `confirmed -> rescheduled` trigger and the CHECKs of `sql/180` are the second
 * line of defence.
 */
async function supersedeReservation(
  tx: Sql,
  ctx: PlaceHoldContext,
  replaces: NonNullable<PlaceHoldOptions["replaces"]>
): Promise<void> {
  await tx`
    UPDATE awcms_booking_resource_allocations a
    SET released_at = clock_timestamp(), released_reason = 'rescheduled'
    FROM awcms_booking_reservation_items i
    WHERE a.tenant_id = ${ctx.tenantId}
      AND i.tenant_id = ${ctx.tenantId}
      AND i.reservation_id = ${replaces.reservationId}
      AND a.item_id = i.id
      AND a.released_at IS NULL
  `;

  const updated = (await tx`
    UPDATE awcms_booking_reservations
    SET status = 'rescheduled',
        superseded_by_id = ${replaces.newReservationId},
        status_changed_at = clock_timestamp(),
        status_changed_by = ${ctx.actorTenantUserId},
        updated_at = clock_timestamp()
    WHERE tenant_id = ${ctx.tenantId}
      AND id = ${replaces.reservationId}
      AND status = 'confirmed'
    RETURNING id
  `) as { id: string }[];

  if (updated.length !== 1) {
    // Unreachable: the caller holds the old reservation's row lock and has just
    // read it `confirmed`. A defect, not a refusal.
    throw new Error("booking: the reservation to reschedule is not confirmed");
  }

  await tx`
    INSERT INTO awcms_booking_reservation_events
      (tenant_id, reservation_id, seq, kind, from_status, to_status,
       actor_user_id, correlation_id, detail)
    SELECT ${ctx.tenantId}, ${replaces.reservationId},
           coalesce(max(ev.seq), 0) + 1, 'rescheduled', 'confirmed',
           'rescheduled', ${ctx.actorTenantUserId},
           ${asUuid(ctx.correlationId) ?? null}::uuid,
           ${{ supersededById: replaces.newReservationId }}::jsonb
    FROM awcms_booking_reservation_events ev
    WHERE ev.tenant_id = ${ctx.tenantId}
      AND ev.reservation_id = ${replaces.reservationId}
  `;
}

/** The writes of one attempt. Runs inside the savepoint. */
async function writeClaim(
  tx: Sql,
  ctx: PlaceHoldContext,
  input: PlaceHoldInput,
  offering: OfferingRow,
  resourceIds: readonly string[],
  window: Window,
  status: "held" | "confirmed",
  holdSeconds: number,
  settings: SettingsRow,
  replaces: PlaceHoldOptions["replaces"]
): Promise<WriteResult> {
  // A reschedule frees the old claim and supersedes the old reservation FIRST,
  // inside this savepoint: the replacement may overlap its own predecessor
  // (booking.md section 8.3 T5a) and may carry its external reference
  // (`sql/208`), and a refusal further down rolls all of it back.
  if (replaces) {
    await supersedeReservation(tx, ctx, replaces);
  }

  const reservations = (await tx`
    INSERT INTO awcms_booking_reservations
      (id, lineage_id, rescheduled_from_id, tenant_id, status,
       external_customer_ref, party_size, starts_at, ends_at,
       hold_expires_at, source, external_ref_type, external_ref, customer_note,
       created_by, status_changed_by)
    VALUES (
      COALESCE(${replaces?.newReservationId ?? null}::uuid, gen_random_uuid()),
      ${replaces?.lineageId ?? null}::uuid,
      ${replaces?.reservationId ?? null}::uuid,
      ${ctx.tenantId}, ${status}, ${input.externalCustomerRef ?? null},
      ${input.partySize}, ${window.startsIso}::timestamptz,
      ${window.endsIso}::timestamptz,
      CASE WHEN ${status}::text = 'held'
           THEN clock_timestamp() + make_interval(secs => ${holdSeconds}::int)
      END,
      ${input.source ?? "admin"}, ${input.externalRef?.type ?? null},
      ${input.externalRef?.id ?? null}, ${input.customerNote ?? null},
      ${ctx.actorTenantUserId}, ${ctx.actorTenantUserId}
    )
    RETURNING id, reservation_no, lineage_id, hold_expires_at
  `) as {
    id: string;
    reservation_no: string;
    lineage_id: string;
    hold_expires_at: Date | null;
  }[];
  const reservation = reservations[0]!;

  const items = (
    window.kind === "time"
      ? await tx`
    INSERT INTO awcms_booking_reservation_items
      (tenant_id, reservation_id, line_no, offering_id, offering_code,
       offering_name, granularity, duration_seconds, setup_seconds,
       cleanup_seconds, starts_at, ends_at, quantity)
    VALUES (
      ${ctx.tenantId}, ${reservation.id}, 1, ${offering.id}, ${offering.code},
      ${offering.name}, 'time', ${offering.duration_seconds},
      ${offering.setup_seconds}, ${offering.cleanup_seconds},
      ${window.startsIso}::timestamptz, ${window.endsIso}::timestamptz,
      ${input.quantity}
    )
    RETURNING id
  `
      : await tx`
    INSERT INTO awcms_booking_reservation_items
      (tenant_id, reservation_id, line_no, offering_id, offering_code,
       offering_name, granularity, starts_at, ends_at, check_in_date,
       check_out_date, nights, check_in_local_time, check_out_local_time,
       timezone, quantity)
    VALUES (
      ${ctx.tenantId}, ${reservation.id}, 1, ${offering.id}, ${offering.code},
      ${offering.name}, 'stay',
      ${window.startsIso}::timestamptz, ${window.endsIso}::timestamptz,
      ${window.checkInDate}::date, ${window.checkOutDate}::date,
      ${window.nights}::int, ${window.checkInTime}::time,
      ${window.checkOutTime}::time, ${window.timezone}, ${input.quantity}
    )
    RETURNING id
  `
  ) as { id: string }[];

  const units = await claimUnits(tx, {
    kind: window.kind,
    tenantId: ctx.tenantId,
    itemId: items[0]!.id,
    resourceIds,
    quantity: input.quantity
  });

  // Staff (Issue #949): a slot resource that names the people who serve it needs
  // one of them, won in THIS savepoint under the staff exclusion constraint. No
  // free person is the same refusal as no free unit, and the savepoint takes the
  // units and the reservation down with it.
  if (window.kind === "time") {
    const staffWon = await claimStaff(tx, ctx.staff, {
      tenantId: ctx.tenantId,
      itemId: items[0]!.id,
      resourceIds: [...new Set(units.map((unit) => unit.resourceId))],
      startsIso: window.startsIso,
      endsIso: window.endsIso,
      ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
    });

    if (!staffWon) {
      throw new PlacementRefusedError(
        "SLOT_UNAVAILABLE",
        "That time is no longer available."
      );
    }
  }

  // The caps are checked AFTER the units are won, not before. The tenant lock
  // below is held until commit, so taking it first would serialise every hold of
  // a tenant BEFORE the exclusion constraint saw them, and the constraint (not an
  // application lock) is what must decide two claims for one slot (booking.md
  // section 8.1). Checked here, contenders for the same units still reach the
  // constraint concurrently and only the winners queue on the cap; a claim over
  // the cap rolls back with the savepoint, units included.
  if (status === "held") {
    await enforceHoldCaps(
      tx,
      ctx.tenantId,
      input.externalCustomerRef ?? null,
      settings
    );
  }

  // A replacement is born confirmed whatever the offering says: it takes the
  // place of a booking that was already confirmed.
  const kinds = creationEventKinds(
    replaces ? "immediate" : offering.confirmation_mode
  );
  const detail = {
    ...(replaces ? { rescheduledFromId: replaces.reservationId } : {}),
    offeringId: offering.id,
    quantity: input.quantity,
    startsAt: window.startsIso,
    endsAt: window.endsIso,
    resourceIds: [...new Set(units.map((unit) => unit.resourceId))],
    // Additive, stay only (booking.md section 3.1): dates and zone, no person.
    ...(window.kind === "stay"
      ? {
          checkInDate: window.checkInDate,
          checkOutDate: window.checkOutDate,
          nights: window.nights,
          timezone: window.timezone
        }
      : {})
  };

  for (const [index, kind] of kinds.entries()) {
    await tx`
      INSERT INTO awcms_booking_reservation_events
        (tenant_id, reservation_id, seq, kind, from_status, to_status,
         actor_user_id, correlation_id, detail)
      VALUES (
        ${ctx.tenantId}, ${reservation.id}, ${index + 1}, ${kind}, NULL,
        ${status}, ${ctx.actorTenantUserId}, ${asUuid(ctx.correlationId) ?? null},
        ${detail}::jsonb
      )
    `;
  }

  return {
    reservationId: reservation.id,
    reservationNo: reservation.reservation_no,
    lineageId: reservation.lineage_id,
    holdExpiresAt: reservation.hold_expires_at
      ? new Date(reservation.hold_expires_at).toISOString()
      : null,
    units
  };
}

/** Maps what escaped the savepoint to a refusal value, or `null` to rethrow. */
function refusalFor(error: unknown): PlaceHoldOutcome | null {
  if (error instanceof PlacementRefusedError) {
    return refused(error.code, error.message);
  }

  if (error instanceof SlotUnavailableError) {
    return refused(
      "SLOT_UNAVAILABLE",
      error.wanted > 1
        ? `Only ${error.claimed} of ${error.wanted} requested units are free for that time.`
        : "That time is no longer available."
    );
  }

  if (error instanceof ContentionError) {
    return refused(
      "CONTENTION_RETRY",
      "The slot is being contended; please retry."
    );
  }

  if (error instanceof Bun.SQL.PostgresError) {
    const kind = classifyDatabaseFailure(
      String(error.errno),
      (error as { constraint?: string }).constraint
    );

    // 23P01 escaping the allocator's DO NOTHING is still "the slot is taken".
    if (kind === "exclusion_conflict") {
      return refused("SLOT_UNAVAILABLE", "That time is no longer available.");
    }

    if (kind === "external_ref_in_use") {
      return refused(
        "EXTERNAL_REF_IN_USE",
        "A live reservation already exists for that external reference."
      );
    }
  }

  return null;
}

function isDeadlock(error: unknown): boolean {
  return (
    error instanceof Bun.SQL.PostgresError &&
    classifyDatabaseFailure(
      String(error.errno),
      (error as { constraint?: string }).constraint
    ) === "deadlock"
  );
}

type DerivedWindow =
  | { outcome: "ok"; window: Window }
  | { outcome: "stop"; result: PlaceHoldOutcome };

function stop(result: PlaceHoldOutcome): DerivedWindow {
  return { outcome: "stop", result };
}

/** A slot: the service interval and the occupied range from the offering and the requested start. */
function deriveTimeWindow(
  input: PlaceHoldInput,
  offering: OfferingRow
): DerivedWindow {
  const slot = deriveSlotWindow({
    startsAtMs: input.startsAtMs!,
    durationSeconds: offering.duration_seconds!,
    setupSeconds: offering.setup_seconds!,
    cleanupSeconds: offering.cleanup_seconds!
  });

  if (!slot) {
    return stop({
      outcome: "invalid",
      errors: [{ field: "startsAt", message: "startsAt cannot form a slot." }]
    });
  }

  return {
    outcome: "ok",
    window: {
      kind: "time",
      startsIso: new Date(slot.startsAtMs).toISOString(),
      endsIso: new Date(slot.endsAtMs).toISOString(),
      occupiedFromMs: slot.occupiedFromMs,
      occupiedToMs: slot.occupiedToMs
    }
  };
}

/**
 * A stay: the nights are date arithmetic in the resource's zone; the arrival and
 * departure instants come from the resource's check-in and check-out times
 * (RFC 5545 gap and fold rules) and are SNAPSHOTTED onto the item with the zone
 * and the times, so a later configuration or tzdata change never moves a stay
 * that was claimed. "Today" is the DATABASE clock's local date in the zone.
 */
async function deriveStayWindow(
  tx: Sql,
  input: PlaceHoldInput,
  offering: OfferingRow,
  resources: readonly ResourceRow[]
): Promise<DerivedWindow> {
  const terms = agreedStayTerms(
    resources.map((resource) => ({
      timezone: resource.timezone,
      checkInTime: resource.stay_check_in_time ?? "",
      checkOutTime: resource.stay_check_out_time ?? ""
    }))
  );

  if (!terms) {
    return stop(
      refused(
        "STAY_POOL_INCONSISTENT",
        "The target resources do not share one time zone and one pair of check-in and check-out times; a stay snapshots a single set."
      )
    );
  }

  const checkInSeconds = parseLocalTime(terms.checkInTime);
  const checkOutSeconds = parseLocalTime(terms.checkOutTime);

  if (checkInSeconds === null || checkOutSeconds === null) {
    // CHECK `awcms_booking_resources_stay_times_check` makes this unreachable.
    throw new Error(
      "booking: a stay resource has no check-in / check-out time"
    );
  }

  const clock = (await tx`
    SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms
  `) as { now_ms: number }[];
  const stay = deriveStay({
    checkInDate: input.stay!.checkInDate,
    checkOutDate: input.stay!.checkOutDate,
    timezone: terms.timezone,
    checkInSeconds,
    checkOutSeconds,
    nowMs: Math.floor(Number(clock[0]!.now_ms))
  });

  if (!stay.ok) {
    return stop(refused(stay.code, stay.detail));
  }

  const limit = checkNightLimits(stay.nights, {
    minNights: offering.min_nights ?? 1,
    maxNights: offering.max_nights ?? 366
  });

  if (limit) {
    return stop(refused(limit.code, limit.detail));
  }

  return {
    outcome: "ok",
    window: {
      kind: "stay",
      startsIso: new Date(stay.startsAtMs).toISOString(),
      endsIso: new Date(stay.endsAtMs).toISOString(),
      checkInDate: input.stay!.checkInDate,
      checkOutDate: input.stay!.checkOutDate,
      nights: stay.nights,
      timezone: terms.timezone,
      checkInTime: terms.checkInTime,
      checkOutTime: terms.checkOutTime
    }
  };
}

/**
 * The domain events of a placement, in the SAME transaction as the claim (a
 * rolled-back claim emits nothing, and a refused one never reaches here): for a
 * new reservation `created` then `held` (or `confirmed` for an immediate
 * confirmation, with no `held`), for a REPLACEMENT `rescheduled` on the old
 * reservation and `created` then `confirmed` on the new one, which names the
 * reservation it replaced. The facts of each come from the one database function
 * `awcms_booking_reservation_event_facts`.
 */
async function publishPlacementEvents(
  tx: Sql,
  ctx: PlaceHoldContext,
  written: WriteResult,
  status: "held" | "confirmed",
  replaces: PlaceHoldOptions["replaces"]
): Promise<void> {
  const occurredAt = await databaseNowIso(tx);
  const common = {
    occurredAt,
    correlationId: ctx.correlationId ?? null,
    actorTenantUserId: ctx.actorTenantUserId
  };

  if (replaces) {
    await emitReservationEvents(tx, ctx.tenantId, replaces.reservationId, [
      {
        kind: "rescheduled",
        status: "rescheduled",
        previousStatus: "confirmed",
        supersededById: replaces.newReservationId,
        ...common
      }
    ]);
  }

  const base: PendingReservationEvent[] = [
    { kind: "created", status, previousStatus: null, ...common },
    // `held` for a hold, `confirmed` for an immediate confirmation or a replacement.
    { kind: status, status, previousStatus: null, ...common }
  ];
  const creation = base.map((event) => ({
    ...event,
    ...(replaces ? { rescheduledFromId: replaces.reservationId } : {})
  }));

  await emitReservationEvents(
    tx,
    ctx.tenantId,
    written.reservationId,
    creation
  );
}

/**
 * Places a hold (or, for an `immediate` offering, a confirmed reservation) on
 * `input.quantity` units of the target resource or pool: at `input.startsAtMs`
 * for a slot, or for the nights `[stay.checkInDate, stay.checkOutDate)` for a
 * stay (each unit taken for ALL the nights; a stay never moves between units).
 *
 * MUST run inside the caller's tenant transaction (`withTenant*`), which owns
 * COMMIT/ROLLBACK. Returns a refusal as a value; throws only for defects.
 */
export async function placeHold(
  tx: Sql,
  ctx: PlaceHoldContext,
  input: PlaceHoldInput,
  options: PlaceHoldOptions = {}
): Promise<PlaceHoldOutcome> {
  const issues = validatePlaceHold(input);

  if (issues.length > 0) {
    return { outcome: "invalid", errors: issues };
  }

  const offering = await loadOffering(tx, ctx.tenantId, input.offeringId);

  if (!offering) {
    return refused("OFFERING_NOT_FOUND", "Service offering not found.");
  }

  const resources = await loadTargetResources(tx, ctx.tenantId, input);

  if (resources.length === 0) {
    return refused("RESOURCE_NOT_FOUND", "Resource not found.");
  }

  const isStay = input.stay !== undefined;

  if (
    offering.granularity !== (isStay ? "stay" : "time") ||
    resources.some(
      (resource) => resource.booking_mode !== (isStay ? "stay" : "slot")
    )
  ) {
    return refused(
      "BOOKING_MODE_MISMATCH",
      isStay
        ? "A stay claim needs a stay offering on stay resources."
        : "A slot claim needs a time offering on slot resources (send `stay` for a stay resource)."
    );
  }

  if (
    input.partySize < offering.min_party ||
    input.partySize > offering.max_party
  ) {
    return refused(
      "PARTY_SIZE_OUT_OF_RANGE",
      `The party must be ${offering.min_party} to ${offering.max_party}.`
    );
  }

  const resourceIds = resources.map((resource) => resource.id);
  const totalUnits = await countActiveUnits(tx, ctx.tenantId, resourceIds);

  if (totalUnits < input.quantity) {
    return refused(
      "QUANTITY_EXCEEDS_UNITS",
      `The target has ${totalUnits} active unit(s); the quantity is larger.`
    );
  }

  const settings = await loadSettings(tx, ctx.tenantId);
  const derived = isStay
    ? await deriveStayWindow(tx, input, offering, resources)
    : deriveTimeWindow(input, offering);

  if (derived.outcome !== "ok") {
    return derived.result;
  }

  const window = derived.window;
  const status = options.replaces
    ? "confirmed"
    : initialReservationStatus(offering.confirmation_mode);
  const holdSeconds = resolveHoldSeconds(input.holdSeconds, {
    tenantDefaultSeconds: settings.default_hold_seconds,
    tenantMaxSeconds: settings.max_hold_seconds
  });

  // Lazy reclaim BEFORE the savepoint: an elapsed hold on the target units must
  // not stand in the way of a live claim, and expiring it is a fact that stays
  // true even when the claim that follows is refused.
  const reclaimed = await reclaimExpiredHolds(
    tx,
    ctx.tenantId,
    resourceIds,
    window.kind === "time"
      ? {
          kind: "time",
          fromMs: window.occupiedFromMs,
          toMs: window.occupiedToMs
        }
      : {
          kind: "stay",
          fromDate: window.checkInDate,
          toDate: window.checkOutDate
        },
    undefined,
    ctx.correlationId
  );

  if (reclaimed.expired > 0) {
    await recordAuditEvent(tx, {
      tenantId: ctx.tenantId,
      moduleKey: BOOKING_MODULE_KEY,
      action: BOOKING_AUDIT_EVENTS.reservationExpired.action,
      resourceType: "booking_reservation",
      severity: BOOKING_AUDIT_EVENTS.reservationExpired.severity,
      message: `${reclaimed.expired} elapsed hold(s) were expired to make room for a new claim.`,
      attributes: {
        expiredCount: reclaimed.expired,
        releasedAllocations: reclaimed.releasedAllocations,
        trigger: "lazy_reclaim"
      },
      ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
    });
  }

  for (
    let attempt = 0;
    attempt <= ALLOCATOR_LIMITS.maxDeadlockRetries;
    attempt += 1
  ) {
    const savepoint = `booking_place_hold_${attempt}`;

    await tx.unsafe(`SAVEPOINT ${savepoint}`);

    // Once the savepoint is released the claim has WON; what follows (audit, the
    // outbox) is not part of it, and a failure there must surface as itself, not
    // as "no such savepoint" from a second rollback.
    let released = false;

    try {
      const written = await writeClaim(
        tx,
        ctx,
        input,
        offering,
        resourceIds,
        window,
        status,
        holdSeconds,
        settings,
        options.replaces
      );

      await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);
      released = true;

      await recordAuditEvent(tx, {
        tenantId: ctx.tenantId,
        ...(ctx.actorTenantUserId
          ? { actorTenantUserId: ctx.actorTenantUserId }
          : {}),
        moduleKey: BOOKING_MODULE_KEY,
        action: BOOKING_AUDIT_EVENTS.reservationCreated.action,
        resourceType: "booking_reservation",
        resourceId: written.reservationId,
        severity: BOOKING_AUDIT_EVENTS.reservationCreated.severity,
        message: `Reservation ${written.reservationNo} was created as ${status}.`,
        attributes: {
          status,
          offeringId: offering.id,
          resourceIds: [
            ...new Set(written.units.map((unit) => unit.resourceId))
          ],
          quantity: input.quantity,
          startsAt: window.startsIso,
          endsAt: window.endsIso,
          holdExpiresAt: written.holdExpiresAt,
          ...(window.kind === "stay"
            ? {
                checkInDate: window.checkInDate,
                checkOutDate: window.checkOutDate,
                nights: window.nights,
                timezone: window.timezone
              }
            : {})
        },
        ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
      });

      await publishPlacementEvents(tx, ctx, written, status, options.replaces);

      return {
        outcome: "ok",
        reservation: {
          reservationId: written.reservationId,
          reservationNo: written.reservationNo,
          lineageId: written.lineageId,
          status,
          holdExpiresAt: written.holdExpiresAt,
          offeringId: offering.id,
          startsAt: window.startsIso,
          endsAt: window.endsIso,
          occupiedFrom:
            window.kind === "time"
              ? new Date(window.occupiedFromMs).toISOString()
              : null,
          occupiedTo:
            window.kind === "time"
              ? new Date(window.occupiedToMs).toISOString()
              : null,
          ...(window.kind === "stay"
            ? {
                stay: {
                  checkInDate: window.checkInDate,
                  checkOutDate: window.checkOutDate,
                  nights: window.nights,
                  timezone: window.timezone
                }
              }
            : {}),
          partySize: input.partySize,
          quantity: input.quantity,
          units: written.units
        }
      };
    } catch (error) {
      if (released) {
        throw error;
      }

      // Always back out to the savepoint: it drops every row this attempt wrote
      // and releases the locks it took, and makes the transaction usable again.
      await tx.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);

      if (isDeadlock(error)) {
        if (attempt === ALLOCATOR_LIMITS.maxDeadlockRetries) {
          return refused(
            "CONTENTION_RETRY",
            "The slot is being contended; please retry."
          );
        }

        await sleep(retryDelayMs(attempt));
        continue;
      }

      const outcome = refusalFor(error);

      if (outcome) {
        return outcome;
      }

      throw error;
    }
  }

  // Unreachable: the loop returns or throws on every path.
  return refused(
    "CONTENTION_RETRY",
    "The slot is being contended; please retry."
  );
}
