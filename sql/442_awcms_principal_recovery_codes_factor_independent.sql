-- Issue #1405, ADR-0168 amendment A1 (slice S2) — recovery codes become
-- principal-owned and independent of factor type.
--
-- `sql/114` hung every recovery code off ONE TOTP factor:
-- `factor_id NOT NULL REFERENCES awcms_principal_mfa_factors ON DELETE CASCADE`,
-- and `consumeRecoveryCode` only accepted a code while THAT factor was active.
-- Once a principal can hold a passkey as well, a code set tied to the TOTP row
-- would vanish the moment that one factor is replaced, leaving a person whose
-- remaining factor is a passkey with no recovery path at all. A1 moves the
-- codes onto the principal: issued when the first factor of any type is
-- enrolled, kept while at least one factor is active, and removed only when the
-- principal has no factor left (self-service disable, administrative reset).
--
-- ## The data step keeps exactly the codes that are spendable TODAY
--
-- Before this migration a code can be spent only when
--   (a) its `factor_id` names a factor whose `status = 'active'`, and
--   (b) that factor belongs to the same `principal_id` as the code
-- — `consumeRecoveryCode` binds `principal_id =` AND `factor_id =` and the
-- factor id it is handed comes from `findActiveFactor(principalId)`. Every
-- other row is already dead: a code of a pending or disabled factor, or one
-- whose factor row belongs to somebody else, cannot be spent by any code path.
--
-- Dropping `factor_id` without first deleting those rows would bring them back
-- to life: after this migration the only test is "does this principal have an
-- active factor", so a dead code from a factor disabled long ago would start
-- working again the day the person re-enrols. The DELETE below is what
-- prevents that, and it is exact in the other direction too: every code that
-- satisfies (a) and (b) survives untouched, `used_at` included, so no
-- legitimate unspent code is lost and no spent one is revived.
--
-- At most one factor per principal can be active (`sql/114`'s partial unique
-- index on `(principal_id, factor_type)` with the single allowed type `totp`),
-- so two surviving code sets can never meet on one principal and the
-- `(principal_id, code_hash)` unique index cannot be violated by this step.
--
-- The table carries no RLS (ADR-0087: global, keyed on the principal), so no
-- `NO FORCE` toggle is needed for the DELETE to see every row — unlike the
-- `awcms_sessions` backfill in `sql/443`.
--
-- ## Why DROP the column rather than make it nullable
--
-- A nullable `factor_id` that the new code never writes would leave a column
-- whose legacy rows still point at a factor while new rows do not, and any
-- reader that kept keying on it would be wrong silently rather than loudly
-- (the lesson of ADR-0079: a writer that moves while a reader stays is the
-- defect nobody's test sees). With the column gone, a stale reader is a SQL
-- error. `identity:principal-access:check` stops accepting `factor_id =` as a
-- key for the same reason.

BEGIN;

-- 1. Delete every code that no code path could spend before this migration.
DELETE FROM awcms_principal_mfa_recovery_codes rc
WHERE NOT EXISTS (
  SELECT 1
  FROM awcms_principal_mfa_factors f
  WHERE f.id = rc.factor_id
    AND f.principal_id = rc.principal_id
    AND f.status = 'active'
);

-- 2. Detach the codes from the factor. Dropping the column drops its FK (and
--    with it the `ON DELETE CASCADE`) and the `sql/114` partial index on it.
DROP INDEX IF EXISTS awcms_principal_mfa_recovery_codes_factor_idx;

ALTER TABLE awcms_principal_mfa_recovery_codes
  DROP COLUMN IF EXISTS factor_id;

-- `awcms_principal_mfa_recovery_codes_hash_key (principal_id, code_hash)`
-- already serves both remaining access paths — "spend this code of this
-- principal" and "delete this principal's codes" — so no new index is added.

COMMENT ON TABLE awcms_principal_mfa_recovery_codes IS
  'ADR-0087 + ADR-0168 A1 (sql/442). Single-use sha256 recovery codes owned by the PRINCIPAL, independent of factor type: issued when the principal enrols its first factor of any type, spendable while the principal has at least one active factor, deleted only when the principal is left with no factor (self-service disable, administrative reset) or when a new set replaces them. GLOBAL and RLS-free; read and written only by principal-mfa-store.ts.';

COMMIT;
