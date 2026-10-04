/**
 * Row types and mappers shared by the ledger's read and write paths
 * (Issue #887, ADR-0126).
 *
 * Quantities leave this file as CANONICAL DECIMAL STRINGS. Postgres returns a
 * `numeric(20,6)` as `"10.000000"`; handing that to a client leaks the column's
 * scale into the contract and makes `"10.000000" !== "10"` a trap for every
 * consumer comparing against what it sent.
 */
import {
  formatQuantityUnits,
  parseQuantityUnits
} from "../domain/inventory-quantity";
import type {
  LocationStatus,
  MovementOperation,
  MovementType,
  NegativeStockPolicy
} from "../domain/inventory-types";

export function canonicalQuantity(text: string): string {
  const units = parseQuantityUnits(text);

  if (units === null) {
    throw new Error(`Database returned a non-quantity value: ${text}`);
  }

  return formatQuantityUnits(units);
}

export type MovementRow = {
  id: string;
  location_id: string;
  item_type: string;
  item_ref: string;
  unit_code: string;
  movement_type: MovementType;
  quantity_delta: string;
  balance_after: string;
  source_type: string;
  source_id: string;
  source_line: string;
  operation: MovementOperation;
  transfer_id: string | null;
  reverses_movement_id: string | null;
  /** Only the movement read paths select it; absent elsewhere. */
  reversed_by_movement_id?: string | null;
  reason_code: string | null;
  note: string | null;
  request_fingerprint: string;
  occurred_at: Date;
  created_at: Date;
  created_at_cursor?: string;
  actor_tenant_user_id: string | null;
  correlation_id: string | null;
};

export type Movement = {
  id: string;
  locationId: string;
  itemType: string;
  itemRef: string;
  unitCode: string;
  movementType: MovementType;
  operation: MovementOperation;
  quantityDelta: string;
  balanceAfter: string;
  source: { type: string; id: string; line: string };
  transferId: string | null;
  reversesMovementId: string | null;
  /**
   * The reversal that compensated this adjustment, or null. Only the movement
   * listing/get populate it; rows returned by a posting carry null because they
   * were just written (Issue #900).
   */
  reversedByMovementId: string | null;
  reasonCode: string | null;
  note: string | null;
  occurredAt: string;
  createdAt: string;
  actorTenantUserId: string | null;
  correlationId: string | null;
};

export function mapMovement(row: MovementRow): Movement {
  return {
    id: row.id,
    locationId: row.location_id,
    itemType: row.item_type,
    itemRef: row.item_ref,
    unitCode: row.unit_code,
    movementType: row.movement_type,
    operation: row.operation,
    quantityDelta: canonicalQuantity(row.quantity_delta),
    balanceAfter: canonicalQuantity(row.balance_after),
    source: {
      type: row.source_type,
      id: row.source_id,
      line: row.source_line
    },
    transferId: row.transfer_id,
    reversesMovementId: row.reverses_movement_id,
    reversedByMovementId: row.reversed_by_movement_id ?? null,
    reasonCode: row.reason_code,
    note: row.note,
    occurredAt: new Date(row.occurred_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    actorTenantUserId: row.actor_tenant_user_id,
    correlationId: row.correlation_id
  };
}

export type LocationRow = {
  id: string;
  code: string;
  name: string;
  office_id: string | null;
  status: LocationStatus;
  negative_stock_policy: NegativeStockPolicy | null;
  created_at: Date;
  updated_at: Date;
};

export type StockLocation = {
  id: string;
  code: string;
  name: string;
  officeId: string | null;
  status: LocationStatus;
  /** `null` = inherits the tenant default. */
  negativeStockPolicy: NegativeStockPolicy | null;
  createdAt: string;
  updatedAt: string;
};

export function mapLocation(row: LocationRow): StockLocation {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    officeId: row.office_id,
    status: row.status,
    negativeStockPolicy: row.negative_stock_policy,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export type BalanceRow = {
  location_id: string;
  item_type: string;
  item_ref: string;
  unit_code: string;
  on_hand: string;
  low_stock_threshold: string | null;
  is_low: boolean;
  movement_count: string | number;
  last_movement_id: string | null;
  updated_at: Date;
};

export type StockBalance = {
  locationId: string;
  itemType: string;
  itemRef: string;
  unitCode: string;
  onHand: string;
  lowStockThreshold: string | null;
  isLow: boolean;
  movementCount: number;
  lastMovementId: string | null;
  updatedAt: string;
};

export function mapBalance(row: BalanceRow): StockBalance {
  return {
    locationId: row.location_id,
    itemType: row.item_type,
    itemRef: row.item_ref,
    unitCode: row.unit_code,
    onHand: canonicalQuantity(row.on_hand),
    lowStockThreshold:
      row.low_stock_threshold === null
        ? null
        : canonicalQuantity(row.low_stock_threshold),
    isLow: row.is_low,
    movementCount: Number(row.movement_count),
    lastMovementId: row.last_movement_id,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
