-- Gelombang 2 PR 2.1 (Issue #423) — a session row that can be recognised.
--
-- `GET /api/v1/auth/sessions` lets a person see where they are signed in and
-- end a session they do not recognise. A list of opaque ids and timestamps
-- cannot support that decision: "revoke the one that is not me" needs something
-- to tell them apart by.
--
-- ## Three columns, and one that is deliberately absent
--
-- `client_ip_hash` — a keyed, non-reversible pseudonym of the client IP, NOT
-- the address. Enough to group "the same place", never enough to reconstruct
-- where someone was. Nullable on purpose: see the note below, it is only
-- written when the deployment's key is stable.
--
-- `user_agent_summary` — a coarse browser/OS label from `summarizeUserAgent`,
-- never the raw header. The raw string is a fingerprinting surface and a
-- storage liability for a value nobody reads in full.
--
-- `origin_auth` — how this session came to exist. Not cosmetic: a session
-- issued by an SSO assertion and one issued by a password are different objects
-- for anyone reasoning about blast radius, and telling them apart later is
-- impossible if it is not recorded here. `DEFAULT 'password'` is correct for
-- every existing row: the other two issuers are newer than every session that
-- can still be alive (max TTL is measured in hours).
--
-- NO `last_seen_at`. It would have to be written on the authorization read
-- path, i.e. one UPDATE per request per session, permanently, for a column
-- whose only job is cosmetic. Write amplification on the hottest read in the
-- system is not worth "active 3 minutes ago".
--
-- ## The CHECK omits 'switch'
--
-- The program plan lists a fourth value for the tenant-switch flow. There is no
-- switch endpoint in this repo, so it is not in the constraint: a CHECK listing
-- a value nothing can produce reads as a shipped capability. It is one
-- `ALTER … DROP CONSTRAINT … ADD CONSTRAINT` away when Gelombang 7 lands it.
--
-- Pure DDL on a populated FORCE-RLS table; same shape as `sql/024`, which added
-- assurance columns to this very table. No new grants (the defaults in
-- `sql/019` already cover column additions), no new foreign key, no backfill
-- beyond the DEFAULT.

ALTER TABLE awcms_sessions
  ADD COLUMN IF NOT EXISTS client_ip_hash text,
  ADD COLUMN IF NOT EXISTS user_agent_summary text,
  ADD COLUMN IF NOT EXISTS origin_auth text NOT NULL DEFAULT 'password';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'awcms_sessions_origin_auth_check'
  ) THEN
    ALTER TABLE awcms_sessions
      ADD CONSTRAINT awcms_sessions_origin_auth_check
      CHECK (origin_auth IN ('password', 'sso', 'handoff'));
  END IF;
END $$;

COMMENT ON COLUMN awcms_sessions.client_ip_hash IS
  'Keyed, non-reversible pseudonym of the client IP (never the address). NULL when AUTH_IP_HASH_SECRET is unset: the fallback key is per-process, so persisted values would stop being comparable after a restart and the session list would show one device as several.';

COMMENT ON COLUMN awcms_sessions.user_agent_summary IS
  'Coarse browser/OS label from summarizeUserAgent — never the raw User-Agent header.';

COMMENT ON COLUMN awcms_sessions.origin_auth IS
  'How this session was issued: password | sso | handoff. A step-up rotation CARRIES the original value forward — rotating a session does not re-authenticate it.';
