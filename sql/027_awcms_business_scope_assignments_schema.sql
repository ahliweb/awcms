-- Issue #180 (epic #177 "Kesiapan fondasi ERP turunan", Wave 2 authorization)
-- — the GENERIC, tenant-scoped business-scope assignment foundation, owned by
-- `identity_access`. Ported from awcms-mini migration 061
-- (`061_awcms_mini_business_scope_assignments_schema.sql`, Issue #746) but
-- DELIBERATELY REDUCED to the generic scope layer only:
--
--   * PORTED here (this issue, #180): the two business-scope-assignment tables
--     — `awcms_business_scope_assignments` (subject -> scope grant, effective
--     dating, temporary expiry, revocation) and its append-only
--     `awcms_business_scope_assignment_events` lifecycle history.
--   * NOT ported here (belongs to #181, segregation of duties): mini 061's
--     `awcms_mini_sod_conflict_exceptions` and
--     `awcms_mini_sod_conflict_evaluations`. #180 is only the scope
--     foundation; SoD conflict/exception storage lands with the SoD enforcer
--     in a separate migration when #181 is implemented. This file leaves a
--     clean seam: nothing here references SoD.
--   * NOT ported anywhere in the base: mini's `organization_structure`
--     module (legal-entity/organization-unit) tables — a concrete ERP domain
--     that lives in a DERIVED application, never the base. `scope_type`/
--     `scope_id` below are GENERIC references precisely so the base needs no
--     such table.
--
-- `scope_type`/`scope_id` is a GENERIC reference (text + uuid), NEVER a
-- foreign key to any optional organization module's table — validity and
-- ancestry of a given `(scope_type, scope_id)` pair are resolved at the
-- APPLICATION layer through the `BusinessScopeHierarchyPort` capability
-- (`src/modules/_shared/ports/business-scope-hierarchy-port.ts`) a derived
-- application provides, never trusted from request input alone (issue #180
-- security model: "Scope derived dari request harus diverifikasi terhadap
-- resource server-side; jangan percaya scopeId dari klien sebagai fakta
-- otorisasi") and never enforceable here as a DB-level FK (there is no base
-- scope-definition table to point at). The base ships a default no-op
-- resolver (`resolved: false` for every scope type); high-risk actions
-- default-DENY when a scope is unresolved.
--
-- CROSS-TENANT SAFETY (issue #180 security model + project memory
-- `awcms-tenant-admin-office-notes`, GHSA-r7cx-c4jh-cvvw): PostgreSQL runs
-- referential-integrity checks as the table OWNER and BYPASSES row-level
-- security while doing so, so a plain `REFERENCES awcms_tenant_users (id)`
-- FK on a tenant-scoped table can still point at ANOTHER tenant's row even
-- under FORCE ROW LEVEL SECURITY. Every subject/role/actor FK below is
-- therefore a COMPOSITE `(tenant_id, <col>) REFERENCES <table> (tenant_id,
-- id)` FK — the referenced row is forced into the SAME tenant by a
-- database-level invariant no privilege level can talk its way around. This
-- is the exact pattern sql/020 established for `awcms_offices.parent_office_id`.
-- The composite FK targets need `UNIQUE (tenant_id, id)` on
-- `awcms_tenant_users`/`awcms_roles`; both are added below (the uniqueness is
-- free — `id` is already each table's primary key, so `(tenant_id, id)`
-- cannot collide; the index exists only to be referenced).
--
-- Self-grant denial ("granting yourself a business-scope assignment is
-- denied") is an APPLICATION-level check (grantor != subject, re-read from
-- the request context), not a SQL CHECK — a CHECK cannot compare the actor's
-- identity against a column. It is enforced in
-- `identity-access/application/business-scope-assignment-service.ts`.
--
-- DDL ONLY on the two OTHER-module tables it alters (adding UNIQUE
-- constraints below): `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` builds an
-- index as the owner and evaluates no RLS row qual, so the `NO FORCE -> DML
-- -> FORCE` toggle sql/018/020 needed for row-mutating cleanup is NOT
-- required here (this migration mutates no rows). Runs after sql/026;
-- `awcms_worker` (sql/022) already exists, so its GRANTs at the bottom are
-- unconditional.

BEGIN;

-- Composite-FK targets (see header). Free uniqueness on top of the existing
-- primary key `id`.
ALTER TABLE awcms_tenant_users
  ADD CONSTRAINT awcms_tenant_users_tenant_id_key UNIQUE (tenant_id, id);

ALTER TABLE awcms_roles
  ADD CONSTRAINT awcms_roles_tenant_id_key UNIQUE (tenant_id, id);

-- 1. awcms_business_scope_assignments — one row = one tenant_user granted a
--    role/permission context restricted to one business scope, with effective
--    dates, optional temporary expiry, revocation, and grantor/approver.
CREATE TABLE IF NOT EXISTS awcms_business_scope_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  tenant_user_id uuid NOT NULL,
  role_id uuid,
  scope_type text NOT NULL,
  scope_id uuid NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  is_temporary boolean NOT NULL DEFAULT false,
  reason text,
  granted_by_tenant_user_id uuid NOT NULL,
  approved_by_tenant_user_id uuid,
  status text NOT NULL DEFAULT 'active',
  revoked_at timestamptz,
  revoked_by_tenant_user_id uuid,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_business_scope_assignments_status_check
    CHECK (status IN ('active', 'expired', 'revoked')),
  CONSTRAINT awcms_business_scope_assignments_scope_type_format_check
    CHECK (scope_type ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_business_scope_assignments_effective_range_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- "A temporary assignment must have an end date" (issue #180 scope).
  CONSTRAINT awcms_business_scope_assignments_temporary_has_end_check
    CHECK (is_temporary = false OR effective_to IS NOT NULL),
  CONSTRAINT awcms_business_scope_assignments_revoked_consistency_check
    CHECK (
      (status <> 'revoked' AND revoked_at IS NULL AND revoked_by_tenant_user_id IS NULL)
      OR
      (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_tenant_user_id IS NOT NULL)
    ),
  -- Composite tenant-scoped FKs (see header — plain single-column FKs bypass
  -- RLS during the RI check and would let a tenant-A row reference a tenant-B
  -- subject/role/actor). MATCH SIMPLE (default) skips the check when the
  -- nullable side is NULL, so nullable role/approver/revoker roots stay valid.
  CONSTRAINT awcms_business_scope_assignments_subject_tenant_fkey
    FOREIGN KEY (tenant_id, tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_business_scope_assignments_role_tenant_fkey
    FOREIGN KEY (tenant_id, role_id)
    REFERENCES awcms_roles (tenant_id, id),
  CONSTRAINT awcms_business_scope_assignments_granted_by_tenant_fkey
    FOREIGN KEY (tenant_id, granted_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_business_scope_assignments_approved_by_tenant_fkey
    FOREIGN KEY (tenant_id, approved_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_business_scope_assignments_revoked_by_tenant_fkey
    FOREIGN KEY (tenant_id, revoked_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Composite-FK target for the append-only events table below.
ALTER TABLE awcms_business_scope_assignments
  ADD CONSTRAINT awcms_business_scope_assignments_tenant_id_key
  UNIQUE (tenant_id, id);

-- Subject lookup: "what scopes/roles is this tenant_user currently assigned?"
-- (drives `resolveBusinessScopeFacts` at authorization time).
CREATE INDEX IF NOT EXISTS awcms_business_scope_assignments_subject_idx
  ON awcms_business_scope_assignments (tenant_id, tenant_user_id, status);

-- Scope lookup: "who is assigned to this scope?"
CREATE INDEX IF NOT EXISTS awcms_business_scope_assignments_scope_idx
  ON awcms_business_scope_assignments (tenant_id, scope_type, scope_id, status);

-- Expiry job scan: active rows whose effective_to has passed.
CREATE INDEX IF NOT EXISTS awcms_business_scope_assignments_expiry_idx
  ON awcms_business_scope_assignments (tenant_id, effective_to)
  WHERE status = 'active' AND effective_to IS NOT NULL;

-- Role FK index (also the "role granted at any scope" lookup).
CREATE INDEX IF NOT EXISTS awcms_business_scope_assignments_role_idx
  ON awcms_business_scope_assignments (tenant_id, role_id)
  WHERE role_id IS NOT NULL;

ALTER TABLE awcms_business_scope_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_business_scope_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_business_scope_assignments_tenant_isolation
  ON awcms_business_scope_assignments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. awcms_business_scope_assignment_events — append-only lifecycle history
--    (granted/revoked/expired/renewed). Never UPDATE/DELETE, matching every
--    other append-only audit-adjacent table in this repo.
CREATE TABLE IF NOT EXISTS awcms_business_scope_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  assignment_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_tenant_user_id uuid,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT awcms_business_scope_assignment_events_event_type_check
    CHECK (event_type IN ('granted', 'revoked', 'expired', 'renewed')),
  -- Composite tenant-scoped FKs (see header).
  CONSTRAINT awcms_business_scope_assignment_events_assignment_tenant_fkey
    FOREIGN KEY (tenant_id, assignment_id)
    REFERENCES awcms_business_scope_assignments (tenant_id, id),
  CONSTRAINT awcms_business_scope_assignment_events_actor_tenant_fkey
    FOREIGN KEY (tenant_id, actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_business_scope_assignment_events_assignment_idx
  ON awcms_business_scope_assignment_events (tenant_id, assignment_id, occurred_at DESC);

ALTER TABLE awcms_business_scope_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_business_scope_assignment_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_business_scope_assignment_events_tenant_isolation
  ON awcms_business_scope_assignment_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- `awcms_worker` (sql/022) grants — exactly what
-- `scripts/identity-access-business-scope-expiry.ts` touches: SELECT the
-- expiry backlog + refresh gauges, UPDATE active assignments past their
-- `effective_to` to `expired`, INSERT the resulting lifecycle event rows. No
-- DELETE anywhere (this job never removes a row, only transitions status).
-- The job's aggregate audit INSERT goes to `awcms_audit_events`, already
-- granted to `awcms_worker` in sql/022. `awcms_app` needs no explicit grant:
-- both tables are tenant-scoped and covered by sql/019's `ALTER DEFAULT
-- PRIVILEGES` blanket grant to `awcms_app` for future tables.
--
-- NOTE (mini divergence): mini 061 also granted the SoD-exception table to
-- its worker; that table is #181's, not here, so no such grant exists.
GRANT SELECT, UPDATE ON awcms_business_scope_assignments TO awcms_worker;
-- INSERT only (no RETURNING, never read by the job) — tighter than mini 061,
-- which also granted SELECT here.
GRANT INSERT ON awcms_business_scope_assignment_events TO awcms_worker;

COMMIT;
