-- Reporting module — module-contributed read-model projections, incremental
-- updates, idempotent rebuild, freshness/staleness, source reconciliation,
-- and scheduled exports (ported from awcms-mini Issue #753, epic
-- platform-evolution Wave 3). Seven tables, ALL tenant-scoped
-- (`ENABLE`+`FORCE ROW LEVEL SECURITY`) — `reporting` NEVER writes another
-- module's transactional table; every projection descriptor (source
-- table/cursor column/metric rules) lives in CODE
-- (`ModuleDescriptor.reportingProjections`, `src/modules/_shared/
-- module-contract.ts`), declared by each owning module's own `module.ts` —
-- never mirrored into a database table here.
--
-- 1. `awcms_reporting_projection_state` — per (tenant, projection)
--    freshness bookkeeping: last attempt/success timestamps, consecutive
--    failure count, last error. Read-time-computed freshness status
--    (`reporting/domain/freshness.ts`) is derived from these raw facts,
--    never stored as a cached enum.
-- 2. `awcms_reporting_projection_cursors` — per (tenant, projection,
--    stream) bounded-scan resume position, shared by BOTH the steady-state
--    incremental worker and a rebuild-in-progress (mutually exclusive by
--    construction via the partial unique index on rebuild_runs below).
-- 3. `awcms_reporting_projection_metrics` — the actual materialized
--    read-model values: one non-negative counter per (tenant, projection,
--    metric).
-- 4. `awcms_reporting_rebuild_runs` — rebuild execution/progress state.
--    Only ONE `status = 'running'` row may exist per (tenant, projection)
--    at a time (enforced by the partial unique index below) — the core
--    mechanism behind the crash-mid-rebuild idempotency guarantee.
-- 5. `awcms_reporting_reconciliation_runs` — on-demand comparisons of a
--    projection's metric value against a freshly computed control total.
-- 6. `awcms_reporting_scheduled_exports` — tenant-configured periodic
--    export descriptors (soft-deletable config).
-- 7. `awcms_reporting_export_runs` — manifest/checksum/expiry evidence for
--    each executed export (manual or scheduled).
--
-- No `GRANT ... TO awcms_worker`/`awcms_app` block: this base does not
-- define separate least-privilege database roles (the worker entrypoint
-- falls back to `DATABASE_URL`), same convention migrations 013/014
-- already document. When role separation is introduced, the projection
-- worker jobs need SELECT+INSERT+UPDATE on the projection state/cursor/
-- metric/export_run tables, SELECT+UPDATE (never INSERT) on rebuild_runs,
-- SELECT on scheduled_exports, and SELECT on the source tables
-- (`awcms_abac_decision_logs`, `awcms_identities`, `awcms_sync_nodes`,
-- `awcms_domain_events`).
CREATE TABLE IF NOT EXISTS awcms_reporting_projection_state (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  projection_key text NOT NULL,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_error_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, projection_key),
  CONSTRAINT awcms_reporting_projection_state_key_format_check
    CHECK (projection_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_reporting_projection_state_failures_check
    CHECK (consecutive_failures >= 0)
);

