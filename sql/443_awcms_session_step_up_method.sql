-- Issue #1405, ADR-0168 amendment A2 and answer Q7 (slice S2) — a session
-- records HOW it was stepped up, and `origin_auth` gains `passkey`.
--
-- `sql/024` gave `awcms_sessions` only `assurance_level` and `stepped_up_at`,
-- so a session raised to `aal2` by a recovery code is indistinguishable from
-- one raised by TOTP, and both will be indistinguishable from a passkey. ADR-0168
-- §8 needs the difference: a recovery code is phishable and must never satisfy a
-- passkey-required gate. Those gates (slice S5) read the two columns added here.
--
-- ## The columns
--
-- * `stepped_up_method` — `totp`, `recovery_code` or `passkey`; NULL exactly
--   when the session is `aal1`. The biconditional CHECK makes "aal2 without a
--   recorded method" impossible to write, so a future issuer that forgets the
--   method fails at INSERT instead of minting a session no gate can classify.
-- * `stepped_up_passkey_id` — which credential, NOT NULL exactly when the
--   method is `passkey`.
--
-- ## No FK to a passkey table yet, and therefore no passkey step-up at all
--
-- The credential table (`awcms_principal_passkeys`) does not exist in this
-- slice. A uuid column with no FK could name a credential that never existed,
-- and a gate trusting it would be trusting a value nothing vouches for. The
-- fail-closed answer is not to accept the value until something can vouch for
-- it: `..._passkey_step_up_unavailable` refuses `stepped_up_method = 'passkey'`
-- on every row. The slice that creates the credential table drops that
-- constraint in the same migration that adds the FK, so there is no moment at
-- which a passkey id can be stored without a row it must reference.
--
-- ## The backfill: the weakest method consistent with the evidence
--
-- Live `aal2` rows predate the column and their method was never recorded.
-- They could only have been raised by TOTP or by a recovery code (no other
-- factor existed), and nothing on the row says which. They are stamped
-- `recovery_code` — the weaker of the two, which is the value a passkey or
-- phishing-resistant gate must refuse anyway — rather than `totp`, which would
-- claim a strength nobody can prove. Sessions are short-lived, so the stamp is
-- transitional. Revoking or downgrading them instead was rejected: today no
-- gate distinguishes the two methods, so the stamp changes nothing a user can
-- see, while a downgrade would force every signed-in MFA user to step up again.
--
-- `awcms_sessions` and `awcms_session_handoff_codes` are FORCE RLS. A
-- cross-tenant UPDATE issued by a role without BYPASSRLS sees zero rows and
-- backfills nothing, after which the CHECK below would refuse every populated
-- deployment — so the `sql/103` toggle wraps the UPDATE, and precedes it (the
-- ordering note `sql/112` and `sql/114` carry).
--
-- ## Handoff codes carry the method too
--
-- A handoff code is bound to the assurance its issuing session had at the
-- moment it was minted (`sql/088`, ADR-0050) and redemption mints a session at
-- that level. With the method on the session, the code must snapshot it as
-- well, or redemption would mint an `aal2` session with no method — which the
-- CHECK above refuses — or would have to guess one.
--
-- ## `origin_auth = 'passkey'` (Q7)
--
-- The sixth value is admitted to the CHECK as ADR-0168 Q7 decides. Nothing
-- produces it in this slice: passwordless login is not in the first release
-- (Q3), and `switch` refuses it (`NON_SWITCHABLE_ORIGIN_AUTH`) until the A4
-- target-tenant check exists.

BEGIN;

-- 1. Sessions.
ALTER TABLE awcms_sessions
  ADD COLUMN IF NOT EXISTS stepped_up_method text,
  ADD COLUMN IF NOT EXISTS stepped_up_passkey_id uuid;

ALTER TABLE awcms_sessions NO FORCE ROW LEVEL SECURITY;

UPDATE awcms_sessions
SET stepped_up_method = 'recovery_code'
WHERE assurance_level = 'aal2'
  AND stepped_up_method IS NULL;

