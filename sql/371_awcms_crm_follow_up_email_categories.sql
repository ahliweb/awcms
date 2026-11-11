-- crm_follow_up -- the three staff notification categories the worker may
-- queue, and what a worker-queued row in them may contain (Issue #1165,
-- ADR-0159 section 2; audit of PR #1266, LOW-1).
--
-- `bun run crm-follow-up:dispatch` runs as `awcms_worker` and hands a due
-- follow-up notice to the existing `WorkflowNotificationPort`, whose `email`
-- adapter inserts ONE row into `awcms_email_messages` (the provider is called
-- later by `bun run email:dispatch`, outside any transaction). sql/302 gave the
-- worker that column-scoped INSERT and a row guard that refuses every category
-- not on a short allow-list; adding a category to the worker's repertoire is,
-- by that migration's own rule, a migration that replaces the guard function.
--
-- This one adds EXACTLY three categories, each addressed to a tenant user (the
-- assignee or the escalation recipient), never to a lead:
--
--   crm.follow_up_assigned    a follow-up task was assigned to you
--   crm.follow_up_due         a follow-up task assigned to you is due
--   crm.follow_up_escalated   a follow-up task was escalated to you
--
-- ## The application allow-list is not a database control
--
-- The variable allow-list of these categories (`email-template-categories.ts`:
-- `userName`, `taskTitle`, `dueAt`, `taskReference`) is enforced by the
-- APPLICATION's renderer. A compromised worker writes rows directly, so on its
-- own that list would not stop it from queueing lead data or mailing an
-- outside address. For these three categories the guard therefore also checks,
-- for an insert by a member of `awcms_worker`:
--
--   * `to_address` is the (normalised, lower-case) login e-mail of an ACTIVE
--     user of the row's own tenant: staff only, never an outside address;
--   * every key of `variables` is on the category's allow-list.
--
-- The three `hr.attendance_correction_*` categories of sql/302 keep exactly
-- their sql/302 behaviour (category check only); superusers stay exempt;
-- membership is tested for both `session_user` and `current_user`; the
-- function pins its `search_path` ending in `pg_temp`. The recipient lookup
-- reads `awcms_tenant_users (tenant_id, identity_id, status)` and
-- `awcms_identities (id, tenant_id, login_identifier)`, columns the worker
-- already holds (sql/302, sql/304); it runs under the row's tenant context, so
-- FORCE RLS confines it to that tenant too.
--
-- No grant changes.

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

  IF NEW.category NOT IN ('hr.attendance_correction_applied',
                          'hr.attendance_correction_rejected',
                          'hr.attendance_correction_cancelled',
                          'crm.follow_up_assigned',
                          'crm.follow_up_due',
                          'crm.follow_up_escalated') THEN
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
