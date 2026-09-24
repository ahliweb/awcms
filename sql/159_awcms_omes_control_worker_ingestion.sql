-- Issue ahliweb/omes#199 (ADR-0122) — worker enrollment/poll/result/heartbeat
-- ingestion schema. Additive only; 154-158 are untouched.
--
-- Adds:
--   * awcms_omes_worker_nonces      — atomic nonce/replay store for the
--     session-unauthenticated, asymmetric-identity-authenticated worker
--     endpoints (poll/result/heartbeat). A worker request is verified by an
--     Ed25519 signature over a canonical string, not by a session, so this
--     table is the only thing standing between a captured-and-replayed
--     request and a second execution. Consumption is a single
--     `INSERT ... ON CONFLICT (tenant_id, worker_id, nonce) DO NOTHING
--     RETURNING id` — the same atomic-CAS-via-unique-index pattern
--     `awcms_idempotency_keys` already uses (never a read-then-write, and
--     never `err.code === "23505"`, which is dead code on this driver: the
--     Postgres SQLSTATE Bun.SQL surfaces is on `error.errno`).
--   * awcms_omes_worker_results     — canonical, idempotent ledger of what a
--     worker REPORTED for a job. Deliberately separate from
--     `awcms_omes_jobs.result` (#198): every row is stamped
--     `source = 'worker_reported'` and `reconciled = false` by default, so no
--     reader of this table can mistake "the worker said succeeded" for
--     "OMES independently confirmed it succeeded" — a 2xx response to
--     POST /api/v1/omes/worker/result is an acknowledgement of receipt, never
--     a verdict. Reconciliation (flipping `reconciled`) is intentionally left
--     to a future evidence cross-check against `awcms_omes_health_snapshots`/
--     `awcms_omes_audit_projections`, out of this issue's scope, so the
--     column defaults closed rather than never existing.
--   * awcms_omes_jobs.operation_request_id gets a PARTIAL UNIQUE index — the
--     promotion of an `approved` operation_request into a queued job
--     (application/worker-job-queue.ts, needed for the poll endpoint to have
--     anything to lease — #198 only ever left operation_requests in
--     'approved' and never itself wrote a job row) must create AT MOST ONE
--     job per operation_request even under concurrent pollers; this index is
--     the DB-level backstop behind that promotion's own `FOR UPDATE SKIP
--     LOCKED` claim.
--   * awcms_omes_servers gets `last_heartbeat_evidence jsonb` — redacted,
--     worker-reported telemetry (omes_version/contract_version/capability
--     digest/uptime/last_reconciliation_at) attributed explicitly to
--     `omes-host` self-report, never merged into anything that could be read
--     as independently-verified health.

-- 1. Nonce / replay-protection store -----------------------------------------
CREATE TABLE IF NOT EXISTS awcms_omes_worker_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  worker_id text NOT NULL,
  nonce text NOT NULL,
  route text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT awcms_omes_worker_nonces_route_check
    CHECK (route IN ('poll', 'result', 'heartbeat'))
);

-- Composite FK: (tenant_id, worker_id) must reference a real enrollment row.
-- A PLAIN single-column FK on worker_id would let a nonce row for tenant A
-- reference a worker_id that only exists under tenant B (worker_id is
-- globally unique-looking but the uniqueness constraint it actually relies on
-- is (tenant_id, worker_id) — see sql/154). FK enforcement runs past RLS, so
-- this composite form is what actually prevents that cross-tenant reference.
ALTER TABLE awcms_omes_worker_nonces
  ADD CONSTRAINT awcms_omes_worker_nonces_enrollment_fk
    FOREIGN KEY (tenant_id, worker_id)
    REFERENCES awcms_omes_enrollments (tenant_id, worker_id)
    ON DELETE CASCADE;

-- The unique index a concurrent nonce-consumption race relies on.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_worker_nonces_replay_idx
  ON awcms_omes_worker_nonces (tenant_id, worker_id, nonce);

CREATE INDEX IF NOT EXISTS awcms_omes_worker_nonces_expiry_idx
  ON awcms_omes_worker_nonces (expires_at);

ALTER TABLE awcms_omes_worker_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_worker_nonces FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_worker_nonces_tenant_isolation ON awcms_omes_worker_nonces
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- SELECT is required in addition to INSERT: `INSERT ... RETURNING id` needs
-- SELECT privilege on the returned column, not only INSERT privilege on the
-- table (the same over-narrow-grant trap PR #818's readiness gate now checks
-- for in both directions). DELETE is granted for a future retention sweep
-- (module.ts's dataLifecycle entry below); rows are never UPDATEd.
GRANT SELECT, INSERT, DELETE ON awcms_omes_worker_nonces TO awcms_app, awcms_worker;


-- 2. Worker-reported job results ledger --------------------------------------
CREATE TABLE IF NOT EXISTS awcms_omes_worker_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  worker_id text NOT NULL,
  job_id text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL,
  reported_state text NOT NULL,
  source text NOT NULL DEFAULT 'worker_reported',
  reconciled boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_worker_results_state_check
    CHECK (reported_state IN ('succeeded', 'failed', 'rejected')),
  CONSTRAINT awcms_omes_worker_results_source_check
    CHECK (source = 'worker_reported')
);

-- The idempotent-ingestion unique index: a retrying worker (or a duplicate
-- delivery) posting the identical (job_id, idempotency_key) twice must be
-- recorded exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_worker_results_idem_idx
  ON awcms_omes_worker_results (tenant_id, server_id, job_id, idempotency_key);

CREATE INDEX IF NOT EXISTS awcms_omes_worker_results_tenant_job_idx
  ON awcms_omes_worker_results (tenant_id, job_id);

-- Composite FK into awcms_omes_jobs' own (tenant_id, job_id) unique index
-- (sql/154) — same cross-tenant-reference reasoning as the nonces FK above.
ALTER TABLE awcms_omes_worker_results
  ADD CONSTRAINT awcms_omes_worker_results_job_fk
    FOREIGN KEY (tenant_id, job_id)
    REFERENCES awcms_omes_jobs (tenant_id, job_id)
    ON DELETE CASCADE;

ALTER TABLE awcms_omes_worker_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_worker_results FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_worker_results_tenant_isolation ON awcms_omes_worker_results
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON awcms_omes_worker_results TO awcms_app, awcms_worker;


-- 3. Job-queue promotion backstop --------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_jobs_operation_request_unique_idx
  ON awcms_omes_jobs (operation_request_id)
  WHERE operation_request_id IS NOT NULL;


-- 4. Redacted heartbeat telemetry on the server row --------------------------
ALTER TABLE awcms_omes_servers
  ADD COLUMN IF NOT EXISTS last_heartbeat_evidence jsonb;
