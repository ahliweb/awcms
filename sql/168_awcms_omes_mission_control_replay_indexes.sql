-- Issue ahliweb/omes#266 (epic ahliweb/omes#263, OMES ADR-0031 rule 4) —
-- evidence-based historical replay for the 3D Mission Control workspace.
--
-- INDEXES ONLY. No table, column, policy, grant, permission or data-lifecycle
-- change: replay is a bounded READ over evidence the tables below already
-- retain (application/mission-control-replay-directory.ts), and "Mission
-- Control extends no retention" (ADR-0031). Every statement is
-- `CREATE INDEX IF NOT EXISTS`, so the migration is idempotent and
-- `bun run db:migrate` can be re-run.
--
-- Why each index exists (the replay range query for each source is
--   WHERE tenant_id = $1 AND <time> >= $lower AND <time> < $upper
--     AND (<keyset after the cursor>) ORDER BY <time>, id LIMIT n
-- and without an index whose leading columns are (tenant_id, <time>) it would
-- read every row of the tenant and sort them, once per page):
--
--   * awcms_omes_hermes_orchestration_events — the only existing time indexes
--     are (tenant_id, session_id, event_timestamp) (needs a session) and
--     (tenant_id, received_at) (the purge cursor; a different instant: replay
--     orders by the source's own event_timestamp). New:
--     (tenant_id, event_timestamp, id).
--   * awcms_omes_jobs — created_at is already served by
--     awcms_omes_jobs_tenant_created_idx. Terminal transitions are read by
--     updated_at, which has no index. New PARTIAL index
--     (tenant_id, updated_at, id) WHERE state IN ('completed','failed',
--     'cancelled'): the replay query repeats that literal list so the planner
--     can prove the predicate, and the index only carries terminal rows.
--   * awcms_omes_worker_results — no index leads with (tenant_id,
--     completed_at); the unique index is (tenant_id, server_id,
--     idempotency_key). New: (tenant_id, completed_at, id).
--   * awcms_workflow_instances — deliberately NOT indexed here. That table is
--     owned by the workflow-approval module; omes_control only holds a READ
--     exception for it (application/mission-control-directory.ts), not schema
--     ownership, so this migration must not add indexes to it. The approval
--     replay queries join through the single `omes_control.destructive_operation`
--     definition, which the workflow module's own
--     awcms_workflow_instances_definition_idx (sql/013) narrows to OMES
--     destructive-operation instances only — a small, bounded set per tenant —
--     before the tenant/time predicates and the sort apply.
--
-- Already sufficient (no new index): awcms_omes_health_snapshots and
-- awcms_omes_backup_snapshots both have (tenant_id, captured_at), and
-- awcms_omes_jobs has (tenant_id, created_at).
--
-- EXPLAIN reasoning, checked against a populated database with
-- `SET enable_seqscan = off` (small tables otherwise choose a seq scan
-- regardless): each replay query plans as an Index Scan / Bitmap scan on the
-- index named above with the time bounds as index conditions and no
-- Sort node over the whole tenant.
--
-- These are plain (non-CONCURRENT) builds because the migration runner wraps
-- each file in one transaction; the tables are append-mostly telemetry or
-- workflow instances and the build holds a SHARE lock (reads continue, writes
-- wait) for the duration of the build only.

CREATE INDEX IF NOT EXISTS awcms_omes_hermes_orchestration_events_tenant_event_ts_idx
  ON awcms_omes_hermes_orchestration_events (tenant_id, event_timestamp, id);

CREATE INDEX IF NOT EXISTS awcms_omes_jobs_tenant_terminal_updated_idx
  ON awcms_omes_jobs (tenant_id, updated_at, id)
  WHERE state IN ('completed', 'failed', 'cancelled');

CREATE INDEX IF NOT EXISTS awcms_omes_worker_results_tenant_completed_idx
  ON awcms_omes_worker_results (tenant_id, completed_at, id);
