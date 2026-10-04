/**
 * The posting core of the stock ledger (Issue #887, ADR-0126).
 *
 * Every state change to stock in this module goes through `postLegs`, and
 * nothing else writes `awcms_inventory_balances.on_hand`, so every invariant
 * lives in one place and cannot be bypassed by a second code path:
 *
 *   * a balance moves only together with the movement that moves it, in ONE
 *     transaction — they commit or roll back as one;
 *   * "the last unit" is safe: each balance row is locked `FOR UPDATE` before the
 *     check, and the UPDATE itself is guarded (`WHERE … on_hand + delta >= 0`),
 *     so two concurrent attempts serialise on the row and the second one
 *     re-evaluates against the first one's result;
 *   * replay is natural: the unique source identity
 *     `(tenant, source_type, source_id, source_line, operation)` is looked up
 *     first, under an advisory lock that serialises concurrent requests for the
 *     SAME identity, so a retry returns the original movement(s) instead of
 *     posting twice;
 *   * a transfer is both legs, validated together BEFORE any write, so a refused
 *     transfer leaves nothing behind (a 4xx `Response` returned from a route
 *     handler still COMMITS, so "check first, write after" is not a style
 *     preference here — it is what keeps a refusal from being half-applied).
 *
 * ## Lock order
 *
 * Legs are sorted by `(location, item_type, item_ref)` before any lock is taken,
 * for the usual reason: two opposing transfers (A→B and B→A) would otherwise
 * each hold one row and wait on the other.
 *
 * ## No provider calls
 *
 * Plain database writes only (ADR-0006). Events go to the outbox in the same
 * transaction; delivering them is someone else's job, later.
 */
import { createHash, randomUUID } from "node:crypto";

import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  INVENTORY_BALANCE_AGGREGATE_TYPE,
  INVENTORY_EVENT_VERSION,
  INVENTORY_MOVEMENT_AGGREGATE_TYPE,
  INVENTORY_MOVEMENT_POSTED_EVENT_TYPE,
  INVENTORY_STOCK_LOW_EVENT_TYPE
} from "../domain/inventory-events";
import { INVENTORY_MODULE_KEY } from "../domain/inventory-permissions";
import {
  negateQuantity,
  parseQuantityUnits,
  quantitySign
} from "../domain/inventory-quantity";
import {
  DEFAULT_NEGATIVE_STOCK_POLICY,
  MOVEMENT_SIGN,
  type MovementOperation,
  type MovementType,
  type NegativeStockPolicy
} from "../domain/inventory-types";
import {
  movementFingerprint,
  type AdjustmentInput,
  type PostMovementInput,
  type SourceIdentity,
  type TransferInput
} from "../domain/inventory-validation";
import {
  canonicalQuantity,
  mapMovement,
  type Movement,
  type MovementRow
} from "./inventory-rows";

/** 10^20 millionths: the first magnitude `numeric(20,6)` cannot hold. */
const NUMERIC_20_6_LIMIT = 10n ** 20n;

export type PostActor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

export type PostSuccess = {
  /** `replayed` = the identity was already posted; these are the ORIGINAL movements. */
  outcome: "posted" | "replayed";
  movements: Movement[];
};

export type PostFailure =
  | { outcome: "location_not_found"; locationId: string }
  | { outcome: "location_inactive"; locationId: string }
  | { outcome: "unit_mismatch"; locationId: string; expectedUnitCode: string }
  | {
      outcome: "insufficient_stock";
      locationId: string;
      onHand: string;
      requested: string;
    }
  | { outcome: "source_conflict" }
  | { outcome: "quantity_out_of_range"; locationId: string }
  | { outcome: "opening_not_first"; locationId: string }
  | { outcome: "target_not_found" }
  | { outcome: "not_reversible"; reason: string };

export type PostResult = PostSuccess | PostFailure;

export function isPostSuccess(result: PostResult): result is PostSuccess {
  return result.outcome === "posted" || result.outcome === "replayed";
}

type Leg = {
  locationId: string;
  itemType: string;
  itemRef: string;
  unitCode: string;
  /** Canonical signed decimal text. */
  delta: string;
  movementType: MovementType;
  operation: MovementOperation;
  transferId: string | null;
  reversesMovementId: string | null;
};

