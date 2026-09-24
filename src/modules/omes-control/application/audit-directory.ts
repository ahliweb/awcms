/**
 * Read-side queries for `GET /api/v1/omes/audit`, Issue ahliweb/omes#198.
 *
 * This is the PROJECTION of remote OMES host execution/reconciliation
 * evidence (`awcms_omes_audit_projections`, populated by the pull worker
 * bridge, ahliweb/omes#199) — distinct from AWCMS's own
 * `awcms_audit_events` (written by `recordAuditEvent` for THIS API's own
 * authorization/mutation decisions). Both are exposed; they answer
 * different questions ("what did the host do" vs "what did an operator/this
 * API do").
 */
import {
  keysetCursorCreatedAtSql,
  encodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { redactSensitiveAttributes } from "../../_shared/redaction";

export type AuditProjectionSummary = {
  id: string;
  serverId: string;
  sourceEventId: string;
  eventType: string;
  evidence: unknown;
  recordedAt: string;
};

type AuditRow = {
  id: string;
  server_id: string;
  source_event_id: string;
  event_type: string;
  evidence: Record<string, unknown>;
  recorded_at: Date;
  created_at: Date;
  created_at_cursor: string;
};

export const AUDIT_PROJECTION_LIST_LIMIT = 100;

function toSummary(row: AuditRow): AuditProjectionSummary {
  return {
    id: row.id,
    serverId: row.server_id,
    sourceEventId: row.source_event_id,
    eventType: row.event_type,
    evidence: redactSensitiveAttributes(row.evidence) ?? {},
    recordedAt: row.recorded_at.toISOString()
  };
}

export type AuditProjectionListPage = {
  projections: AuditProjectionSummary[];
  nextCursor: string | null;
};

export async function fetchAuditProjections(
  tx: Bun.SQL,
  tenantId: string,
  options: { serverId?: string; eventType?: string; cursor?: KeysetCursor } = {}
): Promise<AuditProjectionListPage> {
  const cursorCreatedAt = options.cursor?.createdAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const serverIdFilter = options.serverId ?? null;
  const eventTypeFilter = options.eventType ?? null;

  const rows = (await tx`
    SELECT id, server_id, source_event_id, event_type, evidence, recorded_at,
           created_at,
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_omes_audit_projections
    WHERE tenant_id = ${tenantId}
      AND (${serverIdFilter}::text IS NULL OR server_id = ${serverIdFilter})
      AND (${eventTypeFilter}::text IS NULL OR event_type = ${eventTypeFilter})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}, ${cursorId})
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${AUDIT_PROJECTION_LIST_LIMIT}
  `) as AuditRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === AUDIT_PROJECTION_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { projections: rows.map(toSummary), nextCursor };
}
