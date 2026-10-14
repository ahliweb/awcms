/**
 * The `booking` allocator (Issue #939, ADR-0131; docs/awcms/booking.md section
 * 8.1): claims `k` capacity units for one reservation item, all-or-none, and is
 * correct under real concurrent transactions.
 *
 * ## What the guarantee is
 *
 * The database's exclusion constraint on `awcms_booking_resource_allocations`
 * (`sql/180`). Two live rows for one unit may not have overlapping occupied
 * ranges, whoever writes them. A second concurrent INSERT for a held unit BLOCKS
 * on the first writer's uncommitted row; when that writer commits, the second is
 * refused; when it rolls back, the second succeeds. This needs no application
 * lock, and it holds for a writer that never heard of this file.
 *
 * ## What this file adds
 *
 * A way to claim a unit without turning the refusal into a database error:
 *
 *   * `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. An exclusion violation is
 *     a conflict `DO NOTHING` absorbs, so a lost race is "no row returned", not
 *     an exception, and the transaction stays usable -- no savepoint per
 *     attempt. (PostgreSQL waits for an in-doubt concurrent row before deciding;
 *     `tests/integration/booking-concurrency.integration.test.ts` T3 proves it.)
 *   * The first free unit, in a deterministic order: the free units are READ
 *     first (a hint, never the authority) in `(resource.sort_order, resource.id,
 *     unit.ordinal)` order, and the claim attempts them in that order.
 *   * All-or-none for `k > 1`: a claim that cannot reach `k` units throws, and
 *     the caller's savepoint rolls back every row this call inserted. No partial
 *     allocation survives.
 *   * A fixed lock order (`resource_id` bytewise, then `ordinal`) for the units
 *     chosen together, so two writers claiming several units cannot wait on each
 *     other in a cycle. A residual deadlock (`40P01`) is the caller's to retry,
 *     bounded (`booking-hold-service.ts`).
 *
 * ## The hint can be stale, and that is fine
 *
 * The free-unit read sees committed rows only. A unit it lists as free may be
 * claimed a moment later (the INSERT then conflicts and the claim moves on); a
 * unit it hides was held by a COMMITTED row at that instant, which is a true
 * answer. A round that lost races re-reads, so a unit a concurrent writer
 * released in the meantime is found, bounded by `ALLOCATOR_LIMITS.maxRounds`.
 *
 * ## Expired holds
 *
 * The caller runs lazy reclaim (`booking-hold-expiry.ts`) BEFORE this: an
 * elapsed hold must not stand in the way of a live claim, and the constraint
 * cannot read a clock.
 *
 * ## Slots only, today
 *
 * This claims `granularity = 'time'` rows. Day-granularity stays and blocks
 * (Issue #940, ADR-0135) reuse this order, this loop and this absorption, and add
 * the `stay_from`/`stay_to` columns and the second constraint's probe; the
 * seam is `claimUnits`' `claim` argument, which is a union with one member now.
 */
import {
  ALLOCATOR_LIMITS,
  planAttempts,
  type UnitRef
} from "../domain/booking-allocation";

type Sql = Bun.SQL;

/** What the allocator is asked to claim. A union so stay mode (Issue #940) is a new member, not a new function. */
export type UnitClaim = {
  kind: "time";
  tenantId: string;
  /** The reservation item (its instants and buffer snapshot define the occupied range). */
  itemId: string;
  /** Candidate resources in PREFERENCE order (a single resource, or a pool's by `sort_order`). */
  resourceIds: readonly string[];
  /** Units to claim, 1..500. */
  quantity: number;
};

export type ClaimedUnit = {
  allocationId: string;
  resourceId: string;
  unitId: string;
};

/** Thrown inside the caller's savepoint when the claim cannot be completed; the savepoint rolls the partial rows back. */
export class SlotUnavailableError extends Error {
  readonly claimed: number;
  readonly wanted: number;

  constructor(claimed: number, wanted: number) {
    super(`booking: only ${claimed} of ${wanted} unit(s) could be claimed`);
    this.name = "SlotUnavailableError";
    this.claimed = claimed;
    this.wanted = wanted;
  }
}

/** Thrown when races kept re-opening the question for more than `maxRounds` rounds. Retryable by the caller. */
export class ContentionError extends Error {
  constructor() {
    super("booking: the claim kept losing races; retry");
    this.name = "ContentionError";
  }
}

type CandidateRow = {
  unit_id: string;
  resource_id: string;
  ordinal: number;
};

function asList(ids: readonly string[]): string {
  return ids.join(",");
}

