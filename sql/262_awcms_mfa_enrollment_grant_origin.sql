-- #1004 (re-audit finding H-A; ADR-0141 section 7).
--
-- A login-forced enrolment grant (`awcms_mfa_challenges.purpose = 'enrollment'`)
-- was assumed to be minted only by a login that had just verified the password,
-- so `enroll/start` skipped re-authentication for it. That is false for a grant
-- minted by `POST /auth/session/switch`: the caller there holds nothing but a
-- bearer session, and a stolen session could switch into a required-MFA tenant,
-- receive a grant and enrol with no password at all.
--
-- `enrollment_origin` records who minted the grant:
--
--   * 'login'  - a login that verified the password (the password sign-in, or
--                the tenantless sign-in whose selection token redeems at
--                `/auth/session/tenant`). Keeps the re-authentication exemption.
--   * 'switch' - `POST /auth/session/switch`. Must re-authenticate exactly like
--                a session does.
--
-- NULL (a grant minted before this column existed, or a non-enrolment
-- challenge) is treated as 'switch' by the code: fail closed. Grants live for
-- minutes, so this costs nothing in practice.

ALTER TABLE awcms_mfa_challenges
  ADD COLUMN IF NOT EXISTS enrollment_origin text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_mfa_challenges_enrollment_origin_check'
  ) THEN
    ALTER TABLE awcms_mfa_challenges
      ADD CONSTRAINT awcms_mfa_challenges_enrollment_origin_check
      CHECK (enrollment_origin IS NULL OR enrollment_origin IN ('login', 'switch'));
  END IF;
END
$$;

COMMENT ON COLUMN awcms_mfa_challenges.enrollment_origin IS
  '#1004. Who minted an enrollment grant: login (the password was just verified) or switch (a bearer session only). enroll/start waives re-authentication only for login; NULL is treated as switch.';
