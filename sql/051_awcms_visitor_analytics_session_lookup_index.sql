-- visitor_analytics — supports the collector's session find-or-create
-- lookup (`application/collector.ts`'s `upsertVisitorSession`). Ported from
-- awcms-micro migration 040 (rename `awcms_micro_` -> `awcms_`):
--
--   SELECT id, last_seen_at FROM awcms_visitor_sessions
--   WHERE tenant_id = $1 AND visitor_key_hash = $2 AND area = $3
--   ORDER BY last_seen_at DESC LIMIT 1
--
-- Not added by migration 050 (schema-only, no writer existed yet to justify
-- it) — this is the first index that supports querying the table by
-- `visitor_key_hash`. Deliberately NOT a UNIQUE constraint: one visitor
-- legitimately accumulates multiple session rows over time (a new row
-- starts once the previous one falls outside
-- VISITOR_ANALYTICS_ONLINE_WINDOW_SECONDS, see collector.ts's
-- `upsertVisitorSession`) — a unique index would force reusing the same row
-- forever, contradicting that intentional session-boundary design.
CREATE INDEX IF NOT EXISTS awcms_visitor_sessions_lookup_idx
  ON awcms_visitor_sessions (tenant_id, visitor_key_hash, area, last_seen_at DESC);
