/**
 * The `booking` allocator (Issues #939 and #940, ADR-0131 and ADR-0135;
 * docs/awcms/booking.md section 8.1): claims `k` capacity units for one
 * reservation item, or the fixed units of a block, all-or-none, and is correct
 * under real concurrent transactions.
 *
 * ## What the guarantee is
 *
 * The database's exclusion constraints on `awcms_booking_resource_allocations`
 * (`sql/180`). Two live rows for one unit may not overlap -- in occupied range
 * (slots) or in night range (stays and blocks) -- whoever writes them. A second
 * concurrent INSERT for a held unit BLOCKS on the first writer's uncommitted row;
 * when that writer commits, the second is refused; when it rolls back, the second
 * succeeds. This needs no application lock, and it holds for a writer that never
 * heard of this file.
 *
 * ## What this file adds
 *
 * A way to claim a unit without turning the refusal into a database error:
 *
 *   * `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. An exclusion violation is
 *     a conflict `DO NOTHING` absorbs, so a lost race is "no row returned", not
 *     an exception, and the transaction stays usable -- no savepoint per
 *     attempt. (PostgreSQL waits for an in-doubt concurrent row before deciding;
 *     `tests/integration/booking-concurrency.integration.test.ts` T3 proves it,
 *     and `booking-stay.integration.test.ts` T9 proves it for the date range.)
 *   * The first free unit, in a deterministic order: the free units are READ
 *     first (a hint, never the authority) in `(resource.sort_order, resource.id,
 *     unit.ordinal)` order, and the claim attempts them in that order.
 *   * All-or-none for `k > 1`: a claim that cannot reach `k` units throws, and
 *     the caller's savepoint rolls back every row this call inserted. No partial
 *     allocation survives.
 *   * A fixed lock order (`resource_id` bytewise, then `ordinal`) for the units
 *     chosen together, so two writers claiming several units cannot wait on each
 *     other in a cycle. A residual deadlock (`40P01`) is the caller's to retry,
 *     bounded (`booking-hold-service.ts`, `booking-block-service.ts`).
 *
 * ## Three kinds of claim, one loop (Issue #940, ADR-0135)
 *
 * `UnitClaim` is a union and the loop is shared:
 *
 *   * `time` -- a slot: the item's occupied range, probed against live
 *     `granularity = 'time'` rows (the first exclusion constraint);
 *   * `stay` -- a night range: the half-open `daterange(check_in_date,
 *     check_out_date)` of the item, probed against live `granularity = 'stay'`
 *     rows (the second constraint). A stay stays on ONE unit for all its nights;
 *     `quantity` is how many units (rooms) are taken, each for the whole range;
 *   * `block` -- blocked nights: the units are FIXED (the named unit, or every
 *     unit of the resource), so there is nothing to choose and no free-unit read.
 *     It inserts one row per unit in `(resource_id, ordinal)` order under the
 *     SAME stay constraint, and a unit that is not won is a conflict for the
 *     whole block (all-or-none), never a partial block.
 *
 * Guest nights and blocked nights are rows of one table under one constraint, so
 * whichever of a booking and a block commits first wins the night and the other
 * receives the absorbed conflict. A block row has no item; the read that finds a
 * stay's free units sees it as taken without knowing it is a block.
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
 */
import {
  ALLOCATOR_LIMITS,
  insertionOrder,
  planAttempts,
  type UnitRef
} from "../domain/booking-allocation";

type Sql = Bun.SQL;

/** What the allocator is asked to claim: a slot, a stay, or blocked nights. A new kind of claim is a new member, not a new function. */
export type UnitClaim =
  | {
      kind: "time" | "stay";
      tenantId: string;
      /** The reservation item (its instants / dates and buffer snapshot define the claimed range). */
      itemId: string;
      /** Candidate resources in PREFERENCE order (a single resource, or a pool's by `sort_order`). */
      resourceIds: readonly string[];
      /** Units to claim, 1..500. */
      quantity: number;
    }
  | {
      kind: "block";
      tenantId: string;
      /** The block row that owns the nights (its dates and unit define the rows). */
      blockId: string;
      resourceId: string;
    };

/** The claim kinds that choose among free units (a block's units are fixed). */
type ChoosingClaim = Extract<UnitClaim, { kind: "time" | "stay" }>;
type BlockClaim = Extract<UnitClaim, { kind: "block" }>;

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

