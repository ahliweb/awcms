/**
 * Hold expiry for `booking` (Issue #939, ADR-0131; docs/awcms/booking.md
 * section 5.1): turning an elapsed hold into an `expired` reservation with its
 * allocations released and an `expired` history row, reached in two ways.
 *
 * ## Two cooperating parts, because a constraint cannot read a clock
 *
 * An exclusion constraint tests live rows; it cannot know that a row's hold has
 * run out. So expiry has two entry points:
 *
 *   1. **The reaper** (`expireDueHolds`, run per tenant by
 *      `booking:holds:expire`, every minute, AS `awcms_worker`): calls the narrow
 *      SECURITY DEFINER function `awcms_booking_expire_due_holds` of `sql/200`,
 *      which finds elapsed holds, oldest first, under `FOR UPDATE SKIP LOCKED`,
 *      in a bounded batch. The worker holds no privilege on the booking tables;
 *      the function can only expire an elapsed hold (see the header of
 *      `sql/200` for why it is a function and not a GRANT).
 *   2. **Lazy reclaim** (`reclaimExpiredHolds`, called by the allocator BEFORE it
 *      inserts, AS the application role inside the claim's transaction): finds
 *      the elapsed holds whose live allocations overlap the claim being placed
 *      and expires them in the same transaction, under the reservation row lock.
 *      The application role already holds every privilege this needs.
 *
 * **Correctness depends on (2) and never on (1).** With the reaper stopped, a
 * late claim still finds the unit free: the allocator reclaims the elapsed hold
 * on exactly the units it is about to claim. The reaper is housekeeping -- it
 * keeps `held` rows from piling up and keeps the history honest for holds
 * nobody ever tried to claim over -- and its health is observable
 * (`runReconciliation` reports a hold past expiry beyond a grace as a stuck job).
 *
 * ## Stay holds expire the same way (Issue #940, ADR-0135)
 *
 * A hold on a stay carries the same `hold_expires_at` and releases through the
 * same item join, so `sql/200` and `applyExpiry` need no stay-specific code: they
 * release every live row of the reservation's items, whatever their granularity.
 * Only the lazy-reclaim PROBE differs -- it finds the elapsed holds whose live
 * rows overlap the claim, by `tstzrange` overlap for a slot and by `daterange`
 * overlap for a stay or a block (`ReclaimWindow`). A block's own rows have no
 * item and no hold, so neither entry point ever touches them.
 *
 * ## Two implementations of one end state
 *
 * (1) is SQL inside `sql/200` (a worker cannot run application SQL against the
 * tables) and (2) is `applyExpiry` below. They are held to the same end state --
 * reservation `expired`, live allocations released with reason `expired`, one
 * `expired` history row -- by `booking-concurrency.integration.test.ts`, which
 * runs both and compares the rows they leave; only the `trigger` key of the
 * history detail differs (`reaper` / `lazy_reclaim`).
 *
 * ## The DATABASE clock decides
 *
 * "Elapsed" is `hold_expires_at <= clock_timestamp()`, evaluated by PostgreSQL in
 * the same statement that expires the row. The `held -> expired` trigger of
 * `sql/180` checks the same predicate a second time, so no application clock
 * -- and no bug here -- can expire a hold early. The lock queries also carry the
 * redundant `hold_expires_at <= statement_timestamp()`: it is stable, so the
 * planner can range-scan `awcms_booking_reservations_hold_expiry_idx`, and it is
 * never looser than the authority (`statement_timestamp() <= clock_timestamp()`).
 *
 * ## Races
 *
 *   * Reaper vs lazy reclaim vs a second lazy reclaim of the same hold: all lock
 *     the reservation row (`FOR UPDATE`) and re-evaluate "still held and still
 *     elapsed" after the wait (READ COMMITTED re-check), so exactly one of them
 *     expires it and the others find it already `expired` and skip it.
 *   * A confirm racing the expiry: a confirm that lands before the expiry
 *     commits wins and the hold is no longer `held` (skipped here); a confirm
 *     that lands after is `HOLD_EXPIRED` by the trigger. Never a `confirmed` row
 *     without live allocations.
 *   * Lock order: lazy reclaim locks in strictly ascending `reservation id`
 *     order across its batches (a keyset cursor), so two reclaimers of
 *     overlapping holds cannot wait on each other in a cycle; the reaper never
 *     waits (`SKIP LOCKED`).
 *
 * Every write names `tenant_id` AND runs under RLS FORCE.
 */