ALTER TABLE awcms_reporting_projection_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_reporting_projection_state FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_reporting_projection_state_tenant_isolation
  ON awcms_reporting_projection_state
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_reporting_projection_cursors (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  projection_key text NOT NULL,
  stream_key text NOT NULL,
  cursor_value timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, projection_key, stream_key),
  CONSTRAINT awcms_reporting_projection_cursors_key_format_check
    CHECK (projection_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

ALTER TABLE awcms_reporting_projection_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_reporting_projection_cursors FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_reporting_projection_cursors_tenant_isolation
  ON awcms_reporting_projection_cursors
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_reporting_projection_metrics (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  projection_key text NOT NULL,
  metric_key text NOT NULL,
  metric_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, projection_key, metric_key),
  CONSTRAINT awcms_reporting_projection_metrics_key_format_check
    CHECK (projection_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_reporting_projection_metrics_value_check
    CHECK (metric_value >= 0)
);

ALTER TABLE awcms_reporting_projection_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_reporting_projection_metrics FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_reporting_projection_metrics_tenant_isolation
  ON awcms_reporting_projection_metrics
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_reporting_rebuild_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  projection_key text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  rows_processed bigint NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  requested_by uuid,
  reason text,
  error_message text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_reporting_rebuild_runs_key_format_check
    CHECK (projection_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_reporting_rebuild_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT awcms_reporting_rebuild_runs_rows_processed_check
    CHECK (rows_processed >= 0)
);

-- The single most important constraint in this migration: guarantees, at
-- the database level (not merely application-code discipline), that at
-- most one rebuild of a given (tenant, projection) can ever be
-- `'running'` at a time. A concurrent second "trigger rebuild" call fails
-- this unique index instead of starting a second reset that would race the
-- first run's cursor/metric writes and risk double-counting.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_reporting_rebuild_runs_running_unique
  ON awcms_reporting_rebuild_runs (tenant_id, projection_key)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS awcms_reporting_rebuild_runs_history_idx
  ON awcms_reporting_rebuild_runs (tenant_id, projection_key, created_at DESC);

ALTER TABLE awcms_reporting_rebuild_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_reporting_rebuild_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_reporting_rebuild_runs_tenant_isolation
  ON awcms_reporting_rebuild_runs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_reporting_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  projection_key text NOT NULL,
  mismatch boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid,
  correlation_id text,
  executed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_reporting_reconciliation_runs_key_format_check
    CHECK (projection_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

CREATE INDEX IF NOT EXISTS awcms_reporting_reconciliation_runs_history_idx
  ON awcms_reporting_reconciliation_runs (tenant_id, projection_key, executed_at DESC);

ALTER TABLE awcms_reporting_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_reporting_reconciliation_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_reporting_reconciliation_runs_tenant_isolation
  ON awcms_reporting_reconciliation_runs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_reporting_scheduled_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  projection_key text NOT NULL,
  format text NOT NULL,
  schedule_interval_minutes integer NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_reporting_scheduled_exports_key_format_check
    CHECK (projection_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_reporting_scheduled_exports_format_check
    CHECK (format IN ('csv', 'json')),
  CONSTRAINT awcms_reporting_scheduled_exports_interval_check
    CHECK (schedule_interval_minutes > 0)
);

CREATE INDEX IF NOT EXISTS awcms_reporting_scheduled_exports_active_idx
  ON awcms_reporting_scheduled_exports (tenant_id, enabled)
  WHERE deleted_at IS NULL;

ALTER TABLE awcms_reporting_scheduled_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_reporting_scheduled_exports FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_reporting_scheduled_exports_tenant_isolation
  ON awcms_reporting_scheduled_exports
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_reporting_export_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  scheduled_export_id uuid REFERENCES awcms_reporting_scheduled_exports (id),
  projection_key text NOT NULL,
  format text NOT NULL,
  status text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  checksum_sha256 text,
  storage_path text,
  error_message text,
  expires_at timestamptz,
  requested_by uuid,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT awcms_reporting_export_runs_key_format_check
    CHECK (projection_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_reporting_export_runs_format_check
    CHECK (format IN ('csv', 'json')),
  CONSTRAINT awcms_reporting_export_runs_status_check
    CHECK (status IN ('completed', 'failed')),
  CONSTRAINT awcms_reporting_export_runs_row_count_check
    CHECK (row_count >= 0)
);

CREATE INDEX IF NOT EXISTS awcms_reporting_export_runs_scheduled_idx
  ON awcms_reporting_export_runs (tenant_id, scheduled_export_id, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_reporting_export_runs_history_idx
  ON awcms_reporting_export_runs (tenant_id, projection_key, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_reporting_export_runs_expiry_idx
  ON awcms_reporting_export_runs (tenant_id, expires_at);

ALTER TABLE awcms_reporting_export_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_reporting_export_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_reporting_export_runs_tenant_isolation
  ON awcms_reporting_export_runs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
