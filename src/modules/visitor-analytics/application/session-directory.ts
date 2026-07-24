/**
 * Keyset-paginated `awcms_visitor_sessions` listing (ported from awcms-micro
 * epic #617-#624). Ordered `last_seen_at DESC, id DESC` — the generic
 * `(timestamp, id)` cursor is reused even though the sort column here is
 * `last_seen_at`, not literally `created_at`.
 *
 * PORT ADAPTATION (this base's keyset convention, Issue #158): the cursor is
 * built HERE from the row's full-microsecond-precision `last_seen_at`, never
 * from a JS `Date` (which has already floored the microseconds and would
 * resurrect the row-skipping bug across the page boundary). `last_seen_at_cursor`
 * carries the full-precision text and never leaves this function.
 */
import {
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type { VisitorSessionRow } from "../domain/analytics-response-shaping";

export const VISITOR_SESSION_LIST_LIMIT = 50;

type VisitorSessionListRow = VisitorSessionRow & {
  last_seen_at_cursor: string;
};

export type VisitorSessionListPage = {
  rows: VisitorSessionRow[];
  nextCursor: string | null;
};

export async function listVisitorSessions(
  tx: Bun.SQL,
  tenantId: string,
  cursor?: KeysetCursor
): Promise<VisitorSessionListPage> {
  const cursorLastSeenAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;

  const rows = (await tx`
    SELECT *,
      to_char(last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS last_seen_at_cursor
    FROM awcms_visitor_sessions
    WHERE tenant_id = ${tenantId}
      AND (
        ${cursorLastSeenAt}::timestamptz IS NULL
        OR (last_seen_at, id) < (${cursorLastSeenAt}, ${cursorId})
      )
    ORDER BY last_seen_at DESC, id DESC
    LIMIT ${VISITOR_SESSION_LIST_LIMIT}
  `) as VisitorSessionListRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === VISITOR_SESSION_LIST_LIMIT && last
      ? encodeKeysetCursor(last.last_seen_at_cursor, last.id)
      : null;

  return { rows, nextCursor };
}