type PostingContext = {
  source: SourceIdentity;
  fingerprint: string;
  occurredAt: Date | null;
  reasonCode: string | null;
  note: string | null;
  actor: PostActor;
};

type LocationState = {
  id: string;
  status: string;
  negative_stock_policy: NegativeStockPolicy | null;
};

type LockedBalance = {
  unit_code: string;
  on_hand: string;
  movement_count: string | number;
  is_low: boolean;
};

function legKey(leg: {
  locationId: string;
  itemType: string;
  itemRef: string;
}): string {
  return `${leg.locationId}|${leg.itemType}|${leg.itemRef}`;
}

/**
 * Per-balance ordering key for events. A hash, because
 * `(location uuid, item_type, item_ref)` can exceed the 300 characters the
 * outbox's `order_key` allows (an `itemRef` alone may be 200).
 */
function balanceOrderKey(leg: {
  locationId: string;
  itemType: string;
  itemRef: string;
}): string {
  const digest = createHash("sha256")
    .update(`${leg.itemType}|${leg.itemRef}`)
    .digest("hex")
    .slice(0, 32);

  return `${INVENTORY_BALANCE_AGGREGATE_TYPE}:${leg.locationId}:${digest}`;
}

export async function resolveTenantNegativeStockPolicy(
  tx: Bun.SQL,
  tenantId: string
): Promise<NegativeStockPolicy> {
  const rows = (await tx`
    SELECT default_negative_stock_policy
    FROM awcms_inventory_settings
    WHERE tenant_id = ${tenantId}
  `) as { default_negative_stock_policy: NegativeStockPolicy }[];

  return (
    rows[0]?.default_negative_stock_policy ?? DEFAULT_NEGATIVE_STOCK_POLICY
  );
}

async function loadMovementsByTransfer(
  tx: Bun.SQL,
  tenantId: string,
  transferId: string
): Promise<Movement[]> {
  const rows = (await tx`
    SELECT id, location_id, item_type, item_ref, unit_code, movement_type,
           quantity_delta::text AS quantity_delta, balance_after::text AS balance_after,
           source_type, source_id, source_line, operation, transfer_id,
           reverses_movement_id, reason_code, note, request_fingerprint,
           occurred_at, created_at, actor_tenant_user_id, correlation_id
    FROM awcms_inventory_movements
    WHERE tenant_id = ${tenantId} AND transfer_id = ${transferId}
    ORDER BY movement_type DESC, id
  `) as MovementRow[];

  // `transfer_out` sorts after `transfer_in` descending alphabetically
  // ('o' > 'i'), so the OUT leg is first — the order the API documents.
  return rows.map(mapMovement);
}

async function findPostedByIdentity(
  tx: Bun.SQL,
  tenantId: string,
  source: SourceIdentity,
  operation: MovementOperation
): Promise<MovementRow | null> {
  const rows = (await tx`
    SELECT id, location_id, item_type, item_ref, unit_code, movement_type,
           quantity_delta::text AS quantity_delta, balance_after::text AS balance_after,
           source_type, source_id, source_line, operation, transfer_id,
           reverses_movement_id, reason_code, note, request_fingerprint,
           occurred_at, created_at, actor_tenant_user_id, correlation_id
    FROM awcms_inventory_movements
    WHERE tenant_id = ${tenantId}
      AND source_type = ${source.sourceType}
      AND source_id = ${source.sourceId}
      AND source_line = ${source.sourceLine}
      AND operation = ${operation}
  `) as MovementRow[];

  return rows[0] ?? null;
}

/**
 * Serialises concurrent requests for the SAME source identity. Without it two
 * simultaneous retries both pass the "already posted?" lookup (READ COMMITTED:
 * neither sees the other's uncommitted row) and both post; the unique key would
 * stop the second, but only by failing it with a constraint error AFTER it had
 * already moved the balance. A transaction-scoped advisory lock makes the loser
 * wait, then see the winner's committed row and replay it.
 */
