-- Issue #181 (epic #177 "Kesiapan fondasi ERP turunan", Wave 2 authorization)
-- — the segregation-of-duties (SoD) conflict exception + evaluation-log
-- tables, owned by `identity_access`. Ported from awcms-mini migration 061
-- (`061_awcms_mini_business_scope_assignments_schema.sql`, Issue #746), which
-- carried these two tables together with the business-scope-assignment tables;
-- awcms split the assignment foundation into #180's `sql/027` and deferred the
-- SoD tables to this migration.
--
--   1. `awcms_sod_conflict_exceptions` — the bounded-lifetime exception /
--      administrative override flow: a scope-bound, time-bound, revocable,
--      audited approval to proceed despite a detected SoD conflict. `effective_to`
--      is NOT NULL — "no indefinite override" (issue #181: exceptions must be
--      time-bound).
--   2. `awcms_sod_conflict_evaluations` — append-only decision log for every SoD
--      conflict check (assignment-create AND high-risk-action chokepoints),
--      mirroring `awcms_abac_decision_logs`'s shape/spirit (sql/005) — recorded
--      regardless of outcome (issue #181: "Setiap deny/override/exception
--      lifecycle masuk audit dan decision log").
--
-- `rule_key` matches a `SoDRuleDescriptor.ruleKey` from the CODE registry
-- (`identity-access/domain/sod-rule-registry.ts`) — deliberately NOT a database
-- foreign key, since the registry is code, not a table (same convention #180's
-- `scope_type`/`scope_id` generic references already established: the base ships
-- no rule table; a derived application contributes the rules).
--
-- CROSS-TENANT SAFETY (issue #181: "Exception tenant A tidak dapat dipakai
-- tenant B"; project memory `awcms-tenant-admin-office-notes`,
-- GHSA-r7cx-c4jh-cvvw): PostgreSQL runs referential-integrity checks as the
-- table OWNER and BYPASSES row-level security, so a plain
-- `REFERENCES awcms_tenant_users (id)` FK on a tenant-scoped table can still
-- point at ANOTHER tenant's row even under FORCE ROW LEVEL SECURITY. Every
-- subject/requester/approver FK below is therefore a COMPOSITE
-- `(tenant_id, <col>) REFERENCES awcms_tenant_users (tenant_id, id)` FK — the
-- referenced row is forced into the SAME tenant by a database-level invariant.
-- The composite target `awcms_tenant_users (tenant_id, id)` already has its
-- `UNIQUE (tenant_id, id)` constraint (`awcms_tenant_users_tenant_id_key`,
-- added in sql/027); no further DDL on that table is needed here.
--
-- Self-approval denial ("requested_by_tenant_user_id != approved_by_tenant_user_id",
-- issue #181: "Exception tidak boleh self-approved") is an APPLICATION-level
-- rule, re-checked from the DB row (never trusted from a request body) in
-- `sod-exception-service.ts`'s `approveSoDConflictException` — a SQL CHECK
-- cannot express "the acting approver must differ from this row's requester".
--
-- Runs after sql/028; `awcms_worker` (sql/022) already exists, so its GRANTs at
-- the bottom are unconditional. `awcms_app` needs no explicit grant: both tables
-- are tenant-scoped (RLS FORCE'd) and covered by sql/019's `ALTER DEFAULT
-- PRIVILEGES` blanket grant to `awcms_app`.

BEGIN;

-- 1. awcms_sod_conflict_exceptions — bounded-lifetime override to a detected
--    SoD conflict.
CREATE TABLE IF NOT EXISTS awcms_sod_conflict_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  rule_key text NOT NULL,
  subject_tenant_user_id uuid NOT NULL,
  scope_type text,
  scope_id uuid,
  justification text NOT NULL,
  requested_by_tenant_user_id uuid NOT NULL,
  approved_by_tenant_user_id uuid,
  status text NOT NULL DEFAULT 'pending',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_sod_conflict_exceptions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')),
  CONSTRAINT awcms_sod_conflict_exceptions_rule_key_format_check
    CHECK (rule_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_sod_conflict_exceptions_scope_pair_check
    CHECK ((scope_type IS NULL) = (scope_id IS NULL)),
  CONSTRAINT awcms_sod_conflict_exceptions_effective_range_check
    CHECK (effective_to > effective_from),
  -- Composite tenant-scoped FKs (see header — plain single-column FKs bypass
  -- RLS during the RI check and would let a tenant-A exception reference a
  -- tenant-B subject/requester/approver). MATCH SIMPLE (default) skips the
  -- check when the nullable side is NULL, so the nullable approver stays valid.
  CONSTRAINT awcms_sod_conflict_exceptions_subject_tenant_fkey
    FOREIGN KEY (tenant_id, subject_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_sod_conflict_exceptions_requested_by_tenant_fkey
    FOREIGN KEY (tenant_id, requested_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_sod_conflict_exceptions_approved_by_tenant_fkey
    FOREIGN KEY (tenant_id, approved_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_sod_conflict_exceptions_subject_idx
  ON awcms_sod_conflict_exceptions (tenant_id, subject_tenant_user_id, status);

CREATE INDEX IF NOT EXISTS awcms_sod_conflict_exceptions_rule_idx
  ON awcms_sod_conflict_exceptions (tenant_id, rule_key, status);

-- Approved-exception validity lookup: "is there a currently-valid exception for
-- (rule_key, subject) covering this scope?" — partial index on the only status
-- the chokepoint queries at decision time, and the only status the expiry job
-- sweeps.
CREATE INDEX IF NOT EXISTS awcms_sod_conflict_exceptions_active_lookup_idx
  ON awcms_sod_conflict_exceptions (tenant_id, rule_key, subject_tenant_user_id, effective_to)
  WHERE status = 'approved';

ALTER TABLE awcms_sod_conflict_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_sod_conflict_exceptions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_sod_conflict_exceptions_tenant_isolation
  ON awcms_sod_conflict_exceptions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. awcms_sod_conflict_evaluations — append-only SoD conflict-check decision
--    log, recorded regardless of outcome. Never UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS awcms_sod_conflict_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  rule_key text NOT NULL,
  subject_tenant_user_id uuid,
  trigger_context text NOT NULL,
  conflict_detected boolean NOT NULL,
  resolved_via text NOT NULL DEFAULT 'none',
  decision_reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT awcms_sod_conflict_evaluations_trigger_context_check
    CHECK (trigger_context IN ('assignment_create', 'high_risk_decision')),
  CONSTRAINT awcms_sod_conflict_evaluations_resolved_via_check
    CHECK (resolved_via IN ('none', 'exception', 'denied')),
  -- Composite tenant-scoped FK (nullable subject — a system/anonymous
  -- evaluation may carry no subject).
  CONSTRAINT awcms_sod_conflict_evaluations_subject_tenant_fkey
    FOREIGN KEY (tenant_id, subject_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_sod_conflict_evaluations_subject_idx
  ON awcms_sod_conflict_evaluations (tenant_id, subject_tenant_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS awcms_sod_conflict_evaluations_rule_idx
  ON awcms_sod_conflict_evaluations (tenant_id, rule_key, occurred_at DESC);

ALTER TABLE awcms_sod_conflict_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_sod_conflict_evaluations FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_sod_conflict_evaluations_tenant_isolation
  ON awcms_sod_conflict_evaluations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- `awcms_worker` (sql/022) grants — exactly what
-- `scripts/identity-access-business-scope-expiry.ts`'s SoD-exception expiry
-- pass touches: SELECT the approved-but-elapsed backlog, UPDATE those rows to
-- `expired`. No DELETE (the job never removes a row, only transitions status),
-- and NO access to `awcms_sod_conflict_evaluations` (that table is only ever
-- written by the request-path chokepoint on `awcms_app`, never the worker).
-- The job's per-exception audit INSERT goes to `awcms_audit_events`, already
-- granted to `awcms_worker` in sql/022. Keep `scripts/security-readiness.ts`'s
-- `WORKER_ROLE_GRANTS` policy in sync with this grant (project memory
-- `awcms-business-scope-port-notes` §7).
GRANT SELECT, UPDATE ON awcms_sod_conflict_exceptions TO awcms_worker;

COMMIT;
