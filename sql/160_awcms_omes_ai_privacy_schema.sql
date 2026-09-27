-- Issue ahliweb/omes#232 (ADR-0122, OMES ADR-0029) — AWCMS-side consumption
-- of the OMES AI-privacy posture and egress-approval Control Center
-- contracts (OMES issue #217): `ai-privacy-posture-view`,
-- `ai-egress-approval.request`/`.response`.
--
-- Two tables, both tenant-scoped with FORCE ROW LEVEL SECURITY, following
-- the exact template sql/154/sql/159 already established for every other
-- omes_control table.
--
-- SECURITY:
--   * Bounded metadata projection ONLY. No column here can ever hold a
--     prompt, transcript, chain-of-thought, or raw provider response - the
--     JSON payload persisted into `evidence`/`latest_decision` is validated
--     against the vendored OMES `ai-privacy-posture-view.schema.json` at
--     ingest (which is itself `additionalProperties: false` throughout, so
--     such a field is structurally rejected before it ever reaches this
--     table) - see application/ai-privacy-ingestion.ts.
--   * `awcms_omes_ai_egress_approvals` carries a CHECK constraint making a
--     RESTRICTED classification resolving to a cloud_sanitized destination
--     structurally impossible to store as an approvable/approved row - a
--     second, independent backstop behind the application-layer check in
--     domain/ai-privacy.ts's `authorizeAiEgressApproval` (mirroring OMES's
--     own `posture_projection.py`'s `authorize_approval()` unconditional
--     `_RESTRICTED_CLOUD` refusal) and the UI never rendering an approve
--     control for that combination at all.
--   * The approval DECISION itself is recorded by the existing
--     `workflow-approval` engine (`awcms_workflow_instances`) - this table
--     records the AWCMS-facing approval REQUEST/outcome envelope, never a
--     second approval authority. `workflow_instance_id` is a nullable FK.

-- 1. AI privacy posture projection --------------------------------------
CREATE TABLE IF NOT EXISTS awcms_omes_ai_privacy_posture (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  server_id text NOT NULL,
  deployment_id text,
  authority text NOT NULL,
  classification_mode text NOT NULL DEFAULT 'unknown',
  destination_class text NOT NULL DEFAULT 'unknown',
  local_endpoint_classification text,
  status text NOT NULL DEFAULT 'BLOCKED',
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_verified_at timestamptz,
  projected_at timestamptz NOT NULL,
  latest_decision jsonb,
  correlation_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_ai_privacy_posture_authority_check
    CHECK (authority IN ('hermes', 'omes-host', 'awcms')),
  CONSTRAINT awcms_omes_ai_privacy_posture_classification_mode_check
    CHECK (classification_mode IN ('fail_closed_v1', 'unknown')),
  CONSTRAINT awcms_omes_ai_privacy_posture_destination_class_check
    CHECK (destination_class IN ('local', 'private', 'cloud', 'unknown')),
  CONSTRAINT awcms_omes_ai_privacy_posture_status_check
    CHECK (status IN ('PASS', 'FAIL', 'WARN', 'BLOCKED'))
);

-- One current row per (tenant, target) - a new projection for the same
-- target REPLACES the prior one (upsert), matching the wire contract's own
-- framing of `ai-privacy-posture-view` as "the tenant-scoped ... read
-- projection", not an append-only history.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_ai_privacy_posture_tenant_target_idx
  ON awcms_omes_ai_privacy_posture (tenant_id, server_id, COALESCE(deployment_id, ''));

CREATE INDEX IF NOT EXISTS awcms_omes_ai_privacy_posture_tenant_received_idx
  ON awcms_omes_ai_privacy_posture (tenant_id, received_at);

ALTER TABLE awcms_omes_ai_privacy_posture ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_ai_privacy_posture FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_ai_privacy_posture_tenant_isolation ON awcms_omes_ai_privacy_posture
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_ai_privacy_posture TO awcms_app;
GRANT SELECT, DELETE ON awcms_omes_ai_privacy_posture TO awcms_worker;


