/**
 * Reads of blocked nights for the HTTP surface (Issue #1012, ADR-0135 section 4;
 * docs/awcms/booking.md sections 4 and 6): the detail and a keyset-paginated
 * list. Tenant-scoped twice (every query names `tenant_id` AND runs under RLS
 * FORCE), so another tenant's id is simply "not found".
 *
 * A block view holds ids, dates and the closed reason code -- no free text and
 * no customer reference exist on a block. `unitIds` are the units whose nights
 * the block holds (or held), from its allocation rows.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  utcMicrosecondTextSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";

type Sql = Bun.SQL;

export const BLOCK_PAGE_SIZE = 50;

export type BlockView = {
  id: string;
  resourceId: string;
  /** `null` = every unit of the resource. */
  unitId: string | null;
  fromDate: string;
  toDate: string;
  nights: number;
  reasonCode: string;
  status: "active" | "released";
  releasedAt: string | null;
  createdAt: string;
  /** Units holding a night of this block (all of them once released: the rows are kept). */
  unitIds: string[];
};

type BlockRow = {
  id: string;
  resource_id: string;
  resource_unit_id: string | null;
  block_from: string;
  block_to: string;
  nights: number;
  reason_code: string;
  status: "active" | "released";
  released_at: string | null;
  created_at: string;
  unit_ids: string | null;
};

const BLOCK_COLUMNS = `
  b.id, b.resource_id, b.resource_unit_id,
  to_char(b.block_from, 'YYYY-MM-DD') AS block_from,
  to_char(b.block_to, 'YYYY-MM-DD') AS block_to,
  (b.block_to - b.block_from) AS nights,
  b.reason_code, b.status,
  ${utcMicrosecondTextSql("b.released_at", "Z")} AS released_at,
  ${keysetCursorCreatedAtSql("b")} AS created_at,
  (SELECT string_agg(a.resource_unit_id::text, ',' ORDER BY a.resource_unit_id::text)
   FROM awcms_booking_resource_allocations a
   WHERE a.tenant_id = b.tenant_id AND a.block_id = b.id) AS unit_ids`;

function toView(row: BlockRow): BlockView {
  return {
    id: row.id,
    resourceId: row.resource_id,
    unitId: row.resource_unit_id,
    fromDate: row.block_from,
    toDate: row.block_to,
    nights: Number(row.nights),
    reasonCode: row.reason_code,
    status: row.status,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    unitIds: row.unit_ids ? row.unit_ids.split(",") : []
  };
}

export async function getBlock(
  tx: Sql,
  tenantId: string,
  blockId: string
): Promise<BlockView | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(BLOCK_COLUMNS)}
    FROM awcms_booking_resource_blocks b
    WHERE b.tenant_id = ${tenantId} AND b.id = ${blockId}
  `) as BlockRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type BlockListFilters = {
  resourceId?: string;
  unitId?: string;
  status?: "active" | "released";
};

export function parseBlockCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

/** This tenant's blocks, newest first, keyset paginated. */
export async function listBlocks(
  tx: Sql,
  tenantId: string,
  filters: BlockListFilters,
  cursor?: KeysetCursor
): Promise<{ blocks: BlockView[]; nextCursor: string | null }> {
  const resourceId = filters.resourceId ?? null;
  const unitId = filters.unitId ?? null;
  const status = filters.status ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;
  const rows = (await tx`
    SELECT ${tx.unsafe(BLOCK_COLUMNS)}
    FROM awcms_booking_resource_blocks b
    WHERE b.tenant_id = ${tenantId}
      AND (${resourceId}::uuid IS NULL OR b.resource_id = ${resourceId}::uuid)
      AND (${unitId}::uuid IS NULL OR b.resource_unit_id = ${unitId}::uuid)
      AND (${status}::text IS NULL OR b.status = ${status}::text)
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (b.created_at, b.id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT ${BLOCK_PAGE_SIZE}
  `) as BlockRow[];
  const last = rows[rows.length - 1];

  return {
    blocks: rows.map(toView),
    nextCursor:
      rows.length === BLOCK_PAGE_SIZE && last
        ? encodeKeysetCursor(last.created_at, last.id)
        : null
  };
}