import {
  databaseNowIso,
  emitReservationEventFromFacts,
  emitReservationEvents
} from "./booking-event-emit";
import {
  parseReservationFacts,
  type ReservationFacts
} from "../domain/booking-reservation-events";

type Sql = Bun.SQL;

export type ExpiryTrigger = "reaper" | "lazy_reclaim";

export type ExpiryOutcome = {
  /** Holds moved `held -> expired`. */
  expired: number;
  /** Live allocations released with `released_reason = 'expired'`. */
  releasedAllocations: number;
};

/**
 * What the REAPER learns about each hold it expired: its non-personal event
 * facts, read by the sweep's own function (`sql/209`) because the worker may not
 * read the booking tables. The job publishes the `expired` event from them.
 */
export type ReaperOutcome = ExpiryOutcome & {
  expiredReservations: readonly ReservationFacts[];
};

export const NOTHING_EXPIRED: ExpiryOutcome = {
  expired: 0,
  releasedAllocations: 0
};

/** A batch ceiling for the reaper; the job loops until a pass finds nothing. */
export const EXPIRY_BATCH_LIMIT = 200;

/**
 * Elapsed holds lazy reclaim locks and expires per batch. NOT a ceiling on the
 * work: a claim's occupied range can overlap many non-overlapping holds (a pool
 * has many units, and one unit has many adjacent slots), so reclaim loops over
 * batches until none is left. It exists to keep each statement and each lock
 * set small.
 */
export const RECLAIM_BATCH_LIMIT = 100;

/** The nil uuid: sorts before every other, the start of the keyset cursor. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * What a claim is about to take: an occupied range in epoch milliseconds (a
 * slot), or a half-open night range of local dates (a stay or a block, Issue
 * #940). The reclaim probes the matching kind of live allocation row, so a slot
 * claim never reclaims a stay hold and the reverse.
 */
export type ReclaimWindow =
  | { kind: "time"; fromMs: number; toMs: number }
  | {
      kind: "stay";
      fromDate: string;
      toDate: string;
      /**
       * Limit the probe to the live rows of ONE unit (a block of a single unit
       * reclaims only the holds on that unit). Absent = every unit of the
       * resources (a stay claim, or a resource-wide block).
       */
      unitId?: string;
    };

function asList(ids: readonly string[]): string {
  // Bun.SQL does not bind a JS array as a Postgres array; the ids are uuids
  // (no comma), sent as one text and unpacked in SQL.
  return ids.join(",");
}

/**
 * Expires the reservations in `ids`, which the CALLER has already locked
 * `FOR UPDATE`. One statement: the reservation, its allocations and its
 * `expired` history row move together or not at all.
 *
 * This is the application-role twin of `awcms_booking_expire_due_holds`
 * (`sql/200`); keep the two statements in step (the integration test compares
 * the rows they leave).
 */