async function lockSourceIdentity(
  tx: Bun.SQL,
  tenantId: string,
  source: SourceIdentity
): Promise<void> {
  const key = `inventory|${tenantId}|${source.sourceType}|${source.sourceId}|${source.sourceLine}`;

  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function emitMovementEvent(
  tx: Bun.SQL,
  tenantId: string,
  leg: Leg,
  movement: { id: string; occurredAt: Date; balanceAfter: string },
  ctx: PostingContext
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: INVENTORY_MOVEMENT_POSTED_EVENT_TYPE,
    eventVersion: INVENTORY_EVENT_VERSION,
    aggregateType: INVENTORY_MOVEMENT_AGGREGATE_TYPE,
    aggregateId: movement.id,
    orderKey: balanceOrderKey(leg),
    correlationId: ctx.actor.correlationId ?? null,
    producerModule: INVENTORY_MODULE_KEY,
    actorTenantUserId: ctx.actor.actorTenantUserId,
    occurredAt: movement.occurredAt,
    payload: {
      movementId: movement.id,
      locationId: leg.locationId,
      itemType: leg.itemType,
      itemRef: leg.itemRef,
      unitCode: leg.unitCode,
      movementType: leg.movementType,
      operation: leg.operation,
      quantityDelta: leg.delta,
      balanceAfter: movement.balanceAfter,
      sourceType: ctx.source.sourceType,
      sourceId: ctx.source.sourceId,
      sourceLine: ctx.source.sourceLine,
      transferId: leg.transferId,
      reversesMovementId: leg.reversesMovementId
    }
  });
}

/**
 * Records a low-stock TRANSITION (not a state) when `is_low` changed, and emits
 * the event for the downward one. Shared with the threshold and rebuild paths,
 * which change `is_low` without a movement.
 */
export async function recordLowStockTransition(
  tx: Bun.SQL,
  tenantId: string,
  balance: {
    locationId: string;
    itemType: string;
    itemRef: string;
    onHand: string;
    threshold: string | null;
    wasLow: boolean;
    isLow: boolean;
  },
  movementId: string | null,
  actor: PostActor
): Promise<void> {
  if (balance.wasLow === balance.isLow) {
    return;
  }

  const kind = balance.isLow ? "below" : "recovered";
  const signalId = randomUUID();

  await tx`
    INSERT INTO awcms_inventory_low_stock_signals
      (id, tenant_id, location_id, item_type, item_ref, signal_kind,
       on_hand, threshold, movement_id)
    VALUES (
      ${signalId}, ${tenantId}, ${balance.locationId}, ${balance.itemType},
      ${balance.itemRef}, ${kind}, ${balance.onHand}::numeric,
      ${balance.threshold}::numeric, ${movementId}
    )
  `;

  if (kind === "below") {
    await appendDomainEvent(tx, tenantId, {
      eventType: INVENTORY_STOCK_LOW_EVENT_TYPE,
      eventVersion: INVENTORY_EVENT_VERSION,
      aggregateType: "inventory.low_stock_signal",
      aggregateId: signalId,
      orderKey: balanceOrderKey(balance),
      correlationId: actor.correlationId ?? null,
      producerModule: INVENTORY_MODULE_KEY,
      actorTenantUserId: actor.actorTenantUserId,
      payload: {
        locationId: balance.locationId,
        itemType: balance.itemType,
        itemRef: balance.itemRef,
        onHand: canonicalQuantity(balance.onHand),
        threshold:
          balance.threshold === null
            ? null
            : canonicalQuantity(balance.threshold),
        movementId
      }
    });
  }
}

/**
 * The one writer of `on_hand`. Validates every leg against locked state, THEN
 * writes; see the file header for why that order is load-bearing.
 */