/**
 * Free units for the item's occupied range, in preference order. A hint: it
 * sees committed rows only. The `NOT EXISTS` has the shape of the exclusion
 * constraint's own index (`resource_unit_id =`, `tstzrange(...) &&`, partial on
 * live time rows), so the planner probes that GiST index rather than scanning.
 */
async function readFreeUnits(
  tx: Sql,
  claim: UnitClaim,
  limit: number
): Promise<UnitRef[]> {
  const resources = asList(claim.resourceIds);
  const rows = (await tx`
    SELECT u.id AS unit_id, u.resource_id, u.ordinal
    FROM awcms_booking_reservation_items it
    JOIN awcms_booking_resources res
      ON res.tenant_id = it.tenant_id
     AND res.id = ANY(string_to_array(${resources}::text, ',')::uuid[])
    JOIN awcms_booking_resource_units u
      ON u.tenant_id = res.tenant_id AND u.resource_id = res.id
    WHERE it.tenant_id = ${claim.tenantId}
      AND it.id = ${claim.itemId}
      AND res.status = 'active' AND res.deleted_at IS NULL
      AND u.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM awcms_booking_resource_allocations a
        WHERE a.resource_unit_id = u.id
          AND a.released_at IS NULL
          AND a.granularity = 'time'
          AND tstzrange(a.occupied_from, a.occupied_to, '[)')
              && tstzrange(
                   it.starts_at - make_interval(secs => it.setup_seconds),
                   it.ends_at + make_interval(secs => it.cleanup_seconds),
                   '[)')
      )
    ORDER BY res.sort_order, res.id, u.ordinal
    LIMIT ${limit}
  `) as CandidateRow[];

  return rows.map((row) => ({
    resourceId: row.resource_id,
    unitId: row.unit_id,
    ordinal: Number(row.ordinal)
  }));
}

/**
 * One attempt to claim one unit. `ON CONFLICT DO NOTHING` (no conflict target:
 * an exclusion constraint can only be absorbed without one) returns no row when
 * the unit is held, however that came about. The occupied range is derived from
 * the ITEM row in SQL -- the same expression the `sql/180` allocation trigger
 * verifies -- so the application never recomputes it and cannot drift from it.
 */
async function tryClaimUnit(
  tx: Sql,
  claim: UnitClaim,
  unit: UnitRef
): Promise<string | null> {
  const rows = (await tx`
    INSERT INTO awcms_booking_resource_allocations
      (tenant_id, item_id, resource_id, resource_unit_id, granularity,
       starts_at, ends_at, occupied_from, occupied_to)
    SELECT it.tenant_id, it.id, ${unit.resourceId}, ${unit.unitId}, 'time',
           it.starts_at, it.ends_at,
           it.starts_at - make_interval(secs => it.setup_seconds),
           it.ends_at + make_interval(secs => it.cleanup_seconds)
    FROM awcms_booking_reservation_items it
    WHERE it.tenant_id = ${claim.tenantId} AND it.id = ${claim.itemId}
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

/**
 * Claims `claim.quantity` units. Returns them in the order they were won, or
 * throws `SlotUnavailableError` (no more free units) / `ContentionError` (the
 * claim lost too many races to settle). MUST run inside a savepoint owned by the
 * caller: on a throw the rows already inserted by THIS call are still in the
 * transaction until the savepoint rolls back.
 */
export async function claimUnits(
  tx: Sql,
  claim: UnitClaim
): Promise<ClaimedUnit[]> {
  if (
    !Number.isInteger(claim.quantity) ||
    claim.quantity < 1 ||
    claim.quantity > ALLOCATOR_LIMITS.maxUnitsPerClaim ||
    claim.resourceIds.length === 0
  ) {
    throw new RangeError("booking: a claim needs 1..500 units and a resource");
  }

  const won: ClaimedUnit[] = [];

  for (let round = 0; round < ALLOCATOR_LIMITS.maxRounds; round += 1) {
    const need = claim.quantity - won.length;
    const candidates = await readFreeUnits(
      tx,
      claim,
      need + ALLOCATOR_LIMITS.candidateSlack
    );

    if (candidates.length === 0) {
      // Nothing free in the committed state, and every row of ours is visible to
      // this read: the claim cannot be completed.
      throw new SlotUnavailableError(won.length, claim.quantity);
    }

    for (const unit of planAttempts(candidates, need)) {
      if (won.length === claim.quantity) {
        break;
      }

      const allocationId = await tryClaimUnit(tx, claim, unit);

      if (allocationId !== null) {
        won.push({
          allocationId,
          resourceId: unit.resourceId,
          unitId: unit.unitId
        });
      }
    }

    if (won.length === claim.quantity) {
      return won;
    }
  }

  throw new ContentionError();
}
