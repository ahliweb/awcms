-- crm_follow_up -- the three staff notification categories the worker may
-- queue (Issue #1165, ADR-0159 section 2).
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
-- Their variable allow-list (`email-template-categories.ts`) is `userName`,
-- `taskTitle`, `dueAt` and `taskReference`: there is no slot for a lead's name,
-- contact value or note, so a compromised worker gains no way to put one in a
-- mail. The three `hr.attendance_correction_*` categories of sql/302 are kept
-- unchanged. Nothing else about the guard changes: membership is tested for
-- both `session_user` and `current_user`, superusers are exempt, and the
-- function pins its `search_path` ending in `pg_temp`.
--
-- No grant changes: the column-scoped INSERT and the recipient lookups were
-- granted by sql/302.

CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.category NOT IN ('hr.attendance_correction_applied',
                          'hr.attendance_correction_rejected',
                          'hr.attendance_correction_cancelled',
                          'crm.follow_up_assigned',
                          'crm.follow_up_due',
                          'crm.follow_up_escalated')
     AND NOT EXISTS (
       SELECT 1 FROM pg_roles r
        WHERE r.rolname IN (session_user, current_user) AND r.rolsuper
     )
     AND (pg_has_role(session_user, 'awcms_worker', 'MEMBER')
          OR pg_has_role(current_user, 'awcms_worker', 'MEMBER')) THEN
    RAISE EXCEPTION 'awcms_email: EMAIL_WORKER_CATEGORY_NOT_ALLOWED'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