async function postLegs(
  tx: Bun.SQL,
  tenantId: string,
  legs: Leg[],
  ctx: PostingContext
): Promise<PostResult> {
  await lockSourceIdentity(tx, tenantId, ctx.source);

  // 1. Replay / conflict, decided before anything else is touched.
  const existing = await findPostedByIdentity(
    tx,
    tenantId,
    ctx.source,
    legs[0]!.operation
  );

  if (existing) {
    if (existing.request_fingerprint !== ctx.fingerprint) {
      return { outcome: "source_conflict" };
    }

    const movements = existing.transfer_id
      ? await loadMovementsByTransfer(tx, tenantId, existing.transfer_id)
      : [mapMovement(existing)];

    return { outcome: "replayed", movements };
  }

  // 2. Locations: exist, in this tenant (RLS + composite filter), and active.
  // `FOR SHARE`, not a plain read: a concurrent deactivation or policy flip is an
  // UPDATE of this row, and it must wait for in-flight postings (and be waited
  // for by new ones) instead of racing them. Without it a posting could validate
  // against `forbid`/`active` and commit AFTER a committed flip to `inactive`.
  const locationIds = [...new Set(legs.map((leg) => leg.locationId))];
  const locations = new Map<string, LocationState>();

  for (const locationId of locationIds) {
    const rows = (await tx`
      SELECT id, status, negative_stock_policy
      FROM awcms_inventory_locations
      WHERE tenant_id = ${tenantId} AND id = ${locationId}
      FOR SHARE
    `) as LocationState[];
    const row = rows[0];

    if (!row) {
      return { outcome: "location_not_found", locationId };
    }

    if (row.status !== "active") {
      return { outcome: "location_inactive", locationId };
    }

    locations.set(locationId, row);
  }

  const tenantPolicy = await resolveTenantNegativeStockPolicy(tx, tenantId);

  const ordered = [...legs].sort((a, b) =>
    legKey(a) < legKey(b) ? -1 : legKey(a) > legKey(b) ? 1 : 0
  );

  // 2b. Cheap, NON-locking refusal of an obviously impossible withdrawal BEFORE
  // any row is created. Without it, every refused sale of a never-stocked item
  // would leave an empty balance row behind — a 4xx `Response` still COMMITS —
  // so a caller could grow the table with arbitrary item references. The read
  // may be stale by a few milliseconds (a receipt committing right now); that
  // is a valid ordering (the sale came first), and a withdrawal that passes
  // here is re-checked under the row lock in step 4 regardless.
  for (const leg of ordered) {
    if (quantitySign(leg.delta) >= 0) {
      continue;
    }

    const policy =
      locations.get(leg.locationId)!.negative_stock_policy ?? tenantPolicy;

    if (policy !== "forbid") {
      continue;
    }

    const current = (await tx`
      SELECT on_hand::text AS on_hand, movement_count
      FROM awcms_inventory_balances
      WHERE tenant_id = ${tenantId} AND location_id = ${leg.locationId}
        AND item_type = ${leg.itemType} AND item_ref = ${leg.itemRef}
    `) as { on_hand: string; movement_count: string | number }[];
    const onHandNow = current[0] ? canonicalQuantity(current[0].on_hand) : "0";

    if (!coversWithdrawal(onHandNow, leg.delta)) {
      return {
        outcome: "insufficient_stock",
        locationId: leg.locationId,
        onHand: onHandNow,
        requested: negateQuantity(leg.delta)
      };
    }
  }

  // 3. Ensure + lock balance rows in a fixed order.
  const locked = new Map<string, LockedBalance>();

  for (const leg of ordered) {
    await tx`
      INSERT INTO awcms_inventory_balances
        (tenant_id, location_id, item_type, item_ref, unit_code)
      VALUES (${tenantId}, ${leg.locationId}, ${leg.itemType}, ${leg.itemRef}, ${leg.unitCode})
      ON CONFLICT (tenant_id, location_id, item_type, item_ref) DO NOTHING
    `;

    const rows = (await tx`
      SELECT unit_code, on_hand::text AS on_hand, movement_count, is_low
      FROM awcms_inventory_balances
      WHERE tenant_id = ${tenantId} AND location_id = ${leg.locationId}
        AND item_type = ${leg.itemType} AND item_ref = ${leg.itemRef}
      FOR UPDATE
    `) as LockedBalance[];

    locked.set(legKey(leg), rows[0]!);
  }

  // 4. Validate EVERY leg against the locked state before writing any.
  for (const leg of ordered) {
    const balance = locked.get(legKey(leg))!;
    const location = locations.get(leg.locationId)!;

    if (
      Number(balance.movement_count) > 0 &&
      balance.unit_code !== leg.unitCode
    ) {
      return {
        outcome: "unit_mismatch",
        locationId: leg.locationId,
        expectedUnitCode: balance.unit_code
      };
    }

    // numeric(20,6) holds |x| < 10^20 millionths. Past that the UPDATE would
    // raise 22003 from inside the transaction and surface as a 500; answer it
    // as the caller's 422 instead, before anything is written.
    const projected =
      (parseQuantityUnits(canonicalQuantity(balance.on_hand)) ?? 0n) +
      (parseQuantityUnits(leg.delta) ?? 0n);

    if (projected >= NUMERIC_20_6_LIMIT || projected <= -NUMERIC_20_6_LIMIT) {
      return { outcome: "quantity_out_of_range", locationId: leg.locationId };
    }

    if (leg.movementType === "opening" && Number(balance.movement_count) > 0) {
      return { outcome: "opening_not_first", locationId: leg.locationId };
    }

    if (quantitySign(leg.delta) < 0) {
      const policy = location.negative_stock_policy ?? tenantPolicy;
      const [onHandUnits, deltaUnits] = [
        canonicalQuantity(balance.on_hand),
        leg.delta
      ];

      if (policy === "forbid" && !coversWithdrawal(onHandUnits, deltaUnits)) {
        return {
          outcome: "insufficient_stock",
          locationId: leg.locationId,
          onHand: onHandUnits,
          requested: negateQuantity(deltaUnits)
        };
      }
    }
  }

  // 5. Write. From here on a failure is a bug, and throwing rolls it all back.
  const posted = new Map<string, { id: string; row: MovementRow }>();
  const tenantUser = ctx.actor.actorTenantUserId;
  const occurredAt = ctx.occurredAt ?? new Date();

  for (const leg of ordered) {
    const before = locked.get(legKey(leg))!;
    const location = locations.get(leg.locationId)!;
    const policy = location.negative_stock_policy ?? tenantPolicy;
    const allowNegative = policy === "allow";
    const movementId = randomUUID();

    const updated = (await tx`
      UPDATE awcms_inventory_balances
      SET on_hand = on_hand + ${leg.delta}::numeric,
          unit_code = ${leg.unitCode},
          movement_count = movement_count + 1,
          last_movement_id = ${movementId},
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND location_id = ${leg.locationId}
        AND item_type = ${leg.itemType} AND item_ref = ${leg.itemRef}
        AND (${leg.delta}::numeric >= 0
             OR ${allowNegative}::boolean
             OR on_hand + ${leg.delta}::numeric >= 0)
      RETURNING on_hand::text AS on_hand, low_stock_threshold::text AS threshold, is_low
    `) as { on_hand: string; threshold: string | null; is_low: boolean }[];

    if (updated.length === 0) {
      // Unreachable while the row lock from step 3 is held and step 4 passed;
      // reaching it means the guard and the check disagree, which is a bug.
      throw new Error(
        `Inventory invariant violated: guarded balance update matched no row for ${legKey(leg)}`
      );
    }

    const after = updated[0]!;

    const inserted = (await tx`
      INSERT INTO awcms_inventory_movements
        (id, tenant_id, location_id, item_type, item_ref, unit_code,
         movement_type, quantity_delta, balance_after, source_type, source_id,
         source_line, operation, transfer_id, reverses_movement_id, reason_code,
         note, request_fingerprint, occurred_at, actor_tenant_user_id, correlation_id)
      VALUES (
        ${movementId}, ${tenantId}, ${leg.locationId}, ${leg.itemType}, ${leg.itemRef},
        ${leg.unitCode}, ${leg.movementType}, ${leg.delta}::numeric,
        ${after.on_hand}::numeric, ${ctx.source.sourceType}, ${ctx.source.sourceId},
        ${ctx.source.sourceLine}, ${leg.operation}, ${leg.transferId},
        ${leg.reversesMovementId}, ${ctx.reasonCode}, ${ctx.note},
        ${ctx.fingerprint}, ${occurredAt}, ${tenantUser}, ${ctx.actor.correlationId ?? null}
      )
      RETURNING id, location_id, item_type, item_ref, unit_code, movement_type,
                quantity_delta::text AS quantity_delta, balance_after::text AS balance_after,
                source_type, source_id, source_line, operation, transfer_id,
                reverses_movement_id, reason_code, note, request_fingerprint,
                occurred_at, created_at, actor_tenant_user_id, correlation_id
    `) as MovementRow[];

    posted.set(legKey(leg), { id: movementId, row: inserted[0]! });

    await recordLowStockTransition(
      tx,
      tenantId,
      {
        locationId: leg.locationId,
        itemType: leg.itemType,
        itemRef: leg.itemRef,
        onHand: after.on_hand,
        threshold: after.threshold,
        wasLow: before.is_low,
        isLow: after.is_low
      },
      movementId,
      ctx.actor
    );

    await emitMovementEvent(
      tx,
      tenantId,
      leg,
      {
        id: movementId,
        occurredAt,
        balanceAfter: canonicalQuantity(after.on_hand)
      },
      ctx
    );
  }

  // Return in the caller's leg order (out leg first for a transfer).
  return {
    outcome: "posted",
    movements: legs.map((leg) => mapMovement(posted.get(legKey(leg))!.row))
  };
}