async function applyExpiry(
  tx: Sql,
  tenantId: string,
  ids: readonly string[],
  trigger: ExpiryTrigger,
  correlationId: string | undefined
): Promise<ExpiryOutcome> {
  if (ids.length === 0) {
    return NOTHING_EXPIRED;
  }

  const list = asList(ids);
  const rows = (await tx`
    WITH due AS (
      SELECT r.id, r.hold_expires_at
      FROM awcms_booking_reservations r
      WHERE r.tenant_id = ${tenantId}
        AND r.id = ANY(string_to_array(${list}::text, ',')::uuid[])
        AND r.status = 'held'
        AND r.hold_expires_at <= clock_timestamp()
    ), expired AS (
      UPDATE awcms_booking_reservations r
      SET status = 'expired',
          status_changed_at = clock_timestamp(),
          status_changed_by = NULL,
          updated_at = clock_timestamp()
      FROM due
      WHERE r.tenant_id = ${tenantId} AND r.id = due.id
      RETURNING r.id, due.hold_expires_at
    ), released AS (
      UPDATE awcms_booking_resource_allocations a
      SET released_at = clock_timestamp(), released_reason = 'expired'
      FROM awcms_booking_reservation_items i, expired e
      WHERE a.tenant_id = ${tenantId}
        AND i.tenant_id = ${tenantId}
        AND i.reservation_id = e.id
        AND a.item_id = i.id
        AND a.released_at IS NULL
      RETURNING a.id, i.reservation_id
    ), history AS (
      INSERT INTO awcms_booking_reservation_events
        (tenant_id, reservation_id, seq, kind, from_status, to_status, detail)
      SELECT ${tenantId}, e.id,
             (SELECT coalesce(max(ev.seq), 0) + 1
              FROM awcms_booking_reservation_events ev
              WHERE ev.tenant_id = ${tenantId} AND ev.reservation_id = e.id),
             'expired', 'held', 'expired',
             jsonb_build_object(
               'holdExpiredAt', e.hold_expires_at,
               'trigger', ${trigger}::text,
               'releasedAllocations',
               (SELECT count(*) FROM released rl WHERE rl.reservation_id = e.id)
             )
      FROM expired e
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM expired)::int AS expired,
           (SELECT count(*) FROM released)::int AS released,
           (SELECT count(*) FROM history)::int AS history,
           (SELECT string_agg(id::text, ',') FROM expired) AS expired_ids
  `) as {
    expired: number;
    released: number;
    history: number;
    expired_ids: string | null;
  }[];
  const row = rows[0]!;

  // The `expired` domain event, in this same transaction: a hold that expired
  // because a claim wanted its units (lazy reclaim) is as expired as one the
  // sweep found, and a consumer cancelling a pending order needs to hear both.
  if (row.expired_ids) {
    const occurredAt = await databaseNowIso(tx);

    for (const id of row.expired_ids.split(",")) {
      await emitReservationEvents(tx, tenantId, id, [
        {
          kind: "expired",
          status: "expired",
          previousStatus: "held",
          occurredAt,
          correlationId: correlationId ?? null
        }
      ]);
    }
  }

  return {
    expired: Number(row.expired),
    releasedAllocations: Number(row.released)
  };
}

/**
 * The reaper's pass for one tenant: expires up to `limit` elapsed holds, oldest
 * first, through `awcms_booking_expire_due_holds` (`sql/200`). `SKIP LOCKED`, so
 * it never waits on (and so never deadlocks with) a request that is confirming,
 * cancelling or reclaiming the same hold: such a hold is simply left for the
 * next pass.
 *
 * Runs as `awcms_worker` under a per-tenant context (`withTenantOrThrow`); the
 * function refuses a tenant that is not the session's. `limit` is clamped to
 * 1..1000 by the function itself.
 */
export async function expireDueHolds(
  tx: Sql,
  tenantId: string,
  limit: number = EXPIRY_BATCH_LIMIT
): Promise<ReaperOutcome> {
  const bounded = Math.max(1, Math.min(Math.floor(limit), 1000));
  const rows = (await tx`
    SELECT expired_reservation_id, released_allocations, event_facts
    FROM awcms_booking_expire_due_holds(${tenantId}::uuid, ${bounded}::integer)
  `) as {
    expired_reservation_id: string;
    released_allocations: number;
    event_facts: unknown;
  }[];

  return {
    expired: rows.length,
    releasedAllocations: rows.reduce(
      (sum, row) => sum + Number(row.released_allocations),
      0
    ),
    expiredReservations: rows.map((row) =>
      parseReservationFacts(row.event_facts)
    )
  };
}

/**
 * Publishes the `expired` event for every hold the sweep expired. A plain
 * outbox write in the sweep's own tenant transaction (the worker may use the
 * outbox, `sql/022`), so a pass that fails after expiring rolls the expiry and
 * its events back together and the next pass finds the same holds again.
 */
export async function emitReaperExpiredEvents(
  tx: Sql,
  tenantId: string,
  outcome: ReaperOutcome,
  correlationId: string
): Promise<void> {
  if (outcome.expiredReservations.length === 0) {
    return;
  }

  const occurredAt = await databaseNowIso(tx);

  for (const facts of outcome.expiredReservations) {
    await emitReservationEventFromFacts(tx, tenantId, facts, {
      kind: "expired",
      status: "expired",
      previousStatus: "held",
      occurredAt,
      correlationId
    });
  }
}

