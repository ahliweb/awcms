-- Gelombang 3 PR 3.3 (Issue #423), ADR-0079 — the legacy grant table becomes
-- read-only history.
--
-- `sql/102` created `awcms_access_policies` empty and had the authorization path
-- read BOTH tables, so the answer could not change. PR 3.2 pointed every writer
-- at the new table. This migration finishes the move: every legacy row is copied
-- across KEEPING ITS `id`, and `awcms_app` loses `INSERT`/`UPDATE`/`DELETE` on
-- the old one.
--
-- ## Why the `id` is kept
--
-- Audit rows name a grant by its id (`recordAuditEvent` metadata on
-- assign/unassign), and so do operator notes and incident tickets. A backfill
-- that minted new ids would leave every one of those references pointing at
-- nothing, silently, and the only place that mattered would be an investigation
-- months later. `awcms_access_policies.id` has no meaning of its own, so there is
-- nothing to trade against keeping it.
--
-- ## Why the readers stop reading the old table IN THIS CHANGE
--
-- The legacy rows are RETAINED rather than deleted — that is what makes this
-- "history" rather than "a table that used to have rows". But a retained row
-- that still counted would be a grant nobody can take away: revocation now
-- transitions a POLICY to `revoked`, and the `DELETE` that used to remove the
-- legacy twin is no longer permitted. So the union in
-- `fetchGrantedPermissionKeys` had to collapse in the same change that revoked
-- the privilege. Reading and writing were never separable here.
--
-- Deploy ordering follows from that, and it is the ordinary one: migrations run
-- before the new release serves traffic. The release BEFORE this one still holds
-- correct behaviour after the migration applies (its readers see the legacy rows,
-- which are still there and still accurate); the one statement it would fail is
-- the legacy `DELETE` inside an unassign, for the length of the deploy.
--
-- ## Why `awcms_business_scope_assignments` is NOT part of this
--
-- The program plan says PR 3.3 retires "the two old tables". It retires one.
-- A `awcms_business_scope_assignments` row carries a `role_id` that grants NO
-- permission keys today — `fetchGrantedPermissionKeys` has never read that table;
-- only SoD does, and only as a fact. Copying those rows into
-- `awcms_access_policies` would therefore hand every scope-assigned subject that
-- role's permissions ACROSS THE WHOLE TENANT, because nothing qualifies scope at
-- evaluation time until PR 3.4. Its `role_id` is also nullable, and
-- `awcms_access_policies.role_id` is not, so a scope-membership row with no role
-- has no shape to become. Retiring it is a decision that belongs after scope
-- qualification, not before it.
--
-- ## DML on FORCE RLS tables
--
-- All three tables touched here are `FORCE ROW LEVEL SECURITY`, so the owner is
-- subject to the tenant policy too, and this backfill is deliberately
-- cross-tenant — there is no single `app.current_tenant_id` to SET, and leaving
-- it unset aborts with `unrecognized configuration parameter`. That failure
-- appears only where rows exist, i.e. it would pass on an empty CI database and
-- break on a populated production one. Dropping FORCE for the duration is the
-- honest way to say "this statement is deliberately tenant-wide"; the runner
-- wraps each migration in one transaction and `ALTER TABLE` takes ACCESS
-- EXCLUSIVE, so no concurrent session can observe the table while FORCE is off
-- (the pattern and its reasoning are `sql/018`'s).

BEGIN;

ALTER TABLE awcms_access_assignments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_access_policies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_access_policy_events NO FORCE ROW LEVEL SECURITY;

-- 1. Copy every resolvable legacy grant across, keeping its id, and give each
--    one the `granted` lifecycle event its history table expects.
--
-- The joins to `awcms_roles` and `awcms_tenant_users` are INNER and COMPOSITE on
-- purpose. The legacy table's FKs are single-column (`REFERENCES awcms_roles (id)`),
-- which — as `sql/027` records — cannot stop a row from naming another tenant's
-- role, while `awcms_access_policies`' composite FKs can and would abort the whole
-- migration on one such row. A cross-tenant legacy row grants nothing today
-- either (every reader filters the role by tenant, and RLS hides it regardless),
-- so leaving it behind changes no access. The DO block below refuses to let that
-- be silent.
--
-- `assigned_by` is carried only when it resolves to a tenant user in the SAME
-- tenant. It has never had a foreign key, so it may hold an identity id, a
-- deleted user, or a value from a tenant that no longer exists; `NULL` says "not
-- known" where a fabricated actor would say something false.
WITH moved AS (
  INSERT INTO awcms_access_policies
    (id, tenant_id, subject_type, tenant_user_id, role_id, scope_type, scope_id,
     effective_from, status, reason, granted_by_tenant_user_id,
     created_at, updated_at)
  SELECT
    aa.id,
    aa.tenant_id,
    'tenant_user',
    aa.tenant_user_id,
    aa.role_id,
    'tenant',
    aa.tenant_id,
    aa.created_at,
    'active',
    'migrated from awcms_access_assignments (sql/103)',
    actor.id,
    aa.created_at,
    aa.created_at
  FROM awcms_access_assignments aa
  JOIN awcms_tenant_users subject
    ON subject.id = aa.tenant_user_id AND subject.tenant_id = aa.tenant_id
  JOIN awcms_roles granted_role
    ON granted_role.id = aa.role_id AND granted_role.tenant_id = aa.tenant_id
  LEFT JOIN awcms_tenant_users actor
    ON actor.id = aa.assigned_by AND actor.tenant_id = aa.tenant_id
  WHERE NOT EXISTS (
      SELECT 1 FROM awcms_access_policies ap WHERE ap.id = aa.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM awcms_access_policies ap
      WHERE ap.tenant_id = aa.tenant_id
        AND ap.tenant_user_id = aa.tenant_user_id
        AND ap.role_id = aa.role_id
        AND ap.scope_type = 'tenant'
        AND ap.scope_id = aa.tenant_id
        AND ap.status = 'active'
    )
  RETURNING id, tenant_id, granted_by_tenant_user_id, reason, created_at
)
INSERT INTO awcms_access_policy_events
  (tenant_id, policy_id, event_type, actor_tenant_user_id, reason, occurred_at, metadata)
SELECT
  moved.tenant_id,
  moved.id,
  'granted',
  moved.granted_by_tenant_user_id,
  moved.reason,
  moved.created_at,
  '{"source": "sql/103", "migrated_from": "awcms_access_assignments"}'::jsonb
FROM moved;

-- 2. Say out loud what could not be moved.
--
-- A silent skip here would read as "there was nothing to move". The count is a
-- WARNING rather than an exception because a dangling legacy row grants nothing
-- today and blocking a deployment on it would trade a real outage for a
-- bookkeeping defect — but it must appear in the deploy log, because the rows
-- stay behind and nothing else will ever mention them again.
DO $$
DECLARE
  stranded bigint;
BEGIN
  SELECT count(*) INTO stranded
  FROM awcms_access_assignments aa
  WHERE NOT EXISTS (
    SELECT 1 FROM awcms_access_policies ap WHERE ap.id = aa.id
  );

  IF stranded > 0 THEN
    RAISE WARNING
      'sql/103: % awcms_access_assignments row(s) were NOT migrated to awcms_access_policies — each names a role or subject that does not resolve within its own tenant, so it granted nothing before this migration either. They remain in the retired table as history.',
      stranded;
  END IF;
END;
$$;

ALTER TABLE awcms_access_policy_events FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_access_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_access_assignments FORCE ROW LEVEL SECURITY;

-- 3. History means the rows cannot change.
--
-- `SELECT` is deliberately retained: an investigator answering "who held what in
-- March" reaches these rows through the same connection as everything else, and
-- taking the read away would make the history unreachable rather than immutable.
-- No application code may name the table — `access:grant-readers:check` fails any
-- file that does — so the retained SELECT is for humans and for `pg_dump`.
REVOKE INSERT, UPDATE, DELETE ON awcms_access_assignments FROM awcms_app;
REVOKE INSERT ON awcms_access_assignments FROM awcms_setup;

-- 4. The setup wizard writes the tenant's first grant, and since PR 3.2 it writes
--    it to `awcms_access_policies` — a table `awcms_setup` held no privilege on.
--
-- Under `SETUP_DATABASE_URL` (the opt-in least-privilege split, `sql/022`) the
-- one-time bootstrap has therefore been failing with `permission denied for table
-- awcms_access_policies` since that PR, with no gate able to see it:
-- `checkWorkerSetupRoleGrants` asserts the grants match the declared matrix, and
-- both sides still agreed. The matrix moves with this migration
-- (`SETUP_ROLE_GRANTS` in `scripts/security-readiness.ts`).
--
-- `SELECT` on the policies table because the bootstrap's INSERT uses
-- `RETURNING id`; the events table is INSERT-only, no RETURNING — the same
-- reasoning `sql/022` applies verb by verb.
GRANT SELECT, INSERT ON awcms_access_policies TO awcms_setup;
GRANT INSERT ON awcms_access_policy_events TO awcms_setup;

COMMENT ON TABLE awcms_access_assignments IS
  'RETIRED (ADR-0079, sql/103). Read-only history of role grants made before awcms_access_policies became the single grant table; every row here was copied there keeping its id. awcms_app holds SELECT only. No application code may name this table — access:grant-readers:check enforces it — because a row here can no longer be revoked and would grant access no administrator could take away.';

COMMIT;
