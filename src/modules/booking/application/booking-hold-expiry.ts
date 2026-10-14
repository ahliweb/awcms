/**
 * Hold expiry for `booking` (Issue #939, ADR-0131; docs/awcms/booking.md
 * section 5.1): the ONE primitive that turns an elapsed hold into an `expired`
 * reservation with its allocations released, and the two ways it is reached.
 *
 * ## Two cooperating parts, because a constraint cannot read a clock
 *
 * An exclusion constraint tests live rows; it cannot know that a row's hold has
 * run out. So expiry has two entry points that share one primitive:
 *
 *   1. **The reaper** (`expireDueHolds`, run per tenant by
 *      `booking:holds:expire`, every minute): finds elapsed holds, oldest first,
 *      under `FOR UPDATE SKIP LOCKED`, in a bounded batch.
 *   2. **Lazy reclaim** (`reclaimExpiredHolds`, called by the allocator BEFORE it
 *      inserts): finds the elapsed holds whose live allocations overlap the
 *      claim being placed and expires them in the same transaction, under the
 *      reservation row lock.
 *
 * **Correctness depends on (2) and never on (1).** With the reaper stopped, a
 * late claim still finds the unit free: the allocator reclaims the elapsed hold
 * on exactly the units it is about to claim. The reaper is housekeeping -- it
 * keeps `held` rows from piling up and keeps the history honest for holds
 * nobody ever tried to claim over -- and its health is observable
 * (`runReconciliation` reports a hold past expiry beyond a grace as a stuck job).
 *
 * ## The DATABASE clock decides
 *
 * "Elapsed" is `hold_expires_at <= clock_timestamp()`, evaluated by PostgreSQL in
 * the same statement that locks the row. The `held -> expired` trigger of
 * `sql/180` checks the same predicate a second time, so no application clock
 * -- and no bug here -- can expire a hold early.
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
 *   * Lock order: lazy reclaim locks in `reservation id` order, so two
 *     reclaimers of overlapping holds cannot wait on each other in a cycle; the
 *     reaper never waits (`SKIP LOCKED`).
 *
 * Every write names `tenant_id` AND runs under RLS FORCE.
 */
type Sql = Bun.SQL;

export type ExpiryTrigger = "reaper" | "lazy_reclaim";

export type ExpiryOutcome = {
  /** Holds moved `held -> expired`. */
  expired: number;
  /** Live allocations released with `released_reason = 'expired'`. */
  releasedAllocations: number;
};

export const NOTHING_EXPIRED: ExpiryOutcome = {
  expired: 0,
  releasedAllocations: 0
};

/** A batch ceiling for the reaper; the job loops until a pass finds nothing. */
export const EXPIRY_BATCH_LIMIT = 200;

/** Elapsed holds that overlap one claim: bounded, an interval cannot overlap more holds than it has units. */
const RECLAIM_LIMIT = 500;

/** The occupied range a claim is about to take, in epoch milliseconds. */
export type ReclaimWindow = {
  kind: "time";
  fromMs: number;
  toMs: number;
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
 */
async function applyExpiry(
  tx: Sql,
  tenantId: string,
  ids: readonly string[],
  trigger: ExpiryTrigger
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
           (SELECT count(*) FROM history)::int AS history
  `) as { expired: number; released: number; history: number }[];
  const row = rows[0]!;

  return {
    expired: Number(row.expired),
    releasedAllocations: Number(row.released)
  };
}

/**
 * The reaper's pass for one tenant: expires up to `limit` elapsed holds, oldest
 * first. `SKIP LOCKED`, so it never waits on (and so never deadlocks with) a
 * request that is confirming, cancelling or reclaiming the same hold: such a
 * hold is simply left for the next pass.
 */
export async function expireDueHolds(
  tx: Sql,
  tenantId: string,
  limit: number = EXPIRY_BATCH_LIMIT
): Promise<ExpiryOutcome> {
  const bounded = Math.max(1, Math.min(Math.floor(limit), 1000));
  const locked = (await tx`
    SELECT r.id
    FROM awcms_booking_reservations r
    WHERE r.tenant_id = ${tenantId}
      AND r.status = 'held'
      AND r.hold_expires_at <= clock_timestamp()
    ORDER BY r.hold_expires_at, r.id
    LIMIT ${bounded}
    FOR UPDATE OF r SKIP LOCKED
  `) as { id: string }[];

  return applyExpiry(
    tx,
    tenantId,
    locked.map((row) => row.id),
    "reaper"
  );
}

/**
 * Lazy reclaim: expires the elapsed holds whose LIVE allocations on
 * `resourceIds` overlap `window`, so the claim that follows does not collide
 * with a row whose hold has already run out. Waits for the row lock (a
 * concurrent confirm/cancel/reaper settles first, then the re-check decides),
 * in `reservation id` order.
 *
 * Scoped to the claim on purpose: it expires only what stands in the way, so a
 * busy resource does not turn every new hold into a sweep of the whole tenant.
 */
export async function reclaimExpiredHolds(
  tx: Sql,
  tenantId: string,
  resourceIds: readonly string[],
  window: ReclaimWindow
): Promise<ExpiryOutcome> {
  if (resourceIds.length === 0) {
    return NOTHING_EXPIRED;
  }

  const resources = asList(resourceIds);
  const fromIso = new Date(window.fromMs).toISOString();
  const toIso = new Date(window.toMs).toISOString();
  const locked = (await tx`
    SELECT r.id
    FROM awcms_booking_reservations r
    WHERE r.tenant_id = ${tenantId}
      AND r.status = 'held'
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
    LIMIT ${RECLAIM_LIMIT}
    FOR UPDATE OF r
  `) as { id: string }[];

  return applyExpiry(
    tx,
    tenantId,
    locked.map((row) => row.id),
    "lazy_reclaim"
  );
}

/**
 * Read-only backlog count for `--dry-run`: elapsed holds the next pass would
 * expire. Per tenant and under RLS, like every other read here.
 */
export async function countDueHolds(
  tx: Sql,
  tenantId: string
): Promise<number> {
  const rows = (await tx`
    SELECT count(*)::int AS due
    FROM awcms_booking_reservations
    WHERE tenant_id = ${tenantId}
      AND status = 'held'
      AND hold_expires_at <= clock_timestamp()
  `) as { due: number }[];

  return Number(rows[0]?.due ?? 0);
}
