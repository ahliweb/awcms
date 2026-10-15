-- `hr_workforce` automatic settlement of attendance corrections (#998, ADR-0132,
-- ADR-0134) -- what the domain-event dispatcher needs when it runs as
-- `awcms_worker` (`WORKER_DATABASE_URL`), and not a privilege more.
--
-- ## What this is for
--
-- `hr_workforce` now declares a domain-event consumer
-- (`hr_workforce.attendance_correction_settler`) of the workflow instance
-- verdicts (`awcms.workflow.instance.approved` / `.rejected` / `.cancelled`).
-- The dispatcher (`bun run domain-events:dispatch`) runs it inside a tenant-
-- scoped transaction on the worker connection, and it calls the same
-- `settleCorrection` the manual `POST .../settle` route calls. So the worker
-- must be able to do exactly what that function does, as `awcms_worker`.
--
-- ## Why table GRANTs and not a SECURITY DEFINER function (cf. `sql/200`)
--
-- `sql/200` (booking hold expiry) hands the worker a function because the
-- privilege it needs -- UPDATE of a reservation's `status` -- would let a cron
-- job confirm or cancel a customer's booking, and the table's trigger limits
-- WHICH transitions are legal, not WHO makes them. The corrections table is the
-- other way round: its guard trigger (`sql/198`) refuses every move that does
-- not follow the `workflow_approval` instance's own verdict, re-reads the
-- workflow's decision rows for the segregation of duties (the requester and the
-- person the correction is about can never be the approver), and refuses an
-- `approved` row with no superseding event at COMMIT. The worker therefore holds
-- no power the verdict does not already grant: it cannot approve a correction
-- the workflow did not approve, in the database, whatever the application says.
-- A function would only duplicate that logic in a second language.
--
-- ## The grants, each with its reason
--
--   * `awcms_hr_attendance_corrections`: SELECT on every column EXCEPT `reason`
--     (free text that may describe health or family circumstances: the worker
--     has no need to read it, so it cannot), and UPDATE on the four columns a
--     settlement writes (`status`, `decided_by`, `decided_at`, `updated_at`).
--     The proposal (`reason`, the proposed instant, the target) is not writable
--     by this role even before the guard trigger.
--   * `awcms_hr_attendance_events`: SELECT and INSERT. Append-only: no UPDATE
--     or DELETE, as for `awcms_app`.
--   * `awcms_hr_workforce_settings`: SELECT. The event guard reads the tenant's
--     clock-skew bound.
--   * `awcms_hr_employments`: SELECT, and UPDATE (`updated_at`) ONLY because
--     `SELECT ... FOR SHARE` -- the guards lock the parent row so a concurrent
--     delete or termination serialises with the insert -- requires UPDATE on at
--     least one column. The worker never executes an UPDATE statement on it.
--   * `awcms_workflow_instances`: UPDATE (`updated_at`), for the same
--     `FOR SHARE` reason (SELECT was already granted by `sql/022`). These two
--     `updated_at` grants are a known, accepted widening: the worker could set
--     that one timestamp, nothing else, on a row it can already read.
--   * `awcms_workflow_decisions`: SELECT on the columns that say WHO decided
--     what and on whose behalf, and NOT `reason` / `override_reason` (free text
--     written by approvers of every module). `sql/252` made the log append-only;
--     the worker reads it, never writes.
--   * `awcms_workflow_tasks` (SELECT, UPDATE since `sql/022`) and
--     `awcms_audit_events` (SELECT, INSERT, DELETE since `sql/022`) already
--     cover the rest.
--
-- ## The one thing a grant cannot express: WHICH events
--
-- INSERT on the events table is table-wide, and the event guard accepts a
-- `self` / `supervisor` / `kiosk` / `import` row from anyone who may insert. A
-- compromised worker could therefore forge an employee's clock-in. A small
-- trigger closes it: when the inserting role is a MEMBER of `awcms_worker`,
-- only a `correction`-sourced event passes, and the guard of `sql/198` in turn refuses
-- that unless an `approved` correction of the same employment, kind, instant and
-- target exists. A trigger rather than a RESTRICTIVE policy: the table's one-
-- policy shape (USING + WITH CHECK, asserted by the RLS tests) stays as it is.
--
-- The test is MEMBERSHIP (`pg_has_role(..., 'MEMBER')`), not the role's name: a
-- pooler or managed-Postgres login created `IN ROLE awcms_worker` inherits the
-- table grants, and a name comparison would let it insert a `self` event. It is
-- checked for both `session_user` and `current_user`, so neither a login nor a
-- `SET ROLE` can step around it. Superusers (implicitly "members" of every
-- role) are exempt: they bypass RLS and every grant anyway, and the migration
-- and test fixtures run as one. There is deliberately no "also a member of
-- awcms_app" exemption: that would be a dodge for whoever can grant roles. A
-- login that must both settle and record punctual events needs two
-- connections.
--
-- Column-level privileges are invisible to `has_table_privilege(..., 'UPDATE')`,
-- so `scripts/security-readiness.ts` `WORKER_ROLE_GRANTS` lists only the
-- table-level verbs added here.
--
-- Idempotent: GRANTs are repeatable.

BEGIN;

-- Table-level verbs and column-level verbs are separate statements on purpose:
-- `tests/db-role-separation-worker-setup-migration.test.ts` parses the table-
-- level ones against `WORKER_ROLE_GRANTS`, and column lists are the part that
-- must stay narrow and visible.
GRANT SELECT (id, tenant_id, employment_id, kind, target_event_id,
              proposed_kind, proposed_occurred_at, status, workflow_instance_id,
              requested_by, subject_tenant_user_id, decided_by, decided_at,
              created_at, updated_at)
  ON awcms_hr_attendance_corrections TO awcms_worker;
GRANT UPDATE (status, decided_by, decided_at, updated_at)
  ON awcms_hr_attendance_corrections TO awcms_worker;
GRANT SELECT, INSERT ON awcms_hr_attendance_events TO awcms_worker;
GRANT SELECT ON awcms_hr_workforce_settings TO awcms_worker;
GRANT SELECT ON awcms_hr_employments TO awcms_worker;
GRANT UPDATE (updated_at) ON awcms_hr_employments TO awcms_worker;
GRANT UPDATE (updated_at) ON awcms_workflow_instances TO awcms_worker;
GRANT SELECT (id, tenant_id, workflow_task_id, decision,
              decided_by_tenant_user_id, on_behalf_of_tenant_user_id,
              is_administrative_override, created_at)
  ON awcms_workflow_decisions TO awcms_worker;

CREATE OR REPLACE FUNCTION awcms_hr_guard_attendance_event_worker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source <> 'correction'
     AND NOT EXISTS (
       SELECT 1 FROM pg_roles r
        WHERE r.rolname IN (session_user, current_user) AND r.rolsuper
     )
     AND (pg_has_role(session_user, 'awcms_worker', 'MEMBER')
          OR pg_has_role(current_user, 'awcms_worker', 'MEMBER')) THEN
    RAISE EXCEPTION 'awcms_hr: HR_ATTENDANCE_WORKER_CORRECTION_ONLY'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS awcms_hr_attendance_events_worker_guard
  ON awcms_hr_attendance_events;
CREATE TRIGGER awcms_hr_attendance_events_worker_guard
  BEFORE INSERT ON awcms_hr_attendance_events
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_guard_attendance_event_worker();

COMMIT;
