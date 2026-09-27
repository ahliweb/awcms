-- Issue ahliweb/omes#246 (part 2 of the OMES Control Panel parity work;
-- OMES issue #183, ADR-0028, ADR-0017) — AWCMS-side projection of Hermes
-- delegated-task / subagent orchestration state, consumed from the OMES
-- vendored `hermes-orchestration-tree`/`hermes-orchestration-event` v1
-- contracts (already vendored at PIN.json commit f200c2012273de4a0e0598c5
-- bf144a5b0ce33eaa; issue #183 landed the contracts, this issue adds the
-- AWCMS-side tables/ingestion/screens that consume them).
--
-- Two tables, both tenant-scoped with FORCE ROW LEVEL SECURITY, following
-- the exact template sql/154/sql/160 already established for every other
-- omes_control table.
--
-- SECURITY / ADR-0017 boundary:
--   * Hermes owns orchestration. This is a READ-ONLY projection of state an
--     enrolled OMES pull worker reports; there is no control action here
--     that commands a Hermes agent, and no second orchestration engine.
--   * Bounded metadata projection ONLY — `nodes`/event fields are validated
--     against the vendored, `additionalProperties: false` OMES schemas at
--     ingest (application/hermes-orchestration-ingestion.ts), which makes a
--     prompt/transcript/chain-of-thought/raw-tool-argument field
--     structurally impossible to pass. `findDisallowedEvidenceKeys`
--     (domain/ai-privacy.ts, reused as-is) is a second, independent runtime
--     scan on top of that.
--   * `awcms_omes_hermes_orchestration_trees` holds ONE CURRENT row per
--     (tenant, server, session) — a new tree snapshot for the same session
--     REPLACES the prior one (upsert), matching the wire contract's own
--     framing of `hermes-orchestration-tree` as a live, current-state
--     projection, not an append-only history. `freshness` is NEVER trusted
--     from the stored/producer-sent value at read time — see
--     domain/hermes-orchestration.ts's `classifyOrchestrationFreshness` and
--     "recompute, never merely echo" discipline (same as ai-privacy).
--   * `awcms_omes_hermes_orchestration_events` is an APPEND-ONLY activity
--     log (mirrors `awcms_omes_worker_results`), deduplicated by a natural
--     idempotency key so a redelivered event is a no-op, never a duplicate
--     row.

-- 1. Live orchestration tree projection ----------------------------------
CREATE TABLE IF NOT EXISTS awcms_omes_hermes_orchestration_trees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  session_id text NOT NULL,
  root_subagent_id text NOT NULL,
  generated_at timestamptz NOT NULL,
  active_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_hermes_orchestration_trees_counts_check
    CHECK (active_count >= 0 AND completed_count >= 0 AND failed_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_hermes_orchestration_trees_target_idx
  ON awcms_omes_hermes_orchestration_trees (tenant_id, server_id, session_id);

CREATE INDEX IF NOT EXISTS awcms_omes_hermes_orchestration_trees_tenant_received_idx
  ON awcms_omes_hermes_orchestration_trees (tenant_id, received_at);

ALTER TABLE awcms_omes_hermes_orchestration_trees ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_hermes_orchestration_trees FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_hermes_orchestration_trees_tenant_isolation
  ON awcms_omes_hermes_orchestration_trees
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_hermes_orchestration_trees TO awcms_app;
GRANT SELECT, DELETE ON awcms_omes_hermes_orchestration_trees TO awcms_worker;


-- 2. Append-only orchestration activity/event log ------------------------
CREATE TABLE IF NOT EXISTS awcms_omes_hermes_orchestration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  session_id text NOT NULL,
  turn_id text,
  subagent_id text NOT NULL,
  parent_subagent_id text,
  event_type text NOT NULL,
  role text,
  goal text,
  state text NOT NULL,
  step_number integer,
  active_tool text,
  summary text,
  hermes_version text NOT NULL,
  event_timestamp timestamptz NOT NULL,
  correlation_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_hermes_orchestration_events_event_type_check
    CHECK (event_type IN ('subagent_start', 'subagent_stop', 'subagent_step', 'batch_start', 'batch_stop')),
  CONSTRAINT awcms_omes_hermes_orchestration_events_state_check
    CHECK (state IN ('PENDING', 'STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED', 'UNKNOWN'))
);

-- Idempotent replay: the same (session, subagent, event_type, step) event
-- redelivered by the pull worker's at-least-once outbox transport is a
-- no-op, never a duplicate activity-stream row. `step_number` is only
-- present on `subagent_step` events; COALESCE to -1 lets start/stop events
-- (one each, ever, per subagent) share the same unique-key shape.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_hermes_orchestration_events_dedupe_idx
  ON awcms_omes_hermes_orchestration_events (
    tenant_id, server_id, session_id, subagent_id, event_type, COALESCE(step_number, -1)
  );

CREATE INDEX IF NOT EXISTS awcms_omes_hermes_orchestration_events_tenant_session_idx
  ON awcms_omes_hermes_orchestration_events (tenant_id, session_id, event_timestamp);

CREATE INDEX IF NOT EXISTS awcms_omes_hermes_orchestration_events_tenant_received_idx
  ON awcms_omes_hermes_orchestration_events (tenant_id, received_at);

ALTER TABLE awcms_omes_hermes_orchestration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_hermes_orchestration_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_hermes_orchestration_events_tenant_isolation
  ON awcms_omes_hermes_orchestration_events
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_hermes_orchestration_events TO awcms_app;
GRANT SELECT, DELETE ON awcms_omes_hermes_orchestration_events TO awcms_worker;


-- 3. Extend the worker-nonce route allowlist (sql/159, sql/160) with the
-- two Ed25519-envelope-authenticated worker routes this issue adds:
-- `POST /api/v1/omes/worker/hermes-orchestration-tree` and
-- `POST /api/v1/omes/worker/hermes-orchestration-event` deliver OMES-
-- produced orchestration projections over the same worker transport as
-- poll/result/heartbeat/ai-privacy-posture (see domain/worker-identity.ts's
-- WorkerRoute).
ALTER TABLE awcms_omes_worker_nonces
  DROP CONSTRAINT IF EXISTS awcms_omes_worker_nonces_route_check;

ALTER TABLE awcms_omes_worker_nonces
  ADD CONSTRAINT awcms_omes_worker_nonces_route_check
    CHECK (route IN (
      'poll', 'result', 'heartbeat', 'ai-privacy-posture',
      'hermes-orchestration-tree', 'hermes-orchestration-event'
    ));
