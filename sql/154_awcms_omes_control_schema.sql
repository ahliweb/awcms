-- ADR-0122 / Issue ahliweb/omes#196 — OMES Control Center domain module schema.
--
-- Provides tenant-scoped infrastructure tables for managing host servers,
-- worker enrollments, desired vs observed deployments, operation requests,
-- job execution queues, health snapshots, backup snapshots, and host audit
-- projections.
--
-- SECURITY & ISOLATION:
--   * Every table carries tenant_id with FK to awcms_tenants(id) ON DELETE CASCADE.
--   * Row Level Security (RLS) is both ENABLED and FORCED on every table.
--   * Tenant isolation policy enforces app.current_tenant_id GUC context.
--   * Least-privilege DML privileges granted to awcms_app and awcms_worker.
--   * Zero raw secrets (no private keys or SSH keys) are permitted.

-- 1. Servers (Fleet inventory & host telemetry)
CREATE TABLE IF NOT EXISTS awcms_omes_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  hostname text NOT NULL,
  ip text,
  os_name text,
  os_version text,
  arch text,
  status text NOT NULL DEFAULT 'offline',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_servers_status_check CHECK (status IN ('offline', 'online', 'degraded', 'maintenance', 'decommissioned'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_servers_tenant_server_idx
  ON awcms_omes_servers (tenant_id, server_id);

CREATE INDEX IF NOT EXISTS awcms_omes_servers_tenant_status_idx
  ON awcms_omes_servers (tenant_id, status);

CREATE INDEX IF NOT EXISTS awcms_omes_servers_tenant_created_idx
  ON awcms_omes_servers (tenant_id, created_at);

ALTER TABLE awcms_omes_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_servers FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_servers_tenant_isolation ON awcms_omes_servers
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_servers TO awcms_app, awcms_worker;


-- 2. Enrollments (Worker public credentials & registration status)
CREATE TABLE IF NOT EXISTS awcms_omes_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  worker_id text NOT NULL,
  public_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  enrolled_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_enrollments_status_check CHECK (status IN ('pending', 'enrolled', 'revoked', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_enrollments_tenant_worker_idx
  ON awcms_omes_enrollments (tenant_id, worker_id);

CREATE INDEX IF NOT EXISTS awcms_omes_enrollments_tenant_server_idx
  ON awcms_omes_enrollments (tenant_id, server_id);

CREATE INDEX IF NOT EXISTS awcms_omes_enrollments_tenant_created_idx
  ON awcms_omes_enrollments (tenant_id, created_at);

ALTER TABLE awcms_omes_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_enrollments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_enrollments_tenant_isolation ON awcms_omes_enrollments
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_enrollments TO awcms_app, awcms_worker;


-- 3. Deployments (Desired vs observed configuration & drift reconciliation)
CREATE TABLE IF NOT EXISTS awcms_omes_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  deployment_id text NOT NULL,
  server_id text NOT NULL,
  desired_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_status text NOT NULL DEFAULT 'pending',
  error_evidence jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_deployments_status_check CHECK (reconciliation_status IN ('pending', 'in_progress', 'converged', 'drifted', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_deployments_tenant_deployment_idx
  ON awcms_omes_deployments (tenant_id, deployment_id);

CREATE INDEX IF NOT EXISTS awcms_omes_deployments_tenant_server_idx
  ON awcms_omes_deployments (tenant_id, server_id);

CREATE INDEX IF NOT EXISTS awcms_omes_deployments_tenant_updated_idx
  ON awcms_omes_deployments (tenant_id, updated_at);

ALTER TABLE awcms_omes_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_deployments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_deployments_tenant_isolation ON awcms_omes_deployments
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_deployments TO awcms_app, awcms_worker;


-- 4. Operation Requests (Tenant-authorized operation intent & idempotency tracking)
CREATE TABLE IF NOT EXISTS awcms_omes_operation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  server_id text NOT NULL,
  operation text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'requested',
  idempotency_key text,
  requested_by text,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_op_req_status_check CHECK (status IN ('requested', 'approved', 'rejected', 'dispatched', 'completed', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_op_req_tenant_request_idx
  ON awcms_omes_operation_requests (tenant_id, request_id);

CREATE INDEX IF NOT EXISTS awcms_omes_op_req_tenant_server_idx
  ON awcms_omes_operation_requests (tenant_id, server_id);

CREATE INDEX IF NOT EXISTS awcms_omes_op_req_tenant_created_idx
  ON awcms_omes_operation_requests (tenant_id, created_at);

ALTER TABLE awcms_omes_operation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_operation_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_operation_requests_tenant_isolation ON awcms_omes_operation_requests
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_operation_requests TO awcms_app, awcms_worker;


-- 5. Jobs (Worker queue, leases, payloads, and results)
CREATE TABLE IF NOT EXISTS awcms_omes_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  job_id text NOT NULL,
  operation_request_id uuid REFERENCES awcms_omes_operation_requests(id) ON DELETE SET NULL,
  server_id text NOT NULL,
  operation text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  leased_by text,
  leased_until timestamptz,
  retry_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_jobs_state_check CHECK (state IN ('queued', 'leased', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_jobs_tenant_job_idx
  ON awcms_omes_jobs (tenant_id, job_id);

CREATE INDEX IF NOT EXISTS awcms_omes_jobs_tenant_poll_idx
  ON awcms_omes_jobs (tenant_id, server_id, state, created_at);

CREATE INDEX IF NOT EXISTS awcms_omes_jobs_tenant_created_idx
  ON awcms_omes_jobs (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS awcms_omes_jobs_op_req_idx
  ON awcms_omes_jobs (operation_request_id);

ALTER TABLE awcms_omes_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_jobs_tenant_isolation ON awcms_omes_jobs
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_jobs TO awcms_app, awcms_worker;


-- 6. Health Snapshots (Host health checks & telemetry history)
CREATE TABLE IF NOT EXISTS awcms_omes_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  overall_status text NOT NULL,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_health_overall_check CHECK (overall_status IN ('healthy', 'degraded', 'unhealthy'))
);

CREATE INDEX IF NOT EXISTS awcms_omes_health_snapshots_tenant_server_idx
  ON awcms_omes_health_snapshots (tenant_id, server_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS awcms_omes_health_snapshots_tenant_captured_idx
  ON awcms_omes_health_snapshots (tenant_id, captured_at);

CREATE INDEX IF NOT EXISTS awcms_omes_health_snapshots_captured_at_idx
  ON awcms_omes_health_snapshots (captured_at);

ALTER TABLE awcms_omes_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_health_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_health_snapshots_tenant_isolation ON awcms_omes_health_snapshots
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_health_snapshots TO awcms_app, awcms_worker;


-- 7. Backup Snapshots (Backup manifests, sizes, checksums, and verification)
CREATE TABLE IF NOT EXISTS awcms_omes_backup_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  backup_id text NOT NULL,
  server_id text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  size_bytes bigint,
  checksum text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_backup_status_check CHECK (status IN ('completed', 'in_progress', 'verified', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_backup_snapshots_tenant_backup_idx
  ON awcms_omes_backup_snapshots (tenant_id, backup_id);

CREATE INDEX IF NOT EXISTS awcms_omes_backup_snapshots_tenant_server_idx
  ON awcms_omes_backup_snapshots (tenant_id, server_id);

CREATE INDEX IF NOT EXISTS awcms_omes_backup_snapshots_tenant_captured_idx
  ON awcms_omes_backup_snapshots (tenant_id, captured_at);

ALTER TABLE awcms_omes_backup_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_backup_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_backup_snapshots_tenant_isolation ON awcms_omes_backup_snapshots
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_backup_snapshots TO awcms_app, awcms_worker;


-- 8. Audit Projections (Remote OMES execution & reconciliation evidence projection)
CREATE TABLE IF NOT EXISTS awcms_omes_audit_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  source_event_id text NOT NULL,
  event_type text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_audit_tenant_server_event_idx
  ON awcms_omes_audit_projections (tenant_id, server_id, source_event_id);

CREATE INDEX IF NOT EXISTS awcms_omes_audit_tenant_recorded_idx
  ON awcms_omes_audit_projections (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS awcms_omes_audit_recorded_at_idx
  ON awcms_omes_audit_projections (recorded_at);

ALTER TABLE awcms_omes_audit_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_audit_projections FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_audit_projections_tenant_isolation ON awcms_omes_audit_projections
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_audit_projections TO awcms_app, awcms_worker;
