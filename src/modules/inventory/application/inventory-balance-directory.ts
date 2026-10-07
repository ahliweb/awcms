/**
 * Balances: reads, thresholds, reconciliation and rebuild (Issue #887,
 * ADR-0126).
 *
 * A balance is a READ MODEL of the movement ledger. Nothing in this file lets a
 * caller set `on_hand` to a value of its choosing: the threshold path touches
 * `low_stock_threshold` only, and the rebuild path recomputes `on_hand` FROM the
 * ledger rather than accepting one.
 *
 * ## Reconciliation and rebuild
 *
 * `reconcileBalances` compares each balance with `SUM(quantity_delta)` of its
 * movements and reports every disagreement — including a key that has movements
 * but no balance row and a balance row whose `movement_count` disagrees. It is
 * read-only. `rebuildBalances` repairs what it finds, and the order inside it is
 * the only subtle part:
 *
 *   lock the balance row  ->  THEN recompute the sum in a fresh statement.
 *
 * Doing it as one `UPDATE … FROM (SELECT SUM …)` would compute the sum in the
 * statement's snapshot and then wait on a row lock held by an in-flight poster;
 * when the lock released, the stale sum would overwrite a balance that already
 * included the poster's movement. Posters lock the same row before inserting a
 * movement, so once this function holds the lock every movement that will ever
 * be visible for the key is committed, and the next statement sees all of them.
 */
import { recordLowStockTransition, type PostActor } from "./inventory-ledger";
import {
  mapBalance,
  canonicalQuantity,
  type BalanceRow,
  type StockBalance
} from "./inventory-rows";
import type { ThresholdInput } from "../domain/inventory-validation";

export const BALANCE_PAGE_SIZE = 100;
/** Bound on keys examined/repaired per reconciliation or rebuild call. */
export const RECONCILE_KEY_LIMIT = 500;

const CURSOR_SEPARATOR = "|";

export type BalanceCursor = {
  locationId: string;
  itemType: string;
  itemRef: string;
};