-- 2. AI egress owner-approval requests -----------------------------------
CREATE TABLE IF NOT EXISTS awcms_omes_ai_egress_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants(id) ON DELETE CASCADE,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  server_id text NOT NULL,
  deployment_id text,
  policy_version text NOT NULL,
  classification text NOT NULL,
  destination text NOT NULL,
  reason_code text NOT NULL,
  justification text,
  requested_approve boolean NOT NULL,
  decision text NOT NULL DEFAULT 'pending',
  decision_reason text,
  decision_reason_code text,
  workflow_instance_id uuid REFERENCES awcms_workflow_instances(id) ON DELETE SET NULL,
  requested_by_tenant_user_id uuid REFERENCES awcms_tenant_users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_omes_ai_egress_approvals_classification_check
    CHECK (classification IN ('CONFIDENTIAL', 'RESTRICTED')),
  CONSTRAINT awcms_omes_ai_egress_approvals_destination_check
    CHECK (destination IN ('private_endpoint', 'cloud_sanitized')),
  CONSTRAINT awcms_omes_ai_egress_approvals_reason_code_check
    CHECK (reason_code IN (
      'AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_PRIVATE_ENDPOINT',
      'AI_EGRESS_APPROVAL_REQUIRED_CONFIDENTIAL_CLOUD_SANITIZED',
      'AI_EGRESS_APPROVAL_REQUIRED_RESTRICTED_PRIVATE_ENDPOINT'
    )),
  CONSTRAINT awcms_omes_ai_egress_approvals_decision_check
    CHECK (decision IN ('pending', 'approved', 'denied')),
  -- The structural, unconditional backstop this issue requires: RESTRICTED
  -- classification may NEVER resolve to a cloud_sanitized destination,
  -- independent of reason_code (mirroring OMES posture_projection.py's
  -- `_RESTRICTED_CLOUD` check "by value", not merely via the reason_code
  -- enum above, which already excludes this pair by construction - this
  -- CHECK stays valid even if a future reason_code addition ever loosened
  -- that enum without re-deriving this constraint). This blocks the
  -- combination from ever being stored as PENDING or APPROVED (the only
  -- states that could reach a real egress) — it deliberately does NOT block
  -- storing it as `decision = 'denied'`, because `submitAiEgressApproval`
  -- (application/ai-egress-approval.ts) must still record a durable audit
  -- row for a structurally-refused RESTRICTED->cloud_sanitized REQUEST
  -- (a denial needs no approval authority and leaves no route to a real
  -- egress, but it must still be visible in the approvals history).
  CONSTRAINT awcms_omes_ai_egress_approvals_no_restricted_cloud_check
    CHECK (
      NOT (
        classification = 'RESTRICTED' AND destination = 'cloud_sanitized'
        AND decision <> 'denied'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_omes_ai_egress_approvals_tenant_idem_idx
  ON awcms_omes_ai_egress_approvals (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS awcms_omes_ai_egress_approvals_tenant_server_idx
  ON awcms_omes_ai_egress_approvals (tenant_id, server_id);

CREATE INDEX IF NOT EXISTS awcms_omes_ai_egress_approvals_tenant_created_idx
  ON awcms_omes_ai_egress_approvals (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS awcms_omes_ai_egress_approvals_workflow_instance_idx
  ON awcms_omes_ai_egress_approvals (workflow_instance_id);

CREATE INDEX IF NOT EXISTS awcms_omes_ai_egress_approvals_requester_idx
  ON awcms_omes_ai_egress_approvals (requested_by_tenant_user_id);

ALTER TABLE awcms_omes_ai_egress_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_omes_ai_egress_approvals FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_omes_ai_egress_approvals_tenant_isolation ON awcms_omes_ai_egress_approvals
  FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_ai_egress_approvals TO awcms_app;
GRANT SELECT, DELETE ON awcms_omes_ai_egress_approvals TO awcms_worker;


-- 3. Extend the worker-nonce route allowlist (sql/159) with the fourth
-- Ed25519-envelope-authenticated worker route this issue adds:
-- `POST /api/v1/omes/worker/ai-privacy-posture` delivers an OMES-produced
-- `ai-privacy-posture-view` projection over the same worker transport as
-- poll/result/heartbeat (see domain/worker-identity.ts's WorkerRoute).
ALTER TABLE awcms_omes_worker_nonces
  DROP CONSTRAINT IF EXISTS awcms_omes_worker_nonces_route_check;

ALTER TABLE awcms_omes_worker_nonces
  ADD CONSTRAINT awcms_omes_worker_nonces_route_check
    CHECK (route IN ('poll', 'result', 'heartbeat', 'ai-privacy-posture'));