ALTER TABLE awcms_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_sessions
  ADD CONSTRAINT awcms_sessions_stepped_up_method_check
    CHECK (stepped_up_method IN ('totp', 'recovery_code', 'passkey')),
  ADD CONSTRAINT awcms_sessions_stepped_up_method_level_check
    CHECK ((assurance_level = 'aal2') = (stepped_up_method IS NOT NULL)),
  ADD CONSTRAINT awcms_sessions_stepped_up_passkey_id_check
    CHECK (
      (stepped_up_method IS NOT DISTINCT FROM 'passkey')
        = (stepped_up_passkey_id IS NOT NULL)
    ),
  -- Dropped by the slice that creates `awcms_principal_passkeys`, in the same
  -- migration that adds the FK on `stepped_up_passkey_id`.
  ADD CONSTRAINT awcms_sessions_passkey_step_up_unavailable
    CHECK (stepped_up_method IS DISTINCT FROM 'passkey');

-- 2. Handoff codes: the same pair, the same constraints.
ALTER TABLE awcms_session_handoff_codes
  ADD COLUMN IF NOT EXISTS stepped_up_method text,
  ADD COLUMN IF NOT EXISTS stepped_up_passkey_id uuid;

ALTER TABLE awcms_session_handoff_codes NO FORCE ROW LEVEL SECURITY;

UPDATE awcms_session_handoff_codes
SET stepped_up_method = 'recovery_code'
WHERE assurance_level = 'aal2'
  AND stepped_up_method IS NULL;

ALTER TABLE awcms_session_handoff_codes FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_session_handoff_codes
  ADD CONSTRAINT awcms_session_handoff_codes_stepped_up_method_check
    CHECK (stepped_up_method IN ('totp', 'recovery_code', 'passkey')),
  ADD CONSTRAINT awcms_session_handoff_codes_stepped_up_method_level_check
    CHECK ((assurance_level = 'aal2') = (stepped_up_method IS NOT NULL)),
  ADD CONSTRAINT awcms_session_handoff_codes_stepped_up_passkey_id_check
    CHECK (
      (stepped_up_method IS NOT DISTINCT FROM 'passkey')
        = (stepped_up_passkey_id IS NOT NULL)
    ),
  ADD CONSTRAINT awcms_session_handoff_codes_passkey_step_up_unavailable
    CHECK (stepped_up_method IS DISTINCT FROM 'passkey');

-- 3. `origin_auth = 'passkey'` — the sixth value (ADR-0168 Q7).
ALTER TABLE awcms_sessions
  DROP CONSTRAINT IF EXISTS awcms_sessions_origin_auth_check;

ALTER TABLE awcms_sessions
  ADD CONSTRAINT awcms_sessions_origin_auth_check
  CHECK (origin_auth IN ('password', 'sso', 'handoff', 'switch', 'delegated', 'passkey'));

COMMENT ON COLUMN awcms_sessions.stepped_up_method IS
  'ADR-0168 A2 (sql/443). How this session reached aal2: totp, recovery_code or passkey; NULL exactly when aal1. Set by every session issuer and by a step-up. Rows that were aal2 before sql/443 are stamped recovery_code, the weakest method consistent with the evidence. A recovery_code session never satisfies a passkey-required gate (ADR-0168 §8).';

COMMENT ON COLUMN awcms_sessions.stepped_up_passkey_id IS
  'ADR-0168 A2 (sql/443). The passkey credential that stepped this session up; NOT NULL exactly when stepped_up_method = passkey. No FK yet: the credential table does not exist, so awcms_sessions_passkey_step_up_unavailable refuses any passkey step-up until the slice that creates the table adds the FK and drops that constraint together.';

COMMENT ON COLUMN awcms_session_handoff_codes.stepped_up_method IS
  'ADR-0168 A2 (sql/443). The issuing session''s step-up method, snapshotted with its assurance level when the code was minted; redemption mints a session carrying both.';

COMMENT ON COLUMN awcms_session_handoff_codes.stepped_up_passkey_id IS
  'ADR-0168 A2 (sql/443). Snapshot of the issuing session''s stepped_up_passkey_id; same constraints as on awcms_sessions.';

COMMIT;