/**
 * `onHand + delta >= 0` for canonical decimal text, without float arithmetic.
 * `delta` is negative here, so this is `onHand >= |delta|`.
 */
function coversWithdrawal(onHand: string, delta: string): boolean {
  return compareQuantities(onHand, negateQuantity(delta)) >= 0;
}

function compareQuantities(a: string, b: string): number {
  // Both are canonical, so compare on a fixed scale via BigInt.
  const toUnits = (value: string): bigint => {
    const negative = value.startsWith("-");
    const [integerPart = "0", fractionPart = ""] = (
      negative ? value.slice(1) : value
    ).split(".");
    const units =
      BigInt(integerPart) * 1_000_000n +
      BigInt(fractionPart.padEnd(6, "0").slice(0, 6));

    return negative ? -units : units;
  };
  const difference = toUnits(a) - toUnits(b);

  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

// --- Public posting operations ------------------------------------------------

export async function postMovement(
  tx: Bun.SQL,
  tenantId: string,
  input: PostMovementInput,
  actor: PostActor
): Promise<PostResult> {
  const sign = MOVEMENT_SIGN[input.movementType];
  const delta = sign === 1 ? input.quantity : negateQuantity(input.quantity);

  return postLegs(
    tx,
    tenantId,
    [
      {
        locationId: input.locationId,
        itemType: input.itemType,
        itemRef: input.itemRef,
        unitCode: input.unitCode,
        delta,
        movementType: input.movementType,
        operation: input.movementType,
        transferId: null,
        reversesMovementId: null
      }
    ],
    {
      source: input.source,
      fingerprint: movementFingerprint({
        operation: input.movementType,
        locationIds: [input.locationId],
        itemType: input.itemType,
        itemRef: input.itemRef,
        unitCode: input.unitCode,
        quantity: delta,
        source: input.source,
        reasonCode: input.reasonCode,
        note: input.note
      }),
      occurredAt: input.occurredAt,
      reasonCode: input.reasonCode,
      note: input.note,
      actor
    }
  );
}

export async function postAdjustment(
  tx: Bun.SQL,
  tenantId: string,
  input: AdjustmentInput,
  actor: PostActor
): Promise<PostResult> {
  return postLegs(
    tx,
    tenantId,
    [
      {
        locationId: input.locationId,
        itemType: input.itemType,
        itemRef: input.itemRef,
        unitCode: input.unitCode,
        delta: input.quantityDelta,
        movementType: "adjustment",
        operation: "adjustment",
        transferId: null,
        reversesMovementId: null
      }
    ],
    {
      source: input.source,
      fingerprint: movementFingerprint({
        operation: "adjustment",
        locationIds: [input.locationId],
        itemType: input.itemType,
        itemRef: input.itemRef,
        unitCode: input.unitCode,
        quantity: input.quantityDelta,
        source: input.source,
        reasonCode: input.reasonCode,
        note: input.note
      }),
      occurredAt: input.occurredAt,
      reasonCode: input.reasonCode,
      note: input.note,
      actor
    }
  );
}

/**
 * Compensates an ADJUSTMENT with an equal and opposite adjustment. Only
 * adjustments are reversible: the natural counterpart of every other type
 * already exists (`sale_return` for `sale`, `supplier_return` for `receive`),
 * and a reversal of a reversal would be an unbounded chain with no document
 * behind any link of it.
 *
 * The source identity is server-derived — `("reversal", <original id>, "")` —
 * so retrying a reversal is naturally idempotent without the caller inventing an
 * identity, and the partial unique index makes a second, DIFFERENT reversal of
 * the same adjustment impossible rather than merely unlikely.
 */
export async function reverseAdjustment(
  tx: Bun.SQL,
  tenantId: string,
  targetMovementId: string,
  input: { reasonCode: string; note: string | null },
  actor: PostActor
): Promise<PostResult> {
  const source: SourceIdentity = {
    sourceType: "reversal",
    sourceId: targetMovementId,
    sourceLine: ""
  };

  // A retry of a reversal that already happened must answer with the original,
  // not with "that adjustment has been reversed" — that would turn an idempotent
  // call into an error. It needs no special case here: only an adjustment can
  // have a reversal, so a replay passes the checks below and `postLegs` finds
  // the existing identity and compares its fingerprint (which now includes the
  // reason and note, so a retry with a different reason is a SOURCE_CONFLICT).
  await lockSourceIdentity(tx, tenantId, source);

  const targetRows = (await tx`
    SELECT id, location_id, item_type, item_ref, unit_code, movement_type,
           quantity_delta::text AS quantity_delta, operation
    FROM awcms_inventory_movements
    WHERE tenant_id = ${tenantId} AND id = ${targetMovementId}
  `) as {
    id: string;
    location_id: string;
    item_type: string;
    item_ref: string;
    unit_code: string;
    movement_type: MovementType;
    quantity_delta: string;
    operation: MovementOperation;
  }[];
  const target = targetRows[0];

  if (!target) {
    return { outcome: "target_not_found" };
  }

  if (
    target.movement_type !== "adjustment" ||
    target.operation !== "adjustment"
  ) {
    return {
      outcome: "not_reversible",
      reason:
        target.operation === "reversal"
          ? "A reversal cannot itself be reversed; post a new adjustment instead."
          : "Only an adjustment can be reversed. Compensate other movements with their natural counterpart (sale_return, supplier_return, or a transfer back)."
    };
  }

  const delta = negateQuantity(canonicalQuantity(target.quantity_delta));

  return postLegs(
    tx,
    tenantId,
    [
      {
        locationId: target.location_id,
        itemType: target.item_type,
        itemRef: target.item_ref,
        unitCode: target.unit_code,
        delta,
        movementType: "adjustment",
        operation: "reversal",
        transferId: null,
        reversesMovementId: target.id
      }
    ],
    {
      source,
      fingerprint: movementFingerprint({
        operation: "reversal",
        locationIds: [target.location_id],
        itemType: target.item_type,
        itemRef: target.item_ref,
        unitCode: target.unit_code,
        quantity: delta,
        source,
        reasonCode: input.reasonCode,
        note: input.note
      }),
      occurredAt: null,
      reasonCode: input.reasonCode,
      note: input.note,
      actor
    }
  );
}

/**
 * A transfer is a balanced out/in pair posted atomically. Both legs are
 * validated before either is written (`postLegs` step 4), and the deferred
 * constraint trigger in `sql/169` independently refuses to COMMIT anything that
 * is not exactly one out leg and one in leg netting to zero.
 */
export async function postTransfer(
  tx: Bun.SQL,
  tenantId: string,
  input: TransferInput,
  actor: PostActor
): Promise<PostResult> {
  const transferId = randomUUID();

  return postLegs(
    tx,
    tenantId,
    [
      {
        locationId: input.fromLocationId,
        itemType: input.itemType,
        itemRef: input.itemRef,
        unitCode: input.unitCode,
        delta: negateQuantity(input.quantity),
        movementType: "transfer_out",
        operation: "transfer_out",
        transferId,
        reversesMovementId: null
      },
      {
        locationId: input.toLocationId,
        itemType: input.itemType,
        itemRef: input.itemRef,
        unitCode: input.unitCode,
        delta: input.quantity,
        movementType: "transfer_in",
        operation: "transfer_in",
        transferId,
        reversesMovementId: null
      }
    ],
    {
      source: input.source,
      fingerprint: movementFingerprint({
        operation: "transfer",
        locationIds: [input.fromLocationId, input.toLocationId],
        itemType: input.itemType,
        itemRef: input.itemRef,
        unitCode: input.unitCode,
        quantity: input.quantity,
        source: input.source,
        reasonCode: input.reasonCode,
        note: input.note
      }),
      occurredAt: input.occurredAt,
      reasonCode: input.reasonCode,
      note: input.note,
      actor
    }
  );
}
