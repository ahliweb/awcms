/**
 * Read-side queries for `GET /api/v1/omes/health`, Issue ahliweb/omes#198.
 * Two modes: `latest` (one row per server, the default) and `history`
 * (keyset-paginated series for one `serverId`).
 */
import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { redactSensitiveAttributes } from "../../_shared/redaction";

export type HealthSnapshotSummary = {
  id: string;
  serverId: string;
  overallStatus: string;
  checks: unknown;
  capturedAt: string;
};

type HealthRow = {
  id: string;
  server_id: string;
  overall_status: string;
  checks: Record<string, unknown>;
  captured_at: Date;
  created_at: Date;
  created_at_cursor: string;
};

function toSummary(row: HealthRow): HealthSnapshotSummary {
  return {
    id: row.id,
    serverId: row.server_id,
    overallStatus: row.overall_status,
    checks: redactSensitiveAttributes(row.checks) ?? {},
    capturedAt: row.captured_at.toISOString()
  };
}

export const HEALTH_LATEST_LIMIT = 200;
export const HEALTH_HISTORY_LIMIT = 100;

/**
 * One row per `server_id` — the most recent snapshot only (`DISTINCT ON`,
 * ordered by `captured_at DESC` inside the window function so ties resolve
 * deterministically by `id`).
 */
export async function fetchLatestHealthPerServer(
  tx: Bun.SQL,
  tenantId: string
): Promise<HealthSnapshotSummary[]> {
  const rows = (await tx`
    SELECT DISTINCT ON (server_id)
      id, server_id, overall_status, checks, captured_at, created_at,
      '' AS created_at_cursor
    FROM awcms_omes_health_snapshots
    WHERE tenant_id = ${tenantId}
    ORDER BY server_id, captured_at DESC, id DESC
    LIMIT ${HEALTH_LATEST_LIMIT}
  `) as HealthRow[];

  return rows.map(toSummary);
}

export type HealthHistoryPage = {
  snapshots: HealthSnapshotSummary[];
  nextCursor: string | null;
};

export async function fetchHealthHistory(
  tx: Bun.SQL,
  tenantId: string,
  serverId: string,
  cursor?: KeysetCursor
): Promise<HealthHistoryPage> {
  const cursorCreatedAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;

  const rows = (await tx`
    SELECT id, server_id, overall_status, checks, captured_at, created_at,
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_omes_health_snapshots
    WHERE tenant_id = ${tenantId} AND server_id = ${serverId}
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${HEALTH_HISTORY_LIMIT}
  `) as HealthRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === HEALTH_HISTORY_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { snapshots: rows.map(toSummary), nextCursor };
}