export function encodeBalanceCursor(cursor: BalanceCursor): string {
  return Buffer.from(
    [cursor.locationId, cursor.itemType, cursor.itemRef].join(CURSOR_SEPARATOR),
    "utf-8"
  ).toString("base64url");
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeBalanceCursor(value: string): BalanceCursor | null {
  let decoded: string;

  try {
    decoded = Buffer.from(value, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const parts = decoded.split(CURSOR_SEPARATOR);

  if (parts.length !== 3 || !UUID_PATTERN.test(parts[0]!)) {
    return null;
  }

  if (parts[1]!.length === 0 || parts[2]!.length === 0) {
    return null;
  }

  return { locationId: parts[0]!, itemType: parts[1]!, itemRef: parts[2]! };
}

export type BalanceListFilters = {
  locationId?: string;
  itemType?: string;
  itemRef?: string;
  lowStockOnly?: boolean;
};

export async function listBalances(
  tx: Bun.SQL,
  tenantId: string,
  filters: BalanceListFilters,
  cursor?: BalanceCursor
): Promise<{ balances: StockBalance[]; nextCursor: string | null }> {
  const locationId = filters.locationId ?? null;
  const itemType = filters.itemType ?? null;
  const itemRef = filters.itemRef ?? null;
  const lowOnly = filters.lowStockOnly === true;
  const afterLocation = cursor?.locationId ?? null;
  const afterType = cursor?.itemType ?? null;
  const afterRef = cursor?.itemRef ?? null;

  const rows = (await tx`
    SELECT location_id, item_type, item_ref, unit_code,
           on_hand::text AS on_hand, low_stock_threshold::text AS low_stock_threshold,
           is_low, movement_count, last_movement_id, updated_at
    FROM awcms_inventory_balances
    WHERE tenant_id = ${tenantId}
      AND (${locationId}::uuid IS NULL OR location_id = ${locationId})
      AND (${itemType}::text IS NULL OR item_type = ${itemType})
      AND (${itemRef}::text IS NULL OR item_ref = ${itemRef})
      AND (NOT ${lowOnly}::boolean OR is_low)
      AND (
        ${afterLocation}::uuid IS NULL
        OR (location_id, item_type, item_ref)
           > (${afterLocation}::uuid, ${afterType}::text, ${afterRef}::text)
      )
    ORDER BY location_id, item_type, item_ref
    LIMIT ${BALANCE_PAGE_SIZE}
  `) as BalanceRow[];

  const last = rows[rows.length - 1];

  return {
    balances: rows.map(mapBalance),
    nextCursor:
      rows.length === BALANCE_PAGE_SIZE && last
        ? encodeBalanceCursor({
            locationId: last.location_id,
            itemType: last.item_type,
            itemRef: last.item_ref
          })
        : null
  };
}

export type SetThresholdResult =
  | { outcome: "updated"; balance: StockBalance; before: string | null }
  | { outcome: "location_not_found" }
  | { outcome: "unit_mismatch"; expectedUnitCode: string };

/**
 * Sets or clears a low-stock threshold. Creates a zero balance row when the
 * item has never moved, so a threshold can be configured before the first
 * receipt — and that zero row does not count as a movement, so the item's unit
 * stays open until a real movement fixes it.
 */
export async function setLowStockThreshold(
  tx: Bun.SQL,
  tenantId: string,
  input: ThresholdInput,
  actor: PostActor
): Promise<SetThresholdResult> {
  const locations = await tx`
    SELECT 1 FROM awcms_inventory_locations
    WHERE tenant_id = ${tenantId} AND id = ${input.locationId}
  `;

  if (locations.length === 0) {
    return { outcome: "location_not_found" };
  }

  await tx`
    INSERT INTO awcms_inventory_balances
      (tenant_id, location_id, item_type, item_ref, unit_code)
    VALUES (${tenantId}, ${input.locationId}, ${input.itemType}, ${input.itemRef}, ${input.unitCode})
    ON CONFLICT (tenant_id, location_id, item_type, item_ref) DO NOTHING
  `;

  const locked = (await tx`
    SELECT unit_code, on_hand::text AS on_hand,
           low_stock_threshold::text AS low_stock_threshold,
           movement_count, is_low
    FROM awcms_inventory_balances
    WHERE tenant_id = ${tenantId} AND location_id = ${input.locationId}
      AND item_type = ${input.itemType} AND item_ref = ${input.itemRef}
    FOR UPDATE
  `) as {
    unit_code: string;
    on_hand: string;
    low_stock_threshold: string | null;
    movement_count: string | number;
    is_low: boolean;
  }[];
  const before = locked[0]!;

  if (
    Number(before.movement_count) > 0 &&
    before.unit_code !== input.unitCode
  ) {
    return { outcome: "unit_mismatch", expectedUnitCode: before.unit_code };
  }

  const rows = (await tx`
    UPDATE awcms_inventory_balances
    SET low_stock_threshold = ${input.lowStockThreshold}::numeric,
        unit_code = ${input.unitCode}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND location_id = ${input.locationId}
      AND item_type = ${input.itemType} AND item_ref = ${input.itemRef}
    RETURNING location_id, item_type, item_ref, unit_code,
              on_hand::text AS on_hand, low_stock_threshold::text AS low_stock_threshold,
              is_low, movement_count, last_movement_id, updated_at
  `) as BalanceRow[];
  const after = rows[0]!;

  await recordLowStockTransition(
    tx,
    tenantId,
    {
      locationId: after.location_id,
      itemType: after.item_type,
      itemRef: after.item_ref,
      onHand: after.on_hand,
      threshold: after.low_stock_threshold,
      wasLow: before.is_low,
      isLow: after.is_low
    },
    null,
    actor
  );

  return {
    outcome: "updated",
    balance: mapBalance(after),
    before:
      before.low_stock_threshold === null
        ? null
        : canonicalQuantity(before.low_stock_threshold)
  };
}

// --- Reconciliation & rebuild --------------------------------------------------

export type BalanceDrift = {
  locationId: string;
  itemType: string;
  itemRef: string;
  /** `SUM(quantity_delta)` over the ledger — the truth. */
  ledgerOnHand: string;
  ledgerMovementCount: number;
  /** What the balance row says; `null` when the key has no balance row at all. */
  balanceOnHand: string | null;
  balanceMovementCount: number | null;
};

type DriftRow = {
  location_id: string;
  item_type: string;
  item_ref: string;
  ledger_on_hand: string;
  ledger_movement_count: string | number;
  balance_on_hand: string | null;
  balance_movement_count: string | number | null;
};

function mapDrift(row: DriftRow): BalanceDrift {
  return {
    locationId: row.location_id,
    itemType: row.item_type,
    itemRef: row.item_ref,
    ledgerOnHand: canonicalQuantity(row.ledger_on_hand),
    ledgerMovementCount: Number(row.ledger_movement_count),
    balanceOnHand:
      row.balance_on_hand === null
        ? null
        : canonicalQuantity(row.balance_on_hand),
    balanceMovementCount:
      row.balance_movement_count === null
        ? null
        : Number(row.balance_movement_count)
  };
}

export type ReconciliationReport = {
  /** `true` when every examined key's balance equals its ledger sum. */
  consistent: boolean;
  /** Number of (location, item) keys that have ledger rows or a balance row. */
  checkedKeys: number;
  drift: BalanceDrift[];
  /** `true` when more than `RECONCILE_KEY_LIMIT` keys drifted; run again after repair. */
  truncated: boolean;
  /** Balances that are negative although their location's policy forbids it. */
  negativeUnderForbid: number;
};

async function findDrift(
  tx: Bun.SQL,
  tenantId: string,
  locationId: string | null,
  limit: number
): Promise<DriftRow[]> {
  return (await tx`
    WITH ledger AS (
      SELECT location_id, item_type, item_ref,
             SUM(quantity_delta) AS on_hand, count(*) AS movement_count
      FROM awcms_inventory_movements
      WHERE tenant_id = ${tenantId}
        AND (${locationId}::uuid IS NULL OR location_id = ${locationId})
      GROUP BY location_id, item_type, item_ref
    ), stored AS (
      SELECT location_id, item_type, item_ref, on_hand, movement_count
      FROM awcms_inventory_balances
      WHERE tenant_id = ${tenantId}
        AND (${locationId}::uuid IS NULL OR location_id = ${locationId})
    )
    SELECT COALESCE(l.location_id, s.location_id) AS location_id,
           COALESCE(l.item_type, s.item_type) AS item_type,
           COALESCE(l.item_ref, s.item_ref) AS item_ref,
           COALESCE(l.on_hand, 0)::text AS ledger_on_hand,
           COALESCE(l.movement_count, 0) AS ledger_movement_count,
           s.on_hand::text AS balance_on_hand,
           s.movement_count AS balance_movement_count
    FROM ledger l
    FULL OUTER JOIN stored s
      ON s.location_id = l.location_id AND s.item_type = l.item_type
         AND s.item_ref = l.item_ref
    WHERE s.location_id IS NULL
       OR COALESCE(l.on_hand, 0) <> s.on_hand
       OR COALESCE(l.movement_count, 0) <> s.movement_count
    ORDER BY 1, 2, 3
    LIMIT ${limit}
  `) as DriftRow[];
}

export async function reconcileBalances(
  tx: Bun.SQL,
  tenantId: string,
  locationId: string | null
): Promise<ReconciliationReport> {
  const driftRows = await findDrift(
    tx,
    tenantId,
    locationId,
    RECONCILE_KEY_LIMIT + 1
  );

  const counted = (await tx`
    SELECT count(*)::int AS keys FROM (
      SELECT location_id, item_type, item_ref FROM awcms_inventory_movements
      WHERE tenant_id = ${tenantId}
        AND (${locationId}::uuid IS NULL OR location_id = ${locationId})
      UNION
      SELECT location_id, item_type, item_ref FROM awcms_inventory_balances
      WHERE tenant_id = ${tenantId}
        AND (${locationId}::uuid IS NULL OR location_id = ${locationId})
    ) keys
  `) as { keys: number }[];

  // Policy check: a negative balance is only legitimate where the effective
  // policy allows it. Reported separately from drift because the ledger and the
  // balance can agree perfectly and still describe a state the policy forbids
  // (the policy changed after the stock went negative).
  const negative = (await tx`
    SELECT count(*)::int AS offending
    FROM awcms_inventory_balances b
    JOIN awcms_inventory_locations l
      ON l.tenant_id = b.tenant_id AND l.id = b.location_id
    WHERE b.tenant_id = ${tenantId}
      AND (${locationId}::uuid IS NULL OR b.location_id = ${locationId})
      AND b.on_hand < 0
      AND COALESCE(
            l.negative_stock_policy,
            (SELECT default_negative_stock_policy FROM awcms_inventory_settings s
              WHERE s.tenant_id = b.tenant_id),
            'forbid'
          ) = 'forbid'
  `) as { offending: number }[];

  const truncated = driftRows.length > RECONCILE_KEY_LIMIT;
  const drift = driftRows.slice(0, RECONCILE_KEY_LIMIT).map(mapDrift);

  return {
    consistent: drift.length === 0,
    checkedKeys: counted[0]?.keys ?? 0,
    drift,
    truncated,
    negativeUnderForbid: negative[0]?.offending ?? 0
  };
}

export type RebuiltBalance = {
  locationId: string;
  itemType: string;
  itemRef: string;
  before: { onHand: string | null; movementCount: number | null };
  after: { onHand: string; movementCount: number };
};

export type RebuildReport = {
  repaired: RebuiltBalance[];
  /** More drifted keys remain than one call repairs; call again. */
  truncated: boolean;
};

/**
 * Repairs drifted balances FROM THE LEDGER. Idempotent: a second call finds
 * nothing to repair. Never invents a number — the new `on_hand` is always the
 * ledger sum, so rebuild cannot be used to assert a balance.
 */
export async function rebuildBalances(
  tx: Bun.SQL,
  tenantId: string,
  locationId: string | null,
  actor: PostActor
): Promise<RebuildReport> {
  const driftRows = await findDrift(
    tx,
    tenantId,
    locationId,
    RECONCILE_KEY_LIMIT + 1
  );
  const truncated = driftRows.length > RECONCILE_KEY_LIMIT;
  const candidates = driftRows.slice(0, RECONCILE_KEY_LIMIT);
  const repaired: RebuiltBalance[] = [];

  // `findDrift` orders by key, so locks are taken in a consistent order.
  for (const candidate of candidates) {
    // Ensure the row exists. The unit comes from the newest movement for the key.
    await tx`
      INSERT INTO awcms_inventory_balances
        (tenant_id, location_id, item_type, item_ref, unit_code)
      SELECT ${tenantId}, ${candidate.location_id}, ${candidate.item_type},
             ${candidate.item_ref}, unit_code
      FROM awcms_inventory_movements
      WHERE tenant_id = ${tenantId} AND location_id = ${candidate.location_id}
        AND item_type = ${candidate.item_type} AND item_ref = ${candidate.item_ref}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      ON CONFLICT (tenant_id, location_id, item_type, item_ref) DO NOTHING
    `;

    // 1. LOCK. 2. Only then recompute (see the file header).
    const locked = (await tx`
      SELECT on_hand::text AS on_hand, movement_count, is_low,
             low_stock_threshold::text AS threshold
      FROM awcms_inventory_balances
      WHERE tenant_id = ${tenantId} AND location_id = ${candidate.location_id}
        AND item_type = ${candidate.item_type} AND item_ref = ${candidate.item_ref}
      FOR UPDATE
    `) as {
      on_hand: string;
      movement_count: string | number;
      is_low: boolean;
      threshold: string | null;
    }[];
    const before = locked[0];

    if (!before) {
      // No movements AND no balance row cannot be a drift candidate; skip.
      continue;
    }

    const updated = (await tx`
      UPDATE awcms_inventory_balances b
      SET on_hand = ledger.on_hand,
          movement_count = ledger.movement_count,
          last_movement_id = ledger.last_movement_id,
          updated_at = now()
      FROM (
        SELECT COALESCE(SUM(quantity_delta), 0) AS on_hand,
               count(*) AS movement_count,
               (array_agg(id ORDER BY created_at DESC, id DESC))[1] AS last_movement_id
        FROM awcms_inventory_movements
        WHERE tenant_id = ${tenantId} AND location_id = ${candidate.location_id}
          AND item_type = ${candidate.item_type} AND item_ref = ${candidate.item_ref}
      ) ledger
      WHERE b.tenant_id = ${tenantId} AND b.location_id = ${candidate.location_id}
        AND b.item_type = ${candidate.item_type} AND b.item_ref = ${candidate.item_ref}
      RETURNING b.on_hand::text AS on_hand, b.movement_count, b.is_low,
                b.low_stock_threshold::text AS threshold
    `) as {
      on_hand: string;
      movement_count: string | number;
      is_low: boolean;
      threshold: string | null;
    }[];
    const after = updated[0]!;

    await recordLowStockTransition(
      tx,
      tenantId,
      {
        locationId: candidate.location_id,
        itemType: candidate.item_type,
        itemRef: candidate.item_ref,
        onHand: after.on_hand,
        threshold: after.threshold,
        wasLow: before.is_low,
        isLow: after.is_low
      },
      null,
      actor
    );

    const wasDrifted =
      canonicalQuantity(before.on_hand) !== canonicalQuantity(after.on_hand) ||
      Number(before.movement_count) !== Number(after.movement_count);

    if (wasDrifted) {
      repaired.push({
        locationId: candidate.location_id,
        itemType: candidate.item_type,
        itemRef: candidate.item_ref,
        before: {
          onHand:
            candidate.balance_on_hand !== null
              ? canonicalQuantity(candidate.balance_on_hand)
              : null,
          movementCount:
            candidate.balance_movement_count === null
              ? null
              : Number(candidate.balance_movement_count)
        },
        after: {
          onHand: canonicalQuantity(after.on_hand),
          movementCount: Number(after.movement_count)
        }
      });
    }
  }

  return { repaired, truncated };
}
