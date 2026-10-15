/**
 * Blocked nights of a stay resource (Issue #940, ADR-0135 section 4;
 * docs/awcms/booking.md section 2.5, 8.1 rule 7 and 9).
 *
 * A block takes units of a STAY resource out of sale for a date range
 * (maintenance, owner use): maintenance of a room, a villa the owner is using.
 * It is stored as ALLOCATION ROWS with no reservation, one per affected unit,
 * owned by a `awcms_booking_resource_blocks` row, so it sits under the SAME stay
 * exclusion constraint as a guest's nights:
 *
 *   * a block can never overlap a live stay -- creating one over a booked night
 *     is refused `BLOCK_CONFLICT` and CANCELS NOTHING (the operator moves or
 *     cancels the reservation first);
 *   * a stay can never be placed on a blocked night -- it simply finds no free
 *     unit;
 *   * a block and a booking racing for one night are decided by the DATABASE:
 *     whichever commits first wins and the other receives the absorbed conflict.
 *     No check-then-insert decides it, and no override lifts it (a `closed`
 *     schedule exception is a soft closure; a block is a hard exclusion).
 *
 * ## All-or-none
 *
 * A block over several units (`unitId` absent = every unit of the resource)
 * inserts its rows in the global `(resource_id, ordinal)` order inside a
 * savepoint; if any unit is held, every row it won is rolled back with the block
 * row. A block is whole or absent, never partial.
 *
 * ## Releasing returns the nights to sale, in the same statement
 *
 * Releasing stamps the block; the AFTER UPDATE trigger of `sql/204` releases its
 * allocation rows in that statement with the block's own `released_at`
 * (`sql/241`: one release, one instant), so "block released <=> nights released"
 * is a database invariant, not a handler convention. Releasing a released block is a
 * replay: it writes nothing.
 *
 * ## Expired holds
 *
 * An elapsed-but-unswept hold on the units is reclaimed first (lazy reclaim,
 * `booking-hold-expiry.ts`), so a hold that has run out does not refuse a block,
 * and the reaper being stopped does not matter.
 *
 * ## Audit, and what the refusal tells whom
 *
 * Creating a block is audited `warning` (it removes sellable inventory) and
 * releasing one `info`, with ids, dates and the closed reason code -- no free
 * text, no customer reference. A refused call writes nothing. The conflicting
 * reservations (number, status, dates; never a customer reference) are returned
 * only when the caller asks (`ctx.revealConflicts`), which the route sets from
 * `reservations.read`: a caller without it learns that nights are taken, not by
 * whom.
 *
 * ## Who calls it
 *
 * `POST /api/v1/booking/blocks` and `.../{id}/release` (Issue #1012) authorize
 * `booking.blocks.create` / `.release` and bind the call to an `Idempotency-Key`
 * (`booking-block-routes.ts`): a retry after the commit replays the stored
 * response and never reaches `createBlock` again, so it is never told
 * `BLOCK_CONFLICT` about its own block. Inside this service the retry is still
 * only the state check (a second release is a replay) and the constraint.
 *
 * ## Units added later (Issue #1012, N1)
 *
 * A resource-wide block also covers units added after it: `sql/240` inserts the
 * block row for a new unit, and `readBlockUnits` locks the resource so a unit
 * inserted concurrently cannot slip between the read and the commit.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  ALLOCATOR_LIMITS,
  classifyDatabaseFailure,
  retryDelayMs,
  type ValidationIssue
} from "../domain/booking-allocation";
import { BOOKING_AUDIT_EVENTS } from "../domain/booking-audit";
import { BOOKING_MODULE_KEY } from "../domain/booking-permissions";
import {
  BLOCK_REFUSALS,
  validateCreateBlock,
  type BlockRefusalCode,
  type CreateBlockInput
} from "../domain/booking-stay";
import { daysBetween, localDateExists } from "../domain/booking-time";
import {
  BlockConflictError,
  claimUnits,
  type ClaimedUnit
} from "./booking-allocator";
import { reclaimExpiredHolds } from "./booking-hold-expiry";

type Sql = Bun.SQL;

export type BlockContext = {
  tenantId: string;
  /** The acting tenant user, for the stamps and the audit row. */
  actorTenantUserId: string | null;
  correlationId?: string;
  /** Return the conflicting reservations on a `BLOCK_CONFLICT` (the route sets it from `reservations.read`). */
  revealConflicts?: boolean;
};