/** Thrown when a block could not take every one of its units: a live stay or another block holds a night of one. */
export class BlockConflictError extends Error {
  readonly claimed: number;
  readonly wanted: number;

  constructor(claimed: number, wanted: number) {
    super(`booking: a block won only ${claimed} of ${wanted} unit(s)`);
    this.name = "BlockConflictError";
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

function toUnitRefs(rows: CandidateRow[]): UnitRef[] {
  return rows.map((row) => ({
    resourceId: row.resource_id,
    unitId: row.unit_id,
    ordinal: Number(row.ordinal)
  }));
}

/**
 * Free units for the item's occupied range, in preference order. A hint: it
 * sees committed rows only. The `NOT EXISTS` has the shape of the exclusion
 * constraint's own index (`resource_unit_id =`, `tstzrange(...) &&`, partial on
 * live time rows), so the planner probes that GiST index rather than scanning.
 */
async function readFreeSlotUnits(
  tx: Sql,
  claim: ChoosingClaim,
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
        WHERE a.tenant_id = it.tenant_id
          AND a.resource_unit_id = u.id
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

  return toUnitRefs(rows);
}

/**
 * Free units for the item's nights, in preference order. The `NOT EXISTS` has
 * the shape of the SECOND exclusion constraint (`resource_unit_id =`,
 * `daterange(stay_from, stay_to, '[)') &&`, live stay rows), and it counts a
 * block's rows exactly like a guest's: a blocked night is a taken night.
 */
async function readFreeStayUnits(
  tx: Sql,
  claim: ChoosingClaim,
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
        WHERE a.tenant_id = it.tenant_id
          AND a.resource_unit_id = u.id
          AND a.released_at IS NULL
          AND a.granularity = 'stay'
          AND daterange(a.stay_from, a.stay_to, '[)')
              && daterange(it.check_in_date, it.check_out_date, '[)')
      )
    ORDER BY res.sort_order, res.id, u.ordinal
    LIMIT ${limit}
  `) as CandidateRow[];

  return toUnitRefs(rows);
}

/**
 * One attempt to claim one unit. `ON CONFLICT DO NOTHING` (no conflict target:
 * an exclusion constraint can only be absorbed without one) returns no row when
 * the unit is held, however that came about. The occupied range (or the night
 * range) is derived from the ITEM row in SQL -- the same expression the
 * `sql/180` / `sql/204` allocation trigger verifies -- so the application never
 * recomputes it and cannot drift from it.
 */
async function tryClaimSlotUnit(
  tx: Sql,
  claim: ChoosingClaim,
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

async function tryClaimStayUnit(
  tx: Sql,
  claim: ChoosingClaim,
  unit: UnitRef
): Promise<string | null> {
  const rows = (await tx`
    INSERT INTO awcms_booking_resource_allocations
      (tenant_id, item_id, resource_id, resource_unit_id, granularity,
       starts_at, ends_at, stay_from, stay_to)
    SELECT it.tenant_id, it.id, ${unit.resourceId}, ${unit.unitId}, 'stay',
           it.starts_at, it.ends_at, it.check_in_date, it.check_out_date
    FROM awcms_booking_reservation_items it
    WHERE it.tenant_id = ${claim.tenantId} AND it.id = ${claim.itemId}
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

/**
 * Claims `claim.quantity` units for a slot or a stay. Returns them in the order
 * they were won, or throws `SlotUnavailableError` (no more free units) /
 * `ContentionError` (the claim lost too many races to settle). MUST run inside a
 * savepoint owned by the caller: on a throw the rows already inserted by THIS
 * call are still in the transaction until the savepoint rolls back.
 */
async function claimChosenUnits(
  tx: Sql,
  claim: ChoosingClaim
): Promise<ClaimedUnit[]> {
  if (
    !Number.isInteger(claim.quantity) ||
    claim.quantity < 1 ||
    claim.quantity > ALLOCATOR_LIMITS.maxUnitsPerClaim ||
    claim.resourceIds.length === 0
  ) {
    throw new RangeError("booking: a claim needs 1..500 units and a resource");
  }

  const readFree =
    claim.kind === "stay" ? readFreeStayUnits : readFreeSlotUnits;
  const tryClaim = claim.kind === "stay" ? tryClaimStayUnit : tryClaimSlotUnit;
  const won: ClaimedUnit[] = [];

  for (let round = 0; round < ALLOCATOR_LIMITS.maxRounds; round += 1) {
    const need = claim.quantity - won.length;
    const candidates = await readFree(
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

      const allocationId = await tryClaim(tx, claim, unit);

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

/**
 * The units a block covers: the one it names, or every unit of the resource.
 * INACTIVE units are included on purpose: a unit taken out of service and put
 * back later must still be blocked, and `sql/204` does not require an active
 * unit for a block row.
 *
 * The resource row is locked `FOR SHARE` in its OWN statement first (Issue
 * #1012, N1): a unit insert takes it `FOR NO KEY UPDATE` (`sql/240`), so a unit
 * being added either commits before this read (and is read here) or waits for
 * the block to commit (and its trigger then covers it). Without the lock a unit
 * inserted between this read and the commit would slip through uncovered. The
 * unit read is a separate statement so it takes a fresh READ COMMITTED snapshot
 * AFTER the lock wait.
 */
async function readBlockUnits(tx: Sql, claim: BlockClaim): Promise<UnitRef[]> {
  await tx`
    SELECT 1
    FROM awcms_booking_resources
    WHERE tenant_id = ${claim.tenantId} AND id = ${claim.resourceId}
    FOR SHARE
  `;

  const rows = (await tx`
    SELECT u.id AS unit_id, u.resource_id, u.ordinal
    FROM awcms_booking_resource_blocks b
    JOIN awcms_booking_resource_units u
      ON u.tenant_id = b.tenant_id AND u.resource_id = b.resource_id
     AND (b.resource_unit_id IS NULL OR u.id = b.resource_unit_id)
    WHERE b.tenant_id = ${claim.tenantId} AND b.id = ${claim.blockId}
      AND b.resource_id = ${claim.resourceId}
    ORDER BY u.ordinal, u.id
  `) as CandidateRow[];

  return toUnitRefs(rows);
}

async function tryClaimBlockUnit(
  tx: Sql,
  claim: BlockClaim,
  unit: UnitRef
): Promise<string | null> {
  const rows = (await tx`
    INSERT INTO awcms_booking_resource_allocations
      (tenant_id, block_id, resource_id, resource_unit_id, granularity,
       stay_from, stay_to)
    SELECT b.tenant_id, b.id, b.resource_id, ${unit.unitId}, 'stay',
           b.block_from, b.block_to
    FROM awcms_booking_resource_blocks b
    WHERE b.tenant_id = ${claim.tenantId} AND b.id = ${claim.blockId}
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as { id: string }[];

  return rows[0]?.id ?? null;
}

/**
 * Takes every unit a block covers, in `(resource_id, ordinal)` order (the same
 * global order as every multi-unit claim, so a block and a booking of several
 * rooms cannot wait on each other in a cycle). A unit that is not won -- a live
 * stay or another block holds a night of it -- is `BlockConflictError`; the
 * caller's savepoint rolls back the units already won, so a block is whole or
 * absent.
 */
async function claimBlockUnits(
  tx: Sql,
  claim: BlockClaim
): Promise<ClaimedUnit[]> {
  const units = insertionOrder(await readBlockUnits(tx, claim));

  if (units.length === 0) {
    // A block that names no unit of its resource: nothing to take, nothing to
    // block. The caller validated the resource and unit, so this is a defect.
    throw new RangeError("booking: a block covers no unit");
  }

  const won: ClaimedUnit[] = [];

  for (const unit of units) {
    const allocationId = await tryClaimBlockUnit(tx, claim, unit);

    if (allocationId === null) {
      throw new BlockConflictError(won.length, units.length);
    }

    won.push({
      allocationId,
      resourceId: unit.resourceId,
      unitId: unit.unitId
    });
  }

  return won;
}

/**
 * Claims the units of one `UnitClaim`. Returns them in the order they were won.
 * See `claimChosenUnits` and `claimBlockUnits` for what each kind throws.
 */
export async function claimUnits(
  tx: Sql,
  claim: UnitClaim
): Promise<ClaimedUnit[]> {
  return claim.kind === "block"
    ? claimBlockUnits(tx, claim)
    : claimChosenUnits(tx, claim);
}
