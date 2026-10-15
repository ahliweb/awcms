-- #1004 (audit findings H3 of the security review of 938caa88; ADR-0141 section 7).
--
-- A pending TOTP factor is a secret that has been shown to exactly one caller
-- and is waiting for that caller to prove they scanned it. Until now nothing tied
-- it to that caller: any session of the same person could confirm it, it never
-- expired, and a wrong code cost nothing. This adds the one column the fix
-- needs. Everything else reuses columns that already exist:
--
--   * `enrollment_binding_hash` - a derived hash (never the token) of the
--     session or enrolment grant that STARTED the enrolment. `verify` refuses a
--     different one, so a second session cannot finish an enrolment it did not
--     start.
--   * the pending row's `created_at` (set from the database clock) is the
--     time-to-live reference; `failed_verify_count` counts wrong codes against
--     the pending factor and the row is deleted when it reaches the cap.
--
-- Rows created before this migration have a NULL binding. `verify` treats a NULL
-- binding as unverifiable, so a pending factor that predates the deploy can
-- never be confirmed and is replaced by the next `start`; it is not a way
-- around the binding.


ALTER TABLE awcms_principal_mfa_factors
  ADD COLUMN IF NOT EXISTS enrollment_binding_hash text;

COMMENT ON COLUMN awcms_principal_mfa_factors.enrollment_binding_hash IS
  '#1004. Derived SHA-256 of the session (or login enrolment grant) that started this PENDING enrolment; enroll/verify refuses a different one. NULL on rows that predate the column, which therefore cannot be confirmed. Never the token itself. Meaningless once the factor is active.';