export type PlacedBlock = {
  blockId: string;
  resourceId: string;
  /** `null` = every unit of the resource. */
  unitId: string | null;
  fromDate: string;
  toDate: string;
  nights: number;
  reasonCode: string;
  /** One allocation row per affected unit. */
  units: ClaimedUnit[];
};

export type BlockConflicts = {
  reservations: {
    reservationId: string;
    reservationNo: string;
    status: string;
    checkInDate: string;
    checkOutDate: string;
  }[];
  blocks: { blockId: string; fromDate: string; toDate: string }[];
};

export type CreateBlockOutcome =
  | { outcome: "ok"; block: PlacedBlock }
  | {
      outcome: "refused";
      code: BlockRefusalCode;
      message: string;
      httpStatus: number;
      /** Present only for `BLOCK_CONFLICT` when `ctx.revealConflicts`. */
      conflicts?: BlockConflicts;
    }
  | { outcome: "invalid"; errors: ValidationIssue[] };

export type ReleaseBlockOutcome =
  | {
      outcome: "ok";
      blockId: string;
      /** `true` when the block was already released: nothing was written. */
      replayed: boolean;
      releasedAllocations: number;
    }
  | {
      outcome: "refused";
      code: "BLOCK_NOT_FOUND";
      message: string;
      httpStatus: number;
    };

const CONFLICT_SAMPLE = 50;

