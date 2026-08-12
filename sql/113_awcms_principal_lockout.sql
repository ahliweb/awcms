-- Gelombang 7 PR 7.2 (Issue #423), ADR-0086 — the lockout counter becomes
-- GLOBAL, which is the fix for #430.
--
-- `awcms_identities.failed_login_count` / `locked_until` are tenant-scoped
-- (`UNIQUE (tenant_id, login_identifier)`, `sql/004`), so one human who belongs
-- to N tenants has N counters. `POST /api/v1/auth/login` demands
-- `x-awcms-tenant-id` up front, and the tenant ids are not secret — the `/login`
-- page publishes a picker. Rotating that header therefore hands an attacker a
-- fresh counter per tenant against the SAME person, and each lockout only ever
-- locks one tenant rather than the human.
--
-- The counter moves onto `awcms_principals`, where there is exactly one row per
-- human and no tenant column to rotate.
--
-- ## The backfill takes the MAXIMUM, and that direction is deliberate
--
-- A human locked out in tenant A right now must STAY locked after this runs.
-- Taking `0` — or taking the counter of whichever row happened to sort first —
-- would release every in-flight lockout at the moment of deploy, which is the
-- one thing a migration touching a brute-force control must not do. `MAX` is the
-- only aggregate that cannot weaken the control it is migrating.
--
-- The identity columns are LEFT IN PLACE and left populated. They stop being
-- read (ADR-0086 §"the readers move with the writer") and become history — the
-- same disposition ADR-0079 chose for `awcms_access_assignments`. Dropping them
-- in the same migration that stops reading them would destroy the only evidence
-- of what the per-tenant counters held if the change has to be reasoned about
-- afterwards.
--
-- ## No new privileges
--
-- `sql/112` already granted `awcms_app` SELECT, INSERT, UPDATE on
-- `awcms_principals` — UPDATE precisely so this wave could promote credentials
-- and move the counter into it. `awcms_worker` still gets nothing: no scheduled
-- job counts a login.

BEGIN;

ALTER TABLE awcms_principals
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

ALTER TABLE awcms_principals
  ADD CONSTRAINT awcms_principals_failed_login_count_check
  CHECK (failed_login_count >= 0);

-- Cross-tenant read of a FORCE RLS table, so the toggle `sql/103` established
-- applies for the duration of the aggregate. `awcms_principals` itself is
-- RLS-free and needs no toggle of its own.
ALTER TABLE awcms_identities NO FORCE ROW LEVEL SECURITY;

UPDATE awcms_principals p
SET failed_login_count = source.max_failed,
    locked_until = source.max_locked_until,
    updated_at = now()
FROM (
  SELECT principal_id,
         MAX(failed_login_count) AS max_failed,
         MAX(locked_until) AS max_locked_until
  FROM awcms_identities
  WHERE principal_id IS NOT NULL
  GROUP BY principal_id
) AS source
WHERE p.id = source.principal_id
  AND (source.max_failed > 0 OR source.max_locked_until IS NOT NULL);

ALTER TABLE awcms_identities FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN awcms_principals.failed_login_count IS
  'The GLOBAL failed-login counter (ADR-0086, closing #430). One row per human, so rotating x-awcms-tenant-id no longer hands an attacker a fresh counter against the same person. Incremented IN-DB, never by a JS read-modify-write — the defect Issue #483 fixed on the identity counter and this inherits rather than repeats.';

COMMENT ON COLUMN awcms_principals.locked_until IS
  'When the global lockout expires. Backfilled with MAX() across the human''s identities: a lockout in force at deploy time must survive the migration, and MAX is the only aggregate that cannot weaken the control being migrated.';

COMMENT ON COLUMN awcms_identities.failed_login_count IS
  'HISTORY since ADR-0086. The live counter is awcms_principals.failed_login_count; nothing reads this column to make a decision any more. Retained rather than dropped so the pre-migration per-tenant values stay inspectable — the disposition ADR-0079 chose for awcms_access_assignments.';

COMMIT;
