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
 *   * the offering and the resources exist, are active and are in slot mode;
 *   * the party fits the offering, and the pool has enough units at all;
 *   * the interval is DERIVED from the offering (the server owns the interval,
 *     booking.md section 9: a client names a start, never an end or a buffer);
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
import {
  creationEventKinds,
  initialReservationStatus
} from "../domain/booking-reservation-state";
import {
  ContentionError,
  SlotUnavailableError,
  claimUnits,
  type ClaimedUnit
} from "./booking-allocator";
import { reclaimExpiredHolds } from "./booking-hold-expiry";

type Sql = Bun.SQL;

export type PlaceHoldContext = {
  tenantId: string;
  /** The acting tenant user, for the stamps and the audit row; `null` for a system caller. */
  actorTenantUserId: string | null;
  correlationId?: string;
};

export type PlacedReservation = {
  reservationId: string;
  reservationNo: string;
  status: "held" | "confirmed";
  /** `null` for an immediately confirmed reservation. */
  holdExpiresAt: string | null;
  offeringId: string;
  startsAt: string;
  endsAt: string;
  occupiedFrom: string;
  occupiedTo: string;
  partySize: number;
  quantity: number;
  units: ClaimedUnit[];
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
  min_party: number;
  max_party: number;
  confirmation_mode: "immediate" | "hold_then_confirm";
};

