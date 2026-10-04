/**
 * Read paths over the movement ledger (Issue #887, ADR-0126).
 *
 * Newest first, keyset paginated on `(created_at, id)` with the full-precision
 * cursor helper every list endpoint in this repo shares — never `OFFSET`, which
 * on an append-only table that grows on every sale is a query that gets slower
 * with every page a client turns.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { mapMovement, type Movement, type MovementRow } from "./inventory-rows";

export const MOVEMENT_PAGE_SIZE = 100;

/**
 * The one SELECT list for movement reads, embedded with `tx.unsafe` (a constant,
 * never caller input). The table MUST be aliased `m` in the FROM.
 *
 * `reversed_by_movement_id` is a correlated scalar subquery answered by the
 * partial index `(tenant_id, reverses_movement_id) WHERE reverses_movement_id IS
 * NOT NULL` (sql/169): one index probe per returned row, inside the same
 * statement — not a second round trip per row (Issue #900).
 */
const MOVEMENT_SELECT = `
  id, location_id, item_type, item_ref, unit_code, movement_type,
  quantity_delta::text AS quantity_delta, balance_after::text AS balance_after,
  source_type, source_id, source_line, operation, transfer_id,
  reverses_movement_id, reason_code, note, request_fingerprint, occurred_at,
  created_at, actor_tenant_user_id, correlation_id,
  (
    SELECT r.id FROM awcms_inventory_movements r
    WHERE r.tenant_id = m.tenant_id AND r.reverses_movement_id = m.id
    LIMIT 1
  ) AS reversed_by_movement_id
`;

export type MovementListFilters = {
  locationId?: string;
  itemType?: string;
  itemRef?: string;
  movementType?: string;
  sourceType?: string;
  sourceId?: string;
  transferId?: string;
};

export function parseMovementCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

export async function listMovements(
  tx: Bun.SQL,
  tenantId: string,
  filters: MovementListFilters,
  cursor?: KeysetCursor
): Promise<{ movements: Movement[]; nextCursor: string | null }> {
  const locationId = filters.locationId ?? null;
  const itemType = filters.itemType ?? null;
  const itemRef = filters.itemRef ?? null;
  const movementType = filters.movementType ?? null;
  const sourceType = filters.sourceType ?? null;
  const sourceId = filters.sourceId ?? null;
  const transferId = filters.transferId ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(MOVEMENT_SELECT)},
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_inventory_movements m
    WHERE tenant_id = ${tenantId}
      AND (${locationId}::uuid IS NULL OR location_id = ${locationId})
      AND (${itemType}::text IS NULL OR item_type = ${itemType})
      AND (${itemRef}::text IS NULL OR item_ref = ${itemRef})
      AND (${movementType}::text IS NULL OR movement_type = ${movementType})
      AND (${sourceType}::text IS NULL OR source_type = ${sourceType})
      AND (${sourceId}::text IS NULL OR source_id = ${sourceId})
      AND (${transferId}::uuid IS NULL OR transfer_id = ${transferId})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${MOVEMENT_PAGE_SIZE}
  `) as MovementRow[];

  const last = rows[rows.length - 1];

  return {
    movements: rows.map(mapMovement),
    nextCursor:
      rows.length === MOVEMENT_PAGE_SIZE && last && last.created_at_cursor
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export async function getMovement(
  tx: Bun.SQL,
  tenantId: string,
  movementId: string
): Promise<Movement | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(MOVEMENT_SELECT)}
    FROM awcms_inventory_movements m
    WHERE tenant_id = ${tenantId} AND id = ${movementId}
  `) as MovementRow[];

  return rows[0] ? mapMovement(rows[0]) : null;
}
