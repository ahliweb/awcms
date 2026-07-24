/**
 * Keyset-paginated `awcms_visit_events` listing (ported from awcms-micro epic
 * #617-#624). Ordered `occurred_at DESC, id DESC`.
 *
 * PORT ADAPTATION (this base's keyset convention, Issue #158): the cursor is
 * built HERE from the row's full-microsecond-precision `occurred_at`
 * (`KEYSET_CURSOR_CREATED_AT_SQL`-style `to_char`), never from a JS `Date`
 * that has already floored the microseconds — a route that rebuilt the cursor
 * from `occurred_at.toISOString()` would silently skip every row sharing that
 * millisecond across the page boundary. `occurred_at_cursor` carries the
 * full-precision text and never leaves this function.
 */
import {
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type { VisitEventRow } from "../domain/analytics-response-shaping";

export const VISIT_EVENT_LIST_LIMIT = 50;

type VisitEventListRow = VisitEventRow & { occurred_at_cursor: string };

export type VisitEventListPage = {
  rows: VisitEventRow[];
  nextCursor: string | null;
};

export async function listVisitEvents(
  tx: Bun.SQL,
  tenantId: string,
  cursor?: KeysetCursor
): Promise<VisitEventListPage> {
  const cursorOccurredAt = cursor?.createdAt ?? null;
  const cursorId = cursor?.id ?? null;

  const rows = (await tx`
    SELECT *,
      to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS occurred_at_cursor
    FROM awcms_visit_events
    WHERE tenant_id = ${tenantId}
      AND (
        ${cursorOccurredAt}::timestamptz IS NULL
        OR (occurred_at, id) < (${cursorOccurredAt}, ${cursorId})
      )
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${VISIT_EVENT_LIST_LIMIT}
  `) as VisitEventListRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === VISIT_EVENT_LIST_LIMIT && last
      ? encodeKeysetCursor(last.occurred_at_cursor, last.id)
      : null;

  return { rows, nextCursor };
}
