-- A handoff code carries the issuing session's step-up INSTANT, not only its
-- level and method (ADR-0050, ADR-0027; follow-up to ADR-0168 A2).
--
-- `sql/088` bound a handoff code to the assurance LEVEL the issuing login had
-- reached, and redemption minted a session at that level. But
-- `createSessionWithAssurance` stamped `stepped_up_at = now()` on every `aal2`
-- session it minted, so the redeemed session's step-up was always brand new,
-- however long ago the issuing session had actually presented a second factor.
-- `requireStepUp` reads exactly that stamp, so the hop refreshed a freshness
-- the person never re-proved.
--
-- The code now records the issuing session's `stepped_up_at`, and redemption
-- mints the new session with THAT instant (clamped to the redemption instant,
-- never later). A step-up that was stale before the hop is stale after it.
--
-- ## Constraints
--
-- * `(assurance_level = 'aal2') = (stepped_up_at IS NOT NULL)` — an aal2 code
--   without an instant cannot be written, so an issuer that forgets it fails at
--   INSERT instead of silently falling back to "fresh".
-- * `stepped_up_at <= created_at` — a code cannot claim a step-up later than
--   its own mint. Both values come from the application clock of the writing
--   request (`issueHandoffCode` supplies `created_at` explicitly, `sql/088`).
--
-- ## Live codes
--
-- Codes live at most 60 seconds (`sql/088` CHECK). Unredeemed aal2 codes that
-- exist at deploy time take the issuing session's `stepped_up_at`; any that
-- cannot be matched (issuing session gone, or no stamp) are DOWNGRADED to
-- aal1 rather than given an invented instant — fail closed, and at worst one
-- in-flight handoff lands at aal1 and steps up again. Both tables are FORCE
-- RLS, so the `sql/103` toggle wraps the cross-tenant UPDATEs and precedes
-- them.

BEGIN;

ALTER TABLE awcms_session_handoff_codes
  ADD COLUMN IF NOT EXISTS stepped_up_at timestamptz;

ALTER TABLE awcms_sessions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_session_handoff_codes NO FORCE ROW LEVEL SECURITY;

UPDATE awcms_session_handoff_codes c
SET stepped_up_at = LEAST(s.stepped_up_at, c.created_at)
FROM awcms_sessions s
WHERE s.tenant_id = c.tenant_id
  AND s.id = c.issued_by_session_id
  AND c.assurance_level = 'aal2'
  AND c.stepped_up_at IS NULL
  AND s.stepped_up_at IS NOT NULL;

UPDATE awcms_session_handoff_codes
SET assurance_level = 'aal1',
    stepped_up_method = NULL,
    stepped_up_passkey_id = NULL
WHERE assurance_level = 'aal2'
  AND stepped_up_at IS NULL;

ALTER TABLE awcms_session_handoff_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_session_handoff_codes
  ADD CONSTRAINT awcms_session_handoff_codes_stepped_up_at_level_check
    CHECK ((assurance_level = 'aal2') = (stepped_up_at IS NOT NULL)),
  ADD CONSTRAINT awcms_session_handoff_codes_stepped_up_at_not_after_mint_check
    CHECK (stepped_up_at IS NULL OR stepped_up_at <= created_at);

COMMENT ON COLUMN awcms_session_handoff_codes.stepped_up_at IS
  'sql/446. The issuing session''s stepped_up_at when the code was minted, never later than created_at; NOT NULL exactly for aal2. Redemption mints the new session with THIS instant, so a handoff never refreshes step-up freshness the person did not re-prove.';

COMMIT;