function refused(
  code: BlockRefusalCode,
  message: string,
  conflicts?: BlockConflicts
): CreateBlockOutcome {
  return {
    outcome: "refused",
    code,
    message,
    httpStatus: BLOCK_REFUSALS[code],
    ...(conflicts ? { conflicts } : {})
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ResourceRow = {
  id: string;
  booking_mode: "slot" | "stay";
  timezone: string;
};

/**
 * Live nights that stand in the way of `[fromDate, toDate)` on the units a block
 * would take: other guests' stays (number, status and dates) and other blocks.
 * Read AFTER the failed attempt rolled back, so it shows committed rows only.
 */
async function readConflicts(
  tx: Sql,
  tenantId: string,
  resourceId: string,
  unitId: string | null,
  fromDate: string,
  toDate: string
): Promise<BlockConflicts> {
  const reservations = (await tx`
    SELECT DISTINCT r.id AS reservation_id, r.reservation_no, r.status,
           to_char(i.check_in_date, 'YYYY-MM-DD') AS check_in_date,
           to_char(i.check_out_date, 'YYYY-MM-DD') AS check_out_date
    FROM awcms_booking_resource_allocations a
    JOIN awcms_booking_reservation_items i
      ON i.tenant_id = a.tenant_id AND i.id = a.item_id
    JOIN awcms_booking_reservations r
      ON r.tenant_id = i.tenant_id AND r.id = i.reservation_id
    WHERE a.tenant_id = ${tenantId}
      AND a.resource_id = ${resourceId}
      AND (${unitId}::uuid IS NULL OR a.resource_unit_id = ${unitId}::uuid)
      AND a.released_at IS NULL
      AND a.granularity = 'stay'
      AND daterange(a.stay_from, a.stay_to, '[)')
          && daterange(${fromDate}::date, ${toDate}::date, '[)')
    ORDER BY check_in_date, r.id
    LIMIT ${CONFLICT_SAMPLE}
  `) as {
    reservation_id: string;
    reservation_no: string;
    status: string;
    check_in_date: string;
    check_out_date: string;
  }[];
  const blocks = (await tx`
    SELECT DISTINCT b.id AS block_id,
           to_char(b.block_from, 'YYYY-MM-DD') AS block_from,
           to_char(b.block_to, 'YYYY-MM-DD') AS block_to
    FROM awcms_booking_resource_allocations a
    JOIN awcms_booking_resource_blocks b
      ON b.tenant_id = a.tenant_id AND b.id = a.block_id
    WHERE a.tenant_id = ${tenantId}
      AND a.resource_id = ${resourceId}
      AND (${unitId}::uuid IS NULL OR a.resource_unit_id = ${unitId}::uuid)
      AND a.released_at IS NULL
      AND daterange(a.stay_from, a.stay_to, '[)')
          && daterange(${fromDate}::date, ${toDate}::date, '[)')
    ORDER BY block_from, b.id
    LIMIT ${CONFLICT_SAMPLE}
  `) as { block_id: string; block_from: string; block_to: string }[];

  return {
    reservations: reservations.map((row) => ({
      reservationId: row.reservation_id,
      reservationNo: row.reservation_no,
      status: row.status,
      checkInDate: row.check_in_date,
      checkOutDate: row.check_out_date
    })),
    blocks: blocks.map((row) => ({
      blockId: row.block_id,
      fromDate: row.block_from,
      toDate: row.block_to
    }))
  };
}

/** The writes of one attempt: the block row, then its allocation rows. Runs inside the savepoint. */
async function writeBlock(
  tx: Sql,
  ctx: BlockContext,
  input: CreateBlockInput
): Promise<{ blockId: string; units: ClaimedUnit[] }> {
  const rows = (await tx`
    INSERT INTO awcms_booking_resource_blocks
      (tenant_id, resource_id, resource_unit_id, block_from, block_to,
       reason_code, created_by)
    VALUES (
      ${ctx.tenantId}, ${input.resourceId}, ${input.unitId ?? null},
      ${input.fromDate}::date, ${input.toDate}::date, ${input.reasonCode},
      ${ctx.actorTenantUserId}
    )
    RETURNING id
  `) as { id: string }[];
  const blockId = rows[0]!.id;
  const units = await claimUnits(tx, {
    kind: "block",
    tenantId: ctx.tenantId,
    blockId,
    resourceId: input.resourceId
  });

  return { blockId, units };
}

function isDatabaseFailure(
  error: unknown,
  kind: "deadlock" | "exclusion_conflict"
): boolean {
  return (
    error instanceof Bun.SQL.PostgresError &&
    classifyDatabaseFailure(
      String(error.errno),
      (error as { constraint?: string }).constraint
    ) === kind
  );
}

/**
 * Blocks `[fromDate, toDate)` of a stay resource (one unit, or all of them).
 *
 * MUST run inside the caller's tenant transaction (`withTenant*`), which owns
 * COMMIT/ROLLBACK. Returns a refusal as a value, and a refusal writes nothing.
 */
export async function createBlock(
  tx: Sql,
  ctx: BlockContext,
  input: CreateBlockInput
): Promise<CreateBlockOutcome> {
  const issues = validateCreateBlock(input);

  if (issues.length > 0) {
    return { outcome: "invalid", errors: issues };
  }

  const resources = (await tx`
    SELECT id, booking_mode, timezone
    FROM awcms_booking_resources
    WHERE tenant_id = ${ctx.tenantId} AND id = ${input.resourceId}
      AND deleted_at IS NULL AND status = 'active'
  `) as ResourceRow[];
  const resource = resources[0];

  if (!resource) {
    return refused("RESOURCE_NOT_FOUND", "Resource not found.");
  }

  if (resource.booking_mode !== "stay") {
    return refused(
      "BOOKING_MODE_MISMATCH",
      "Nights are blocked on a stay resource; a slot resource has schedule exceptions instead."
    );
  }

  if (input.unitId) {
    const units = (await tx`
      SELECT id FROM awcms_booking_resource_units
      WHERE tenant_id = ${ctx.tenantId} AND resource_id = ${resource.id}
        AND id = ${input.unitId}
    `) as { id: string }[];

    if (units.length === 0) {
      return refused("UNIT_NOT_FOUND", "Unit not found on that resource.");
    }
  }

  if (
    !localDateExists(resource.timezone, input.fromDate) ||
    !localDateExists(resource.timezone, input.toDate)
  ) {
    return refused(
      "STAY_DATES_INVALID",
      "A date does not exist in the resource's time zone."
    );
  }

  const nights = daysBetween(input.fromDate, input.toDate);

  // Lazy reclaim BEFORE the savepoint: an elapsed hold on these nights must not
  // refuse the block, and expiring it is a fact that stays true even when the
  // block that follows is refused.
  // Only the units the block COVERS are reclaimed (Issue #1012, N3): a block of
  // one unit names that unit, so an elapsed hold on another unit is left alone
  // for its own sweep; a resource-wide block covers every unit, so no unit filter.
  const reclaimed = await reclaimExpiredHolds(tx, ctx.tenantId, [resource.id], {
    kind: "stay",
    fromDate: input.fromDate,
    toDate: input.toDate,
    ...(input.unitId ? { unitId: input.unitId } : {})
  });

  if (reclaimed.expired > 0) {
    await recordAuditEvent(tx, {
      tenantId: ctx.tenantId,
      moduleKey: BOOKING_MODULE_KEY,
      action: BOOKING_AUDIT_EVENTS.reservationExpired.action,
      resourceType: "booking_reservation",
      severity: BOOKING_AUDIT_EVENTS.reservationExpired.severity,
      message: `${reclaimed.expired} elapsed hold(s) holding nights of the block's unit(s) were expired to make room for it.`,
      attributes: {
        expiredCount: reclaimed.expired,
        releasedAllocations: reclaimed.releasedAllocations,
        trigger: "lazy_reclaim",
        resourceId: resource.id,
        unitId: input.unitId ?? null
      },
      ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
    });
  }

  for (
    let attempt = 0;
    attempt <= ALLOCATOR_LIMITS.maxDeadlockRetries;
    attempt += 1
  ) {
    const savepoint = `booking_create_block_${attempt}`;

    await tx.unsafe(`SAVEPOINT ${savepoint}`);

    try {
      const written = await writeBlock(tx, ctx, input);

      await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);

      await recordAuditEvent(tx, {
        tenantId: ctx.tenantId,
        ...(ctx.actorTenantUserId
          ? { actorTenantUserId: ctx.actorTenantUserId }
          : {}),
        moduleKey: BOOKING_MODULE_KEY,
        action: BOOKING_AUDIT_EVENTS.blockCreated.action,
        resourceType: "booking_resource_block",
        resourceId: written.blockId,
        severity: BOOKING_AUDIT_EVENTS.blockCreated.severity,
        message: `Nights ${input.fromDate} to ${input.toDate} were blocked.`,
        attributes: {
          resourceId: resource.id,
          unitId: input.unitId ?? null,
          fromDate: input.fromDate,
          toDate: input.toDate,
          nights,
          reasonCode: input.reasonCode,
          units: written.units.length
        },
        ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
      });

      return {
        outcome: "ok",
        block: {
          blockId: written.blockId,
          resourceId: resource.id,
          unitId: input.unitId ?? null,
          fromDate: input.fromDate,
          toDate: input.toDate,
          nights,
          reasonCode: input.reasonCode,
          units: written.units
        }
      };
    } catch (error) {
      // Back out to the savepoint: it drops the block row and every row already
      // won, releases the locks, and makes the transaction usable again.
      await tx.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await tx.unsafe(`RELEASE SAVEPOINT ${savepoint}`);

      if (isDatabaseFailure(error, "deadlock")) {
        if (attempt === ALLOCATOR_LIMITS.maxDeadlockRetries) {
          return refused(
            "CONTENTION_RETRY",
            "The nights are being contended; please retry."
          );
        }

        await sleep(retryDelayMs(attempt));
        continue;
      }

      // A 23P01 that escaped `DO NOTHING` is still "a night is taken".
      if (
        error instanceof BlockConflictError ||
        isDatabaseFailure(error, "exclusion_conflict")
      ) {
        return refused(
          "BLOCK_CONFLICT",
          "A live stay or another block already holds a night of that range; nothing was cancelled.",
          ctx.revealConflicts
            ? await readConflicts(
                tx,
                ctx.tenantId,
                resource.id,
                input.unitId ?? null,
                input.fromDate,
                input.toDate
              )
            : undefined
        );
      }

      throw error;
    }
  }

  // Unreachable: the loop returns or throws on every path.
  return refused(
    "CONTENTION_RETRY",
    "The nights are being contended; please retry."
  );
}

/**
 * Releases a block and returns its nights to sale. The block row is locked
 * `FOR UPDATE` and re-read, so two releases serialise and the second is a
 * replay; the trigger of `sql/204` releases the allocation rows in the same
 * statement that stamps the block.
 *
 * MUST run inside the caller's tenant transaction.
 */
export async function releaseBlock(
  tx: Sql,
  ctx: BlockContext,
  blockId: string
): Promise<ReleaseBlockOutcome> {
  const blocks = (await tx`
    SELECT id, resource_id, resource_unit_id, reason_code, status,
           to_char(block_from, 'YYYY-MM-DD') AS block_from,
           to_char(block_to, 'YYYY-MM-DD') AS block_to
    FROM awcms_booking_resource_blocks
    WHERE tenant_id = ${ctx.tenantId} AND id = ${blockId}
    FOR UPDATE
  `) as {
    id: string;
    resource_id: string;
    resource_unit_id: string | null;
    reason_code: string;
    status: "active" | "released";
    block_from: string;
    block_to: string;
  }[];
  const block = blocks[0];

  if (!block) {
    return {
      outcome: "refused",
      code: "BLOCK_NOT_FOUND",
      message: "Block not found.",
      httpStatus: BLOCK_REFUSALS.BLOCK_NOT_FOUND
    };
  }

  if (block.status === "released") {
    return {
      outcome: "ok",
      blockId: block.id,
      replayed: true,
      releasedAllocations: 0
    };
  }

  await tx`
    UPDATE awcms_booking_resource_blocks
    SET status = 'released', released_at = clock_timestamp(),
        released_by = ${ctx.actorTenantUserId}
    WHERE tenant_id = ${ctx.tenantId} AND id = ${block.id}
  `;

  const released = (await tx`
    SELECT count(*)::int AS n
    FROM awcms_booking_resource_allocations
    WHERE tenant_id = ${ctx.tenantId} AND block_id = ${block.id}
      AND released_reason = 'block_released'
  `) as { n: number }[];
  const releasedAllocations = Number(released[0]?.n ?? 0);

  await recordAuditEvent(tx, {
    tenantId: ctx.tenantId,
    ...(ctx.actorTenantUserId
      ? { actorTenantUserId: ctx.actorTenantUserId }
      : {}),
    moduleKey: BOOKING_MODULE_KEY,
    action: BOOKING_AUDIT_EVENTS.blockReleased.action,
    resourceType: "booking_resource_block",
    resourceId: block.id,
    severity: BOOKING_AUDIT_EVENTS.blockReleased.severity,
    message: `Nights ${block.block_from} to ${block.block_to} were returned to sale.`,
    attributes: {
      resourceId: block.resource_id,
      unitId: block.resource_unit_id,
      fromDate: block.block_from,
      toDate: block.block_to,
      reasonCode: block.reason_code,
      releasedAllocations
    },
    ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {})
  });

  return {
    outcome: "ok",
    blockId: block.id,
    replayed: false,
    releasedAllocations
  };
}