/**
 * One batch of the elapsed holds whose LIVE rows overlap `window`, locked
 * `FOR UPDATE` in ascending id order after `cursor`. Two statements, not one
 * `OR`: each probes the live rows of its own granularity in the shape of its own
 * exclusion constraint (`tstzrange` overlap for a slot, `daterange` overlap for
 * a stay or a block), so the planner has a plain predicate to work with.
 */
async function lockElapsedHoldsOver(
  tx: Sql,
  tenantId: string,
  resources: string,
  window: ReclaimWindow,
  cursor: string,
  batch: number
): Promise<{ id: string }[]> {
  if (window.kind === "stay") {
    return (await tx`
      SELECT r.id
      FROM awcms_booking_reservations r
      WHERE r.tenant_id = ${tenantId}
        AND r.id > ${cursor}::uuid
        AND r.status = 'held'
        AND r.hold_expires_at <= statement_timestamp()
        AND r.hold_expires_at <= clock_timestamp()
        AND EXISTS (
          SELECT 1
          FROM awcms_booking_reservation_items i
          JOIN awcms_booking_resource_allocations a
            ON a.tenant_id = i.tenant_id AND a.item_id = i.id
          WHERE i.tenant_id = r.tenant_id
            AND i.reservation_id = r.id
            AND a.released_at IS NULL
            AND a.granularity = 'stay'
            AND a.resource_id = ANY(string_to_array(${resources}::text, ',')::uuid[])
            AND (${window.unitId ?? null}::uuid IS NULL
                 OR a.resource_unit_id = ${window.unitId ?? null}::uuid)
            AND daterange(a.stay_from, a.stay_to, '[)')
                && daterange(${window.fromDate}::date, ${window.toDate}::date, '[)')
        )
      ORDER BY r.id
      LIMIT ${batch}
      FOR UPDATE OF r
    `) as { id: string }[];
  }

  const fromIso = new Date(window.fromMs).toISOString();
  const toIso = new Date(window.toMs).toISOString();

  return (await tx`
    SELECT r.id
    FROM awcms_booking_reservations r
    WHERE r.tenant_id = ${tenantId}
      AND r.id > ${cursor}::uuid
      AND r.status = 'held'
      AND r.hold_expires_at <= statement_timestamp()
      AND r.hold_expires_at <= clock_timestamp()
      AND EXISTS (
        SELECT 1
        FROM awcms_booking_reservation_items i
        JOIN awcms_booking_resource_allocations a
          ON a.tenant_id = i.tenant_id AND a.item_id = i.id
        WHERE i.tenant_id = r.tenant_id
          AND i.reservation_id = r.id
          AND a.released_at IS NULL
          AND a.granularity = 'time'
          AND a.resource_id = ANY(string_to_array(${resources}::text, ',')::uuid[])
          AND tstzrange(a.occupied_from, a.occupied_to, '[)')
              && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz, '[)')
      )
    ORDER BY r.id
    LIMIT ${batch}
    FOR UPDATE OF r
  `) as { id: string }[];
}

/**
 * Lazy reclaim: expires the elapsed holds whose LIVE allocations on
 * `resourceIds` overlap `window`, so the claim that follows does not collide
 * with a row whose hold has already run out. Waits for the row lock (a
 * concurrent confirm/cancel/reaper settles first, then the re-check decides).
 *
 * Scoped to the claim on purpose: it expires only what stands in the way, so a
 * busy resource does not turn every new hold into a sweep of the whole tenant.
 *
 * It works in batches of `batchLimit` and keeps going until a batch locks
 * nothing -- never truncating. "Fewer rows than the limit" does NOT mean "done":
 * under READ COMMITTED a `LIMIT ... FOR UPDATE` that waited on a row another
 * transaction then changed drops that row without back-filling, so only an
 * EMPTY batch proves the set is exhausted. The batches advance a keyset cursor
 * (`r.id > last`), which both guarantees progress and keeps the locks in
 * strictly ascending id order across batches. `batchLimit` is injectable so a
 * test can exercise the loop without creating hundreds of holds.
 */
