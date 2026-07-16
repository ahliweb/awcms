-- Workflow Approval — managed, versioned, graph-based approval engine.
--
-- Ported from awcms-mini's proven `workflow-approval` module (mini
-- migrations 012 "linear approval engine" + 060 "managed graph engine",
-- consolidated here into the FINAL graph-based shape — this base has no
-- legacy linear `steps`/`current_step_order` data to migrate, so the tables
-- are created directly in their evolved form rather than replayed through
-- the mini's two-step evolution).
--
-- Draft/publish/retire lifecycle with immutable published/retired versions
-- and per-instance version pinning; generic nodes/transitions (sequential
-- approval, bounded conditional routing, parallel/join fan-out/fan-in,
-- notify); quorum/any/all approval rules; effective-dated
-- delegation/substitution; escalation/timeout policies processed by a
-- scheduled worker job (`bun run workflow:escalations:dispatch`); and
-- administrative recovery (reassign/cancel/force-decision), every action
-- append-only.
--
-- Doc 21 §3 decision tree Q5 governs condition evaluation: conditions are
-- bounded comparisons over named facts declared by a definition's
-- `facts_schema` (never arbitrary expressions/scripting/eval), and
-- module-contributed resolvers/actions are a static, reviewed-source-code
-- registry (`src/modules/workflow-approval/infrastructure/
-- condition-action-registry.ts`, mirroring `domain-event-runtime`'s
-- `DOMAIN_EVENT_CONSUMERS`), never a runtime-registration call.
--
-- Provenance note: the mini's migration 060 also issued
-- `GRANT ... TO awcms_mini_worker` least-privilege grants for the
-- escalation job. This base does not define separate `awcms_worker`/
-- `awcms_app` database roles (no role separation exists here — the worker
-- entrypoint falls back to `DATABASE_URL`), so those GRANT blocks are
-- intentionally omitted. Reintroduce them in a deployment that adds
-- least-privilege role separation.

-- =========================================================================
-- 1. awcms_workflow_definitions — versioned, lifecycle-managed definitions
-- =========================================================================

CREATE TABLE IF NOT EXISTS awcms_workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  workflow_key text NOT NULL,
  name text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1,
  lifecycle_status text NOT NULL DEFAULT 'draft',
  graph jsonb NOT NULL,
  facts_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_tenant_user_id uuid,
  published_at timestamptz,
  published_by_tenant_user_id uuid,
  retired_at timestamptz,
  retired_by_tenant_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_workflow_definitions_lifecycle_status_check
    CHECK (lifecycle_status IN ('draft', 'active', 'retired')),
  CONSTRAINT awcms_workflow_definitions_version_check
    CHECK (version >= 1)
);

-- Version history: one row per (tenant, workflow_key, version).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_workflow_definitions_key_version_dedup
  ON awcms_workflow_definitions (tenant_id, workflow_key, version)
  WHERE deleted_at IS NULL;

-- Immutability guardrail at the data layer: at most one `active` version
-- per (tenant, workflow_key) at a time — publishing a new version must
-- retire the previous active one first (enforced in application code,
-- `application/workflow-definition-directory.ts`'s `publishWorkflowDefinition`,
-- inside the SAME transaction; this partial unique index is the
-- defense-in-depth backstop).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_workflow_definitions_key_active_dedup
  ON awcms_workflow_definitions (tenant_id, workflow_key)
  WHERE deleted_at IS NULL AND lifecycle_status = 'active';

