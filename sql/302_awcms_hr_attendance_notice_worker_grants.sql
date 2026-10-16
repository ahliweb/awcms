-- `hr_workforce` notifies the requester when an attendance correction is settled
-- (#1044, follow-up to #998) -- what the domain-event dispatcher needs, as
-- `awcms_worker`, to ENQUEUE one e-mail from inside the settling consumer, and
-- not a privilege more.
--
-- ## What this is for
--
-- `hr_workforce.attendance_correction_settler` (sql/280) now hands the requester
-- an e-mail through the `workflow_notification` capability port, whose adapter
-- (`email`) calls `enqueueAnnouncement`. That is a database write of one outbox
-- row (`awcms_email_messages`); the provider is called later by
-- `bun run email:dispatch`, outside any transaction. The enqueue resolves the
-- recipient (tenant user -> identity -> profile), honours the suppression list,
-- and renders the subject from the tenant's template. As the worker connection
-- that needs:
--
--   * `awcms_email_messages`: INSERT, COLUMN-scoped to the ten columns the
--     enqueue writes. The worker already holds SELECT/UPDATE/DELETE (sql/022,
--     sql/095) for the dispatcher and the purge; INSERT is the verb it was
--     deliberately denied, and a column list keeps it from choosing `status`,
--     `provider_*`, `sent_at` or `retry_count` on a row it creates (they take
--     their defaults: a new message is always `queued`).
--   * `awcms_tenant_users`: SELECT (id, tenant_id, identity_id, status) -- to
--     find the requester's login and skip an inactive one.
--   * `awcms_profiles`: SELECT (id, tenant_id, display_name) -- the greeting
--     name and the employee's name. NOT the contact or identifier columns.
--   * `awcms_identities` (SELECT) and `awcms_email_templates` /
--     `awcms_email_suppression_list` (SELECT) are already granted.
--
-- All three are column-level grants on purpose, like sql/280: the table-level
-- matrix in `scripts/security-readiness.ts` (`WORKER_ROLE_GRANTS`) is unchanged,
-- and the column lists are the part that must stay narrow and visible.
--
-- ## A column list is not a row list: the guard trigger
--
-- The INSERT grant is column-scoped but cannot say WHICH rows. Without more, a
-- compromised worker could queue an own-tenant message in any category (say
-- `derived.transactional`) to any address with any subject and link, sent from
-- the tenant's verified sender: phishing. So a BEFORE INSERT trigger refuses an
-- insert by a MEMBER of `awcms_worker` unless the category is on a short
-- allow-list (today the three `hr.attendance_correction_*` categories, whose
-- variable allow-list carries only a name and a date). Same shape as sql/280's
-- event guard: the test is MEMBERSHIP, checked for both `session_user` and
-- `current_user`, superusers are exempt (they bypass every grant anyway), and
-- the function pins its `search_path` ending in `pg_temp`. Adding a category to
-- the worker's repertoire is a migration that replaces this function.
--
-- ## What this does NOT widen
--
-- The consumer never reads the correction's `reason` (sql/280 grants it no
-- SELECT on that column) and the e-mail carries only the employee's display
-- name and a date. A compromised worker could already UPDATE a queued message
-- (sql/022); INSERT adds the ability to queue one, in the tenant its
-- transaction is scoped to by the FORCE'd RLS policy, and only in the
-- allow-listed categories above.
--
-- Idempotent: GRANTs are repeatable.

BEGIN;

GRANT INSERT (tenant_id, correlation_id, category, template_key, to_address,
              to_address_hash, to_address_masked, subject, variables, priority)
  ON awcms_email_messages TO awcms_worker;
GRANT SELECT (id, tenant_id, identity_id, status)
  ON awcms_tenant_users TO awcms_worker;
GRANT SELECT (id, tenant_id, display_name)
  ON awcms_profiles TO awcms_worker;

CREATE OR REPLACE FUNCTION awcms_email_guard_worker_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.category NOT IN ('hr.attendance_correction_applied',
                          'hr.attendance_correction_rejected',
                          'hr.attendance_correction_cancelled')
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

DROP TRIGGER IF EXISTS awcms_email_messages_worker_guard
  ON awcms_email_messages;
CREATE TRIGGER awcms_email_messages_worker_guard
  BEFORE INSERT ON awcms_email_messages
  FOR EACH ROW EXECUTE FUNCTION awcms_email_guard_worker_insert();

COMMIT;
