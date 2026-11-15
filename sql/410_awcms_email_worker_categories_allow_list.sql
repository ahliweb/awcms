-- The worker's e-mail category allow-list becomes DATA (Issue #1277, ADR-0164).
--
-- ## What was wrong
--
-- `sql/302` made the guard trigger `awcms_email_messages_worker_guard` refuse an
-- INSERT by a member of `awcms_worker` unless the category was on a list, and it
-- wrote that list as a literal inside the function body (the three
-- `hr.attendance_correction_*` categories); `sql/371` (crm_follow_up, #1165)
-- re-issued the function to add three `crm.follow_up_*` categories and the
-- recipient / variable-key conditions that go with them. The LATEST body is
-- sql/371's, and that is the one this migration preserves. Adding a category to the worker's
-- repertoire therefore meant re-issuing the whole function. A downstream
-- template that needed one more category did exactly that, in its own
-- migration, and so silently overrode every later upstream change to the
-- function (a fix to the membership test, to the search_path, to the error
-- code) with a stale copy of its body.
--
-- ## What this does
--
-- The list is the table `awcms_email_worker_categories`, one row per category.
-- A module that enqueues e-mail from a worker transaction adds ITS row in ITS
-- migration (`INSERT ... ON CONFLICT DO NOTHING`) and never touches the
-- function. This migration replaces the function exactly once, to read the
-- table; no migration after it may re-issue it (`bun run
-- extension-points:check` fails on one).
--
-- ## Fail-closed, and read-only for the runtime roles
--
-- * An EMPTY table refuses every worker insert: the test is NOT EXISTS over the
--   table, so the absence of a row, never the presence of a row for something
--   else, is what denies.
-- * `awcms_app` and `awcms_worker` hold SELECT and nothing else. The guard runs
--   as the inserting role, so the worker needs SELECT to evaluate it; neither
--   role can add, change or remove a row, because a runtime path that could add
--   a category could widen what the INSERT guard admits, and no tenant column exists
--   here for RLS to police (the same reasoning as `awcms_plan_entitlements`,
--   sql/109). Adding a category is a migration, reviewed with the module that
--   needs it. The guard is BEFORE INSERT only: `awcms_worker` also holds a
--   table-level UPDATE on awcms_email_messages (sql/022) that the guard does not
--   see, a pre-existing gap handled separately, and the descriptor flag `workerInsert` is cross-checked against
--   the seeded rows by the gate.
-- * Everything else of the sql/371 body is unchanged: the membership test is
--   checked for BOTH `session_user` and `current_user`, superusers exempt,
--   `search_path` pinned ending in `pg_temp`; a worker-queued `crm.follow_up_*`
--   row still needs `to_address` to be the login e-mail of an ACTIVE user of
--   its own tenant and `variables` to hold only the four allow-listed keys.
--   The table is read only after the cheap membership test, so a request-path
--   insert never depends on a row.
--
-- Seed: the exact union sql/371's body allowed (three hr + three crm), so
-- behaviour is unchanged. `bun run extension-points:check` reads the literal
-- list of the latest pre-410 body and fails if the seed does not cover it, and
-- a descriptor (`workerEmailCategories`) must claim every seeded base row.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS awcms_email_worker_categories (
  category text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_email_worker_categories_category_format
    CHECK (category ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE awcms_email_worker_categories IS
  'Global allow-list of e-mail categories an awcms_worker transaction may enqueue (Issue #1277, ADR-0164). Read by awcms_email_guard_worker_insert; read-only at runtime. A module seeds its row in its own migration.';

INSERT INTO awcms_email_worker_categories (category) VALUES
  ('hr.attendance_correction_applied'),
  ('hr.attendance_correction_rejected'),
  ('hr.attendance_correction_cancelled'),
  ('crm.follow_up_assigned'),
  ('crm.follow_up_due'),
  ('crm.follow_up_escalated')
ON CONFLICT (category) DO NOTHING;

-- The default privileges of sql/019 grant `awcms_app` every verb on a new
-- table, which is right for tenant tables and wrong here (sql/109 says the same
-- for the catalogues). Revoke, then give the two runtime roles SELECT only.
REVOKE ALL ON awcms_email_worker_categories FROM awcms_app;
REVOKE ALL ON awcms_email_worker_categories FROM awcms_worker;
GRANT SELECT ON awcms_email_worker_categories TO awcms_app;
GRANT SELECT ON awcms_email_worker_categories TO awcms_worker;

CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  by_worker boolean;
BEGIN
  by_worker :=
    NOT EXISTS (
      SELECT 1 FROM pg_roles r
       WHERE r.rolname IN (session_user, current_user) AND r.rolsuper
    )
    AND (pg_has_role(session_user, 'awcms_worker', 'MEMBER')
         OR pg_has_role(current_user, 'awcms_worker', 'MEMBER'));

  IF NOT by_worker THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM awcms_email_worker_categories c
        WHERE c.category = NEW.category
     ) THEN
    RAISE EXCEPTION 'awcms_email: EMAIL_WORKER_CATEGORY_NOT_ALLOWED'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.category IN ('crm.follow_up_assigned',
                      'crm.follow_up_due',
                      'crm.follow_up_escalated') THEN
    IF NOT EXISTS (
      SELECT 1
        FROM awcms_tenant_users tu
        JOIN awcms_identities i
          ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
       WHERE tu.tenant_id = NEW.tenant_id
         AND tu.status = 'active'
         AND lower(btrim(i.login_identifier)) = NEW.to_address
    ) THEN
      RAISE EXCEPTION 'awcms_email: EMAIL_WORKER_RECIPIENT_NOT_STAFF'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.variables IS NOT NULL
       AND (jsonb_typeof(NEW.variables) <> 'object'
            OR EXISTS (
              SELECT 1 FROM jsonb_object_keys(NEW.variables) AS k(key)
               WHERE k.key NOT IN ('userName', 'taskTitle', 'dueAt',
                                   'taskReference')
            )) THEN
      RAISE EXCEPTION 'awcms_email: EMAIL_WORKER_VARIABLE_NOT_ALLOWED'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