export async function reclaimExpiredHolds(
  tx: Sql,
  tenantId: string,
  resourceIds: readonly string[],
  window: ReclaimWindow,
  batchLimit: number = RECLAIM_BATCH_LIMIT,
  correlationId?: string
): Promise<ExpiryOutcome> {
  if (resourceIds.length === 0) {
    return NOTHING_EXPIRED;
  }

  const resources = asList(resourceIds);
  const batch = Math.max(1, Math.floor(batchLimit));
  let cursor = NIL_UUID;
  let expired = 0;
  let released = 0;

  for (;;) {
    const locked = await lockElapsedHoldsOver(
      tx,
      tenantId,
      resources,
      window,
      cursor,
      batch
    );

    if (locked.length === 0) {
      return { expired, releasedAllocations: released };
    }

    const outcome = await applyExpiry(
      tx,
      tenantId,
      locked.map((row) => row.id),
      "lazy_reclaim",
      correlationId
    );

    expired += outcome.expired;
    released += outcome.releasedAllocations;
    cursor = locked[locked.length - 1]!.id;
  }
}

/**
 * Staff-keyed lazy reclaim (Issue #949): expires the elapsed holds whose LIVE
 * staff assignment names one of `staffRefs` over `[fromMs, toMs)`, wherever
 * their resource is. A person's occupancy must not depend on the reaper: an
 * elapsed-but-unreaped hold on resource R1 would otherwise block the same person
 * on R2 until the next sweep. Same locking and expiry path as
 * `reclaimExpiredHolds`; the allocation release frees the assignment by trigger.
 */
export async function reclaimExpiredHoldsForStaff(
  tx: Sql,
  tenantId: string,
  staffRefs: readonly string[],
  fromMs: number,
  toMs: number,
  batchLimit: number = RECLAIM_BATCH_LIMIT,
  correlationId?: string
): Promise<ExpiryOutcome> {
  if (staffRefs.length === 0) {
    return NOTHING_EXPIRED;
  }

  const refs = tx.array([...staffRefs], "text");
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const batch = Math.max(1, Math.floor(batchLimit));
  let cursor = NIL_UUID;
  let expired = 0;
  let released = 0;

  for (;;) {
    const locked = (await tx`
      SELECT r.id
      FROM awcms_booking_reservations r
      WHERE r.tenant_id = ${tenantId}
        AND r.id > ${cursor}::uuid
        AND r.status = 'held'
        AND r.hold_expires_at <= statement_timestamp()
        AND r.hold_expires_at <= clock_timestamp()
        AND EXISTS (
          SELECT 1
          FROM awcms_booking_reservation_items i
          JOIN awcms_booking_staff_assignments s
            ON s.tenant_id = i.tenant_id AND s.item_id = i.id
          WHERE i.tenant_id = r.tenant_id
            AND i.reservation_id = r.id
            AND s.released_at IS NULL
            AND s.staff_ref = ANY(${refs}::text[])
            AND tstzrange(s.occupied_from, s.occupied_to, '[)')
                && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz, '[)')
        )
      ORDER BY r.id
      LIMIT ${batch}
      FOR UPDATE OF r
    `) as { id: string }[];

    if (locked.length === 0) {
      return { expired, releasedAllocations: released };
    }

    const outcome = await applyExpiry(
      tx,
      tenantId,
      locked.map((row) => row.id),
      "lazy_reclaim",
      correlationId
    );

    expired += outcome.expired;
    released += outcome.releasedAllocations;
    cursor = locked[locked.length - 1]!.id;
  }
}

/**
 * Read-only backlog count for `--dry-run`: elapsed holds the next pass would
 * expire. Through `awcms_booking_count_due_holds` (`sql/200`): the worker holds
 * no privilege on reservations, which carry the customer reference and the note.
 */
export async function countDueHolds(
  tx: Sql,
  tenantId: string
): Promise<number> {
  const rows = (await tx`
    SELECT awcms_booking_count_due_holds(${tenantId}::uuid) AS due
  `) as { due: number }[];

  return Number(rows[0]?.due ?? 0);
}
