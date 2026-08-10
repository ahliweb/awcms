-- Gelombang 3 PR 3.1 (Issue #423), ADR-0078 — a grant that carries its own scope.
--
-- Today a grant is `awcms_access_assignments (tenant_user_id, role_id)` and
-- answers one question: does this person hold this role, ANYWHERE in the tenant.
-- A Policy answers a narrower one: this person holds this role AT THIS SCOPE.
-- That is the shape Cloudflare's Policy has (`actor + permission_groups +
-- resource_groups`), and it is what makes "editor of one office" expressible
-- without inventing a second authorization axis.
--
-- ## Why a NEW table rather than columns on `awcms_access_assignments`
--
-- Three reasons, and the first is the one that settles it:
--
--   1. `awcms_access_assignments_key UNIQUE (tenant_id, tenant_user_id, role_id)`
--      is precisely what has to die — one role at three scopes is three rows.
--      Dropping a unique index on a live authorization table, in the same
--      migration that widens what the table means, is the change with the worst
--      failure mode available here.
--   2. Extending `awcms_business_scope_assignments` in place would rewrite the
--      two SoD readers in the same PR (`business-scope-facts.ts:286-372`), so a
--      scope-shape change and an SoD-precision change would land together and
--      neither could be reverted alone.
--   3. A third table permits expand/migrate/contract with NO dual-write: this
--      one lands empty, `fetchGrantedPermissionKeys` reads BOTH, and with the
--      new table empty the union is byte-identical to today's answer.
--
-- ## `subject_type` accepts one value, on purpose
--
-- The program plan lists `('tenant_user', 'user_group')` and a XOR across two
-- subject columns. User groups do not exist yet (Gelombang 3 PR 3.5), so a
-- CHECK listing `'user_group'` — or a `user_group_id` column with no table to
-- reference — would read as a shipped capability and could never be satisfied.
-- The same discipline `sql/100` applied to `origin_auth`: the fourth value is
-- one `DROP CONSTRAINT` / `ADD CONSTRAINT` away, in the migration that makes it
-- producible.
--
-- The column exists NOW rather than being added later because it is what the
-- XOR will discriminate on, and adding a discriminator to a populated table is
-- a backfill; adding a value to its CHECK is not.
--
-- ## `scope_id` is NOT NULL, and a tenant-wide grant stores the tenant id
--
-- The convention `access-control.ts` already documents for `TENANT_WIDE_SCOPE_TYPE`
-- ("`scopeId` for such a fact is conventionally the tenant id, but coverage does
-- not depend on it"). Matching `awcms_business_scope_assignments` column for
-- column matters for PR 3.3, which backfills one into the other and keeps the
-- original `id` so audit references survive.
--
-- ## CROSS-TENANT SAFETY
--
-- Every subject/role/actor reference is a COMPOSITE `(tenant_id, <col>)` FK, for
-- the reason `sql/027` records in full: PostgreSQL runs referential-integrity
-- checks as the table OWNER and BYPASSES row-level security while doing so, so a
-- plain `REFERENCES awcms_tenant_users (id)` can still point at another tenant's
-- row under FORCE ROW LEVEL SECURITY. The `UNIQUE (tenant_id, id)` targets this
-- needs on `awcms_tenant_users` and `awcms_roles` already exist (`sql/027`).
--
-- Pure DDL — this migration mutates no rows, so the `NO FORCE -> DML -> FORCE`
-- toggle that `sql/018`/`sql/020` needed does not apply.

BEGIN;

-- 1. awcms_access_policies — one row = one subject granted one role, confined to
--    one scope, with effective dating and revocation.
CREATE TABLE IF NOT EXISTS awcms_access_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  subject_type text NOT NULL DEFAULT 'tenant_user',
  tenant_user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  scope_type text NOT NULL DEFAULT 'tenant',
  scope_id uuid NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  status text NOT NULL DEFAULT 'active',
  reason text,
  granted_by_tenant_user_id uuid,
  revoked_at timestamptz,
  revoked_by_tenant_user_id uuid,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_access_policies_subject_type_check
    CHECK (subject_type IN ('tenant_user')),
  CONSTRAINT awcms_access_policies_status_check
    CHECK (status IN ('active', 'expired', 'revoked')),
  CONSTRAINT awcms_access_policies_scope_type_format_check
    CHECK (scope_type ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_access_policies_effective_range_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT awcms_access_policies_revoked_consistency_check
    CHECK (
      (status <> 'revoked' AND revoked_at IS NULL)
      OR
      (status = 'revoked' AND revoked_at IS NOT NULL)
    ),
  CONSTRAINT awcms_access_policies_subject_tenant_fkey
    FOREIGN KEY (tenant_id, tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_access_policies_role_tenant_fkey
    FOREIGN KEY (tenant_id, role_id)
    REFERENCES awcms_roles (tenant_id, id),
  CONSTRAINT awcms_access_policies_granted_by_tenant_fkey
    FOREIGN KEY (tenant_id, granted_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_access_policies_revoked_by_tenant_fkey
    FOREIGN KEY (tenant_id, revoked_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- Composite-FK target for the append-only events table below.
ALTER TABLE awcms_access_policies
  ADD CONSTRAINT awcms_access_policies_tenant_id_key UNIQUE (tenant_id, id);

-- The authorization-path lookup: "which roles does this subject hold, active,
-- right now". Partial on `status` because every read on the hot path filters it.
CREATE INDEX IF NOT EXISTS awcms_access_policies_subject_idx
  ON awcms_access_policies (tenant_id, tenant_user_id)
  WHERE status = 'active';

-- Role FK index (`db:fk-index:check`), and the "who holds this role" lookup.
CREATE INDEX IF NOT EXISTS awcms_access_policies_role_idx
  ON awcms_access_policies (tenant_id, role_id);

-- Scope lookup: "who may act on this scope?"
CREATE INDEX IF NOT EXISTS awcms_access_policies_scope_idx
  ON awcms_access_policies (tenant_id, scope_type, scope_id)
  WHERE status = 'active';

-- Expiry scan: active rows whose effective_to has passed.
CREATE INDEX IF NOT EXISTS awcms_access_policies_expiry_idx
  ON awcms_access_policies (tenant_id, effective_to)
  WHERE status = 'active' AND effective_to IS NOT NULL;

-- Actor FK indexes (`db:fk-index:check`).
CREATE INDEX IF NOT EXISTS awcms_access_policies_granted_by_idx
  ON awcms_access_policies (tenant_id, granted_by_tenant_user_id)
  WHERE granted_by_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_access_policies_revoked_by_idx
  ON awcms_access_policies (tenant_id, revoked_by_tenant_user_id)
  WHERE revoked_by_tenant_user_id IS NOT NULL;

-- One active grant of one role at one scope per subject. Partial on `status` so
-- a revoked row never blocks re-granting the same thing later — which is the
-- ordinary case, not an edge one.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_access_policies_active_key
  ON awcms_access_policies (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
  WHERE status = 'active';

ALTER TABLE awcms_access_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_access_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_access_policies_tenant_isolation
  ON awcms_access_policies
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. awcms_access_policy_events — append-only lifecycle history, same shape and
--    same rule as `awcms_business_scope_assignment_events`: never UPDATE, never
--    DELETE. A grant's history is the only record of who widened someone's
--    access and when, and a mutable history answers that question unreliably.
CREATE TABLE IF NOT EXISTS awcms_access_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  policy_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_tenant_user_id uuid,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT awcms_access_policy_events_event_type_check
    CHECK (event_type IN ('granted', 'revoked', 'expired')),
  CONSTRAINT awcms_access_policy_events_policy_tenant_fkey
    FOREIGN KEY (tenant_id, policy_id)
    REFERENCES awcms_access_policies (tenant_id, id),
  CONSTRAINT awcms_access_policy_events_actor_tenant_fkey
    FOREIGN KEY (tenant_id, actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_access_policy_events_policy_idx
  ON awcms_access_policy_events (tenant_id, policy_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS awcms_access_policy_events_actor_idx
  ON awcms_access_policy_events (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;

ALTER TABLE awcms_access_policy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_access_policy_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_access_policy_events_tenant_isolation
  ON awcms_access_policy_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

COMMENT ON TABLE awcms_access_policies IS
  'A role grant that carries its own scope (ADR-0078). Read alongside awcms_access_assignments by fetchGrantedPermissionKeys; scope_type = ''tenant'' is tenant-wide and is the only shape written until Gelombang 3 PR 3.4 qualifies scope at evaluation time.';

COMMENT ON COLUMN awcms_access_policies.subject_type IS
  'Accepts ''tenant_user'' only. ''user_group'' arrives with the user-group tables (Gelombang 3 PR 3.5) — a CHECK listing a value nothing can produce would read as a shipped capability.';

COMMIT;