type ResourceRow = {
  id: string;
  booking_mode: "slot" | "stay";
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
           cleanup_seconds, min_party, max_party, confirmation_mode
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
      SELECT id, booking_mode
      FROM awcms_booking_resources
      WHERE tenant_id = ${tenantId} AND id = ${input.resourceId}
        AND deleted_at IS NULL AND status = 'active'
    `) as ResourceRow[];
  }

  return (await tx`
    SELECT r.id, r.booking_mode
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
 * both read "one below the cap" and both pass. The lock is a transaction-scoped
 * advisory lock keyed on the tenant, taken only when a cap is configured, so a
 * tenant without caps pays nothing and no tenant's holds wait on another's.
 * Elapsed holds do not count: they are about to be reclaimed.
 */
async function enforceHoldCaps(
  tx: Sql,
  tenantId: string,
  customerRef: string | null,
  settings: SettingsRow
): Promise<void> {
  const tenantCap = settings.max_active_holds_per_tenant;
  const customerCap =
    customerRef === null ? null : settings.max_active_holds_per_customer;

  if (tenantCap === null && customerCap === null) {
    return;
  }

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

  if (tenantCap !== null && Number(row.tenant_holds) >= tenantCap) {
    throw new PlacementRefusedError(
      "HOLD_LIMIT_EXCEEDED",
      "The tenant already has the maximum number of active holds."
    );
  }

  if (customerCap !== null && Number(row.customer_holds) >= customerCap) {
    throw new PlacementRefusedError(
      "HOLD_LIMIT_EXCEEDED",
      "This customer already has the maximum number of active holds."
    );
  }
}

type WriteResult = {
  reservationId: string;
  reservationNo: string;
  holdExpiresAt: string | null;
  units: ClaimedUnit[];
};

/** The writes of one attempt. Runs inside the savepoint. */
async function writeClaim(
  tx: Sql,
  ctx: PlaceHoldContext,
  input: PlaceHoldInput,
  offering: OfferingRow,
  resourceIds: readonly string[],
  window: { startsIso: string; endsIso: string },
  status: "held" | "confirmed",
  holdSeconds: number,
  settings: SettingsRow
): Promise<WriteResult> {
  if (status === "held") {
    await enforceHoldCaps(
      tx,
      ctx.tenantId,
      input.externalCustomerRef ?? null,
      settings
    );
  }

  const reservations = (await tx`
    INSERT INTO awcms_booking_reservations
      (tenant_id, status, external_customer_ref, party_size, starts_at, ends_at,
       hold_expires_at, source, external_ref_type, external_ref, customer_note,
       created_by, status_changed_by)
    VALUES (
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
    RETURNING id, reservation_no, hold_expires_at
  `) as {
    id: string;
    reservation_no: string;
    hold_expires_at: Date | null;
  }[];
  const reservation = reservations[0]!;

  const items = (await tx`
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
  `) as { id: string }[];

  const units = await claimUnits(tx, {
    kind: "time",
    tenantId: ctx.tenantId,
    itemId: items[0]!.id,
    resourceIds,
    quantity: input.quantity
  });

  const kinds = creationEventKinds(offering.confirmation_mode);
  const detail = {
    offeringId: offering.id,
    quantity: input.quantity,
    startsAt: window.startsIso,
    endsAt: window.endsIso,
    resourceIds: [...new Set(units.map((unit) => unit.resourceId))]
  };

  for (const [index, kind] of kinds.entries()) {
    await tx`
      INSERT INTO awcms_booking_reservation_events
        (tenant_id, reservation_id, seq, kind, from_status, to_status,
         actor_user_id, correlation_id, detail)
      VALUES (
        ${ctx.tenantId}, ${reservation.id}, ${index + 1}, ${kind}, NULL,
        ${status}, ${ctx.actorTenantUserId}, ${ctx.correlationId ?? null},
        ${detail}::jsonb
      )
    `;
  }

  return {
    reservationId: reservation.id,
    reservationNo: reservation.reservation_no,
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

/**
 * Places a hold (or, for an `immediate` offering, a confirmed reservation) on
 * `input.quantity` units of the target resource or pool at `input.startsAtMs`.
 *
 * MUST run inside the caller's tenant transaction (`withTenant*`), which owns
 * COMMIT/ROLLBACK. Returns a refusal as a value; throws only for defects.
 */
export async function placeHold(
  tx: Sql,
  ctx: PlaceHoldContext,
  input: PlaceHoldInput
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

  if (
    offering.granularity !== "time" ||
    resources.some((resource) => resource.booking_mode !== "slot")
  ) {
    return refused(
      "BOOKING_MODE_MISMATCH",
      "This claim places a slot hold: use a time offering on slot resources."
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

  const slot = deriveSlotWindow({
    startsAtMs: input.startsAtMs,
    durationSeconds: offering.duration_seconds!,
    setupSeconds: offering.setup_seconds!,
    cleanupSeconds: offering.cleanup_seconds!
  });

  if (!slot) {
    return {
      outcome: "invalid",
      errors: [{ field: "startsAt", message: "startsAt cannot form a slot." }]
    };
  }

  const settings = await loadSettings(tx, ctx.tenantId);
  const status = initialReservationStatus(offering.confirmation_mode);
  const holdSeconds = resolveHoldSeconds(input.holdSeconds, {
    tenantDefaultSeconds: settings.default_hold_seconds,
    tenantMaxSeconds: settings.max_hold_seconds
  });
  const startsIso = new Date(slot.startsAtMs).toISOString();
  const endsIso = new Date(slot.endsAtMs).toISOString();

  // Lazy reclaim BEFORE the savepoint: an elapsed hold on the target units must
  // not stand in the way of a live claim, and expiring it is a fact that stays
  // true even when the claim that follows is refused.
  const reclaimed = await reclaimExpiredHolds(tx, ctx.tenantId, resourceIds, {
    kind: "time",
    fromMs: slot.occupiedFromMs,
    toMs: slot.occupiedToMs
  });

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

    try {
      const written = await writeClaim(
        tx,
        ctx,
        input,
        offering,
        resourceIds,
        { startsIso, endsIso },
        status,
        holdSeconds,
        settings
      );

      await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);

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
          startsAt: startsIso,
          endsAt: endsIso,
          holdExpiresAt: written.holdExpiresAt
        },
        ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
      });

      return {
        outcome: "ok",
        reservation: {
          reservationId: written.reservationId,
          reservationNo: written.reservationNo,
          status,
          holdExpiresAt: written.holdExpiresAt,
          offeringId: offering.id,
          startsAt: startsIso,
          endsAt: endsIso,
          occupiedFrom: new Date(slot.occupiedFromMs).toISOString(),
          occupiedTo: new Date(slot.occupiedToMs).toISOString(),
          partySize: input.partySize,
          quantity: input.quantity,
          units: written.units
        }
      };
    } catch (error) {
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