CREATE INDEX IF NOT EXISTS awcms_workflow_definitions_tenant_idx
  ON awcms_workflow_definitions (tenant_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_definitions_tenant_deleted_idx
  ON awcms_workflow_definitions (tenant_id, deleted_at);

CREATE INDEX IF NOT EXISTS awcms_workflow_definitions_tenant_lifecycle_idx
  ON awcms_workflow_definitions (tenant_id, lifecycle_status);

ALTER TABLE awcms_workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_workflow_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_workflow_definitions_tenant_isolation
  ON awcms_workflow_definitions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- =========================================================================
-- 2. awcms_workflow_instances — version-pinned, facts snapshot, cancellable
-- =========================================================================

CREATE TABLE IF NOT EXISTS awcms_workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  workflow_definition_id uuid NOT NULL REFERENCES awcms_workflow_definitions (id),
  workflow_definition_version integer NOT NULL DEFAULT 1,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by_tenant_user_id uuid NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  due_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_tenant_user_id uuid,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_workflow_instances_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS awcms_workflow_instances_tenant_idx
  ON awcms_workflow_instances (tenant_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_instances_definition_idx
  ON awcms_workflow_instances (workflow_definition_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_instances_tenant_status_idx
  ON awcms_workflow_instances (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS awcms_workflow_instances_resource_idx
  ON awcms_workflow_instances (tenant_id, resource_type, resource_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_instances_tenant_due_idx
  ON awcms_workflow_instances (tenant_id, status, due_at);

ALTER TABLE awcms_workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_workflow_instances FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_workflow_instances_tenant_isolation
  ON awcms_workflow_instances
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- =========================================================================
-- 3. awcms_workflow_tasks — one row per activated approval node instance
-- =========================================================================

CREATE TABLE IF NOT EXISTS awcms_workflow_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  workflow_instance_id uuid NOT NULL REFERENCES awcms_workflow_instances (id),
  node_id text NOT NULL,
  parent_node_id text,
  quorum_rule text NOT NULL DEFAULT 'all',
  quorum_threshold integer,
  due_at timestamptz,
  escalation_step integer NOT NULL DEFAULT 0,
  escalated_at timestamptz,
  cancelled_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_workflow_tasks_status_check
    CHECK (status IN ('pending', 'completed', 'skipped', 'cancelled')),
  CONSTRAINT awcms_workflow_tasks_quorum_rule_check
    CHECK (quorum_rule IN ('all', 'any', 'quorum')),
  CONSTRAINT awcms_workflow_tasks_quorum_threshold_check
    CHECK (quorum_threshold IS NULL OR quorum_threshold >= 1),
  CONSTRAINT awcms_workflow_tasks_escalation_step_check
    CHECK (escalation_step >= 0)
);

CREATE INDEX IF NOT EXISTS awcms_workflow_tasks_tenant_idx
  ON awcms_workflow_tasks (tenant_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_tasks_instance_idx
  ON awcms_workflow_tasks (workflow_instance_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_tasks_tenant_status_idx
  ON awcms_workflow_tasks (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS awcms_workflow_tasks_tenant_due_idx
  ON awcms_workflow_tasks (tenant_id, status, due_at);

ALTER TABLE awcms_workflow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_workflow_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_workflow_tasks_tenant_isolation
  ON awcms_workflow_tasks
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- =========================================================================
-- 4. awcms_workflow_task_assignments — eligible deciders per task
--    (needed for quorum/any/all, delegation, and reassignment history —
--    reassignment appends a new row and marks the old one 'reassigned',
--    it never overwrites/deletes, matching the append-only immutability
--    convention for anything with recorded decisions against it).
-- =========================================================================

CREATE TABLE IF NOT EXISTS awcms_workflow_task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  workflow_task_id uuid NOT NULL REFERENCES awcms_workflow_tasks (id),
  tenant_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  reassigned_to_tenant_user_id uuid,
  reassigned_at timestamptz,
  reassigned_by_tenant_user_id uuid,
  reassign_reason text,
  CONSTRAINT awcms_workflow_task_assignments_status_check
    CHECK (status IN ('pending', 'decided', 'reassigned', 'skipped'))
);

CREATE INDEX IF NOT EXISTS awcms_workflow_task_assignments_tenant_idx
  ON awcms_workflow_task_assignments (tenant_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_task_assignments_task_idx
  ON awcms_workflow_task_assignments (workflow_task_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_task_assignments_user_idx
  ON awcms_workflow_task_assignments (tenant_id, tenant_user_id, status);

ALTER TABLE awcms_workflow_task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_workflow_task_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_workflow_task_assignments_tenant_isolation
  ON awcms_workflow_task_assignments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- =========================================================================
-- 5. awcms_workflow_join_arrivals — fan-in tracking for parallel/join nodes.
--    Append-only, idempotent-by-construction (the unique index below is the
--    "a branch can only arrive once" guard): the graph engine
--    (`application/workflow-graph-engine.ts`) INSERTs `... ON CONFLICT DO
--    NOTHING` whenever a branch's traversal reaches its declared join node,
--    then counts DISTINCT `branch_node_id` rows against the join node's
--    `awaitNodeIds` to decide readiness.
-- =========================================================================

CREATE TABLE IF NOT EXISTS awcms_workflow_join_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  workflow_instance_id uuid NOT NULL REFERENCES awcms_workflow_instances (id),
  join_node_id text NOT NULL,
  branch_node_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_workflow_join_arrivals_identity_key
  ON awcms_workflow_join_arrivals (workflow_instance_id, join_node_id, branch_node_id);

CREATE INDEX IF NOT EXISTS awcms_workflow_join_arrivals_tenant_idx
  ON awcms_workflow_join_arrivals (tenant_id);

ALTER TABLE awcms_workflow_join_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_workflow_join_arrivals FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_workflow_join_arrivals_tenant_isolation
  ON awcms_workflow_join_arrivals
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- =========================================================================
-- 6. awcms_workflow_decisions — append-only / immutable decision log.
--    Same convention as awcms_abac_decision_logs (migration 005) and
--    awcms_audit_events (migration 007): a single tenant-isolation RLS
--    policy, no UPDATE ever issued against this table by application code
--    (recorded once per decision, never edited). Supports delegated
--    (`on_behalf_of`) and administrative-override decisions.
-- =========================================================================

CREATE TABLE IF NOT EXISTS awcms_workflow_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  workflow_task_id uuid NOT NULL REFERENCES awcms_workflow_tasks (id),
  decision text NOT NULL,
  decided_by_tenant_user_id uuid NOT NULL,
  on_behalf_of_tenant_user_id uuid,
  is_administrative_override boolean NOT NULL DEFAULT false,
  override_reason text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_workflow_decisions_decision_check
    CHECK (decision IN ('approve', 'reject', 'force_approve', 'force_reject'))
);

CREATE INDEX IF NOT EXISTS awcms_workflow_decisions_tenant_idx
  ON awcms_workflow_decisions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_workflow_decisions_task_idx
  ON awcms_workflow_decisions (workflow_task_id);

ALTER TABLE awcms_workflow_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_workflow_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_workflow_decisions_tenant_isolation
  ON awcms_workflow_decisions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- =========================================================================
-- 7. awcms_workflow_delegations — effective-dated substitute assignment
-- =========================================================================

CREATE TABLE IF NOT EXISTS awcms_workflow_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  delegator_tenant_user_id uuid NOT NULL,
  delegate_tenant_user_id uuid NOT NULL,
  workflow_key text,
  resource_type text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by_tenant_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_tenant_user_id uuid,
  revoke_reason text,
  CONSTRAINT awcms_workflow_delegations_status_check
    CHECK (status IN ('active', 'revoked')),
  CONSTRAINT awcms_workflow_delegations_effective_range_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT awcms_workflow_delegations_not_self_check
    CHECK (delegator_tenant_user_id <> delegate_tenant_user_id)
);

CREATE INDEX IF NOT EXISTS awcms_workflow_delegations_tenant_idx
  ON awcms_workflow_delegations (tenant_id);

-- Lookup direction used at decision time: "who may act for this delegator,
-- right now, for this workflow_key/resource_type" (domain/workflow-
-- delegation.ts's `resolveEffectiveDeciderIds`).
CREATE INDEX IF NOT EXISTS awcms_workflow_delegations_delegator_idx
  ON awcms_workflow_delegations
    (tenant_id, delegator_tenant_user_id, status, effective_from, effective_to);

-- Lookup direction used to find delegations naming a given delegate
-- (`findEligibleAssignment` in `workflow-instance-decision.ts`).
CREATE INDEX IF NOT EXISTS awcms_workflow_delegations_delegate_idx
  ON awcms_workflow_delegations
    (tenant_id, delegate_tenant_user_id, status);

ALTER TABLE awcms_workflow_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_workflow_delegations FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_workflow_delegations_tenant_isolation
  ON awcms_workflow_delegations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- =========================================================================
-- 8. Permission catalog additions (doc 17 §Registry module & activity)
-- =========================================================================

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('workflow', 'approval', 'read', 'Read workflow tasks and instances'),
  ('workflow', 'approval', 'approve', 'Record a workflow task decision'),
  ('workflow', 'definition', 'read', 'Read workflow definitions and version history'),
  ('workflow', 'definition', 'create', 'Create a new draft workflow definition'),
  ('workflow', 'definition', 'update', 'Update an existing draft workflow definition'),
  ('workflow', 'definition', 'publish', 'Publish/activate a draft workflow definition version'),
  ('workflow', 'definition', 'retire', 'Retire an active workflow definition version'),
  ('workflow', 'definition', 'delete', 'Soft-delete a draft workflow definition'),
  ('workflow', 'recovery', 'reassign', 'Reassign a pending workflow task to another tenant user'),
  ('workflow', 'recovery', 'cancel', 'Cancel a running workflow instance'),
  ('workflow', 'recovery', 'force_decide', 'Force-approve or force-reject a pending workflow task, bypassing quorum'),
  ('workflow', 'delegation', 'read', 'Read workflow delegation/substitute assignments'),
  ('workflow', 'delegation', 'create', 'Create a workflow delegation/substitute assignment'),
  ('workflow', 'delegation', 'revoke', 'Revoke a workflow delegation/substitute assignment')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
