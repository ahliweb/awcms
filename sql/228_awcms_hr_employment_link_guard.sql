-- Issue #979 (finding PS-14 of the phase-3 security review, hr-payroll.md
-- section 17) — the employment account link is the key to "an employee sees
-- their own" and, in phase 3, to payslips. The application refuses a link whose
-- login belongs to another person; this migration makes the DATABASE refuse it
-- too, so a path that does not go through `assignAccount` cannot bind a login to
-- someone else's employment, and records which login an employment was last
-- linked to so an unlink-then-link is still recognised as a RE-link.
--
-- 1. `last_tenant_user_id` — the most recent login that was linked and then
--    replaced or removed. NULL while the employment has never lost a link. It is
--    written by the application only (a re-link keeps the history), carries no
--    foreign key (the login may later be deactivated) and no personal data.
--
-- 2. `awcms_hr_employments_link_guard` — BEFORE UPDATE OF tenant_user_id and (as `_insert`) BEFORE INSERT with a login: a
--    non-null login whose identity belongs to a DIFFERENT profile than the row's
--    `profile_id` is refused. A login that cannot be found in the tenant is left
--    to the composite foreign key (which gives the precise error). It fires only
--    when the link CHANGES (on INSERT, when a login is supplied), so a row linked before this fix is not blocked from
--    unrelated updates; those rows are reported by the `security:readiness`
--    check instead. Runs as the invoker: the tenant context RLS already scopes
--    both lookups.

ALTER TABLE awcms_hr_employments
  ADD COLUMN IF NOT EXISTS last_tenant_user_id uuid;

COMMENT ON COLUMN awcms_hr_employments.last_tenant_user_id IS
  'Issue #979 / PS-14 — the login most recently unlinked or replaced; NULL if the employment never lost a link. Makes unlink-then-link a re-link. Application-written, no FK, no PII.';

CREATE OR REPLACE FUNCTION awcms_hr_guard_employment_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile uuid;
  v_found boolean;
BEGIN
  IF NEW.tenant_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.profile_id, true INTO v_profile, v_found
  FROM awcms_tenant_users tu
  JOIN awcms_identities i
    ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
  WHERE tu.tenant_id = NEW.tenant_id AND tu.id = NEW.tenant_user_id;

  IF v_found IS TRUE AND v_profile IS DISTINCT FROM NEW.profile_id THEN
    RAISE EXCEPTION
      'awcms_hr: the linked login must belong to the same person (profile) as the employment'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS awcms_hr_employments_link_guard ON awcms_hr_employments;
DROP TRIGGER IF EXISTS awcms_hr_employments_link_guard_insert ON awcms_hr_employments;

CREATE TRIGGER awcms_hr_employments_link_guard
  BEFORE UPDATE OF tenant_user_id ON awcms_hr_employments
  FOR EACH ROW
  WHEN (NEW.tenant_user_id IS DISTINCT FROM OLD.tenant_user_id)
  EXECUTE FUNCTION awcms_hr_guard_employment_link();

CREATE TRIGGER awcms_hr_employments_link_guard_insert
  BEFORE INSERT ON awcms_hr_employments
  FOR EACH ROW
  WHEN (NEW.tenant_user_id IS NOT NULL)
  EXECUTE FUNCTION awcms_hr_guard_employment_link();
