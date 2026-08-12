-- Gelombang 7 PR 7.3 (Issue #423), ADR-0087 — MFA moves to the principal.
--
-- `awcms_identity_mfa_factors` is keyed `(tenant_id, identity_id)`, so one human
-- who belongs to N tenants enrols N times and carries N different TOTP secrets.
-- That is the same shape #430 was about, one layer up: the thing being protected
-- is a person, and the row protecting them was selected by a tenant.
--
-- The factor and its recovery codes move onto the principal. The ENCRYPTION does
-- not change — `sql/024`'s construction, key, and ciphertext format are reused
-- byte-for-byte. This migration moves OWNERSHIP, not cryptography.
--
-- ## What deliberately does NOT move
--
-- `awcms_mfa_challenges` and `awcms_tenant_mfa_policies` stay tenant-scoped
-- under FORCE RLS. A challenge is one login attempt at one tenant; making it
-- global would let a challenge issued by tenant A be exchanged for a session at
-- tenant B. A policy is a tenant's own product decision; making it global would
-- hand one tenant authority over another's security posture. The factor belongs
-- to the human; the requirement belongs to the tenant.
--
-- ## The backfill keeps the authenticator the person actually holds
--
-- Among a principal's competing non-disabled factors, the survivor is chosen
-- `ORDER BY last_used_step DESC, activated_at DESC` — NOT most-recently-created.
-- `last_used_step` is a TOTP step number and is therefore comparable across
-- factors: the highest one is the authenticator most recently used to actually
-- log in, which is the one on the phone the person still has. Picking the newest
-- enrolment would pick a device that may have been lost since, and that locks
-- them out.
--
-- This is ADR-0086's rule applied again: a migration must not weaken the control
-- it moves. There the answer was `MAX()`, because `0` would release every
-- in-force lockout. Here it is "last used", because "newest" would separate a
-- person from their authenticator.
--
-- Unlike `sql/112`, this migration does NOT refuse on collision. Two addresses
-- differing only in case are possibly two PEOPLE and merging them is
-- unrecoverable; two TOTP factors in two tenants are one person in a state this
-- product itself created. Blocking a deploy on a legitimate state is the wrong
-- gate. `bun run identity:mfa-collisions:preflight` reports every affected
-- principal BEFORE the deploy window instead, so "who loses what" is seen rather
-- than discovered.
--
-- The old tables are left populated as history (the ADR-0079 disposition, the
-- same one `sql/113` chose for the identity lockout columns).

BEGIN;

-- 1. `awcms_principal_mfa_factors` — GLOBAL, no RLS. The four controls that
--    stand in for RLS are ADR-0085's, reused without loosening: narrowed
--    privileges (below), a per-call-site read-shape gate
--    (`identity:principal-access:check`), a projection invariant keeping
--    `secret_ciphertext` inside the store module, and an authorization boundary
--    that does not move — holding a factor grants nothing.
CREATE TABLE IF NOT EXISTS awcms_principal_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES awcms_principals (id),
  factor_type text NOT NULL DEFAULT 'totp',
  secret_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_used_step bigint NOT NULL DEFAULT -1,
  -- Per-factor cumulative failed-verify lockout, carried over from `sql/024`
  -- unchanged in mechanism and now GLOBAL in effect (ADR-0087). The trade-off is
  -- taken with its recovery levers in the same PR: recovery codes, self-service
  -- disable + re-enrol, and administrative reset are all global too.
  failed_verify_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  disabled_at timestamptz,
  -- Which tenant ORDERED an administrative reset. NULL means nobody did: a
  -- self-service disable, or a row this migration's backfill stood down for
  -- losing the single-factor rule (those are distinguishable by having a live
  -- sibling and a `disabled_at` equal to the deploy).
  -- No FK: it names a tenant this row's owner may no longer belong to, and a
  -- cascade from awcms_tenants must never rewrite MFA history. This is where the
  -- cross-tenant reach is recorded, because FORCE RLS makes writing an audit row
  -- into another tenant's log impossible AND enumerating the reached tenants
  -- would itself be a cross-tenant membership oracle (ADR-0087).
  disabled_by_tenant_id uuid,
  CONSTRAINT awcms_principal_mfa_factors_factor_type_check
    CHECK (factor_type IN ('totp')),
  CONSTRAINT awcms_principal_mfa_factors_status_check
    CHECK (status IN ('pending', 'active', 'disabled')),
  CONSTRAINT awcms_principal_mfa_factors_failed_verify_count_check
    CHECK (failed_verify_count >= 0)
);

-- One non-disabled TOTP factor per human. This is the constraint that makes the
-- backfill below have to choose, and it is kept rather than relaxed: allowing N
-- active factors would test one guessed code against N secrets at once and
-- scatter `failed_verify_count` across N rows, weakening the very control this
-- migration is moving.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_principal_mfa_factors_active_key
  ON awcms_principal_mfa_factors (principal_id, factor_type)
  WHERE status <> 'disabled';

CREATE INDEX IF NOT EXISTS awcms_principal_mfa_factors_principal_idx
  ON awcms_principal_mfa_factors (principal_id);

-- 2. `awcms_principal_mfa_recovery_codes` — GLOBAL, no RLS, same single-use
--    sha256 construction as `sql/024`.
CREATE TABLE IF NOT EXISTS awcms_principal_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES awcms_principals (id),
  factor_id uuid NOT NULL
    REFERENCES awcms_principal_mfa_factors (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Scoped to `(principal_id, code_hash)`, not `code_hash` alone — the same
-- reasoning `sql/024` recorded for `(tenant_id, code_hash)`: a global unique
-- index would turn a 40-bit recovery-code collision between two unrelated
-- HUMANS into a 23505 that surfaces as a 500, and that error is itself a faint
-- cross-account signal. Uniqueness only needs to hold within one person.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_principal_mfa_recovery_codes_hash_key
  ON awcms_principal_mfa_recovery_codes (principal_id, code_hash);

CREATE INDEX IF NOT EXISTS awcms_principal_mfa_recovery_codes_factor_idx
  ON awcms_principal_mfa_recovery_codes (factor_id)
  WHERE used_at IS NULL;

-- 3. Backfill. Cross-tenant reads of FORCE RLS tables, so the `sql/103` toggle
--    applies for their duration. The new tables are RLS-free and need none.
--
--    Ordering note inherited from `sql/112`: the toggle must PRECEDE the read,
--    because a cross-tenant scan issued before it sees zero rows and silently
--    backfills nothing.
ALTER TABLE awcms_identities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_identity_mfa_factors NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_identity_mfa_recovery_codes NO FORCE ROW LEVEL SECURITY;

-- 3a. The surviving factor per principal, plus every loser, ranked once.
CREATE TEMP TABLE awcms_principal_mfa_backfill ON COMMIT DROP AS
SELECT f.id AS legacy_factor_id,
       i.principal_id,
       f.factor_type,
       f.secret_ciphertext,
       f.status,
       f.last_used_step,
       f.failed_verify_count,
       f.locked_until,
       f.created_at,
       f.updated_at,
       f.activated_at,
       f.disabled_at,
       row_number() OVER (
         PARTITION BY i.principal_id, f.factor_type
         ORDER BY f.last_used_step DESC, f.activated_at DESC NULLS LAST, f.id
       ) AS rank_in_principal
FROM awcms_identity_mfa_factors f
JOIN awcms_identities i ON i.id = f.identity_id
WHERE i.principal_id IS NOT NULL
  AND f.status <> 'disabled';

-- 3b. Rank 1 keeps its status; every other row lands already disabled, so the
--     partial unique index above is satisfied by construction rather than by a
--     later cleanup pass.
INSERT INTO awcms_principal_mfa_factors
  (principal_id, factor_type, secret_ciphertext, status, last_used_step,
   failed_verify_count, locked_until, created_at, updated_at, activated_at,
   disabled_at)
SELECT b.principal_id,
       b.factor_type,
       b.secret_ciphertext,
       CASE WHEN b.rank_in_principal = 1 THEN b.status ELSE 'disabled' END,
       b.last_used_step,
       CASE WHEN b.rank_in_principal = 1 THEN b.failed_verify_count ELSE 0 END,
       CASE WHEN b.rank_in_principal = 1 THEN b.locked_until ELSE NULL END,
       b.created_at,
       b.updated_at,
       b.activated_at,
       CASE WHEN b.rank_in_principal = 1 THEN b.disabled_at ELSE now() END
FROM awcms_principal_mfa_backfill b;

-- 3c. Recovery codes follow ONLY the surviving factor. A losing factor's codes
--     are not carried over: they unlock a secret that is now disabled, so
--     copying them would create codes that authenticate nothing while looking
--     like a working recovery path.
INSERT INTO awcms_principal_mfa_recovery_codes
  (principal_id, factor_id, code_hash, used_at, created_at)
SELECT b.principal_id,
       nf.id,
       rc.code_hash,
       rc.used_at,
       rc.created_at
FROM awcms_principal_mfa_backfill b
JOIN awcms_identity_mfa_recovery_codes rc
  ON rc.factor_id = b.legacy_factor_id
JOIN awcms_principal_mfa_factors nf
  ON nf.principal_id = b.principal_id
 AND nf.factor_type = b.factor_type
 AND nf.status <> 'disabled'
WHERE b.rank_in_principal = 1
ON CONFLICT (principal_id, code_hash) DO NOTHING;

ALTER TABLE awcms_identity_mfa_recovery_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_identity_mfa_factors FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_identities FORCE ROW LEVEL SECURITY;

-- 4. Privileges. `DELETE` is granted here where `sql/112` withheld it from
--    `awcms_principals`, and the difference is reasoned rather than incidental:
--    deleting a recovery code is an ordinary operation `disable`, `regenerate`,
--    and administrative reset have performed since ADR-0027, and a missing row
--    means "that code is spent", not "this human cannot log in".
REVOKE ALL ON awcms_principal_mfa_factors FROM awcms_app;
REVOKE ALL ON awcms_principal_mfa_recovery_codes FROM awcms_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON awcms_principal_mfa_factors TO awcms_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON awcms_principal_mfa_recovery_codes TO awcms_app;

-- `awcms_worker` gets nothing, for the reason `WORKER_ROLE_GRANTS` states: no
-- scheduled job verifies a second factor.

-- 5. The superseded tables become history, and the narrowing is what makes the
--    supersession real. Left POPULATED (ADR-0079's disposition, the same one
--    `sql/113` chose for the identity lockout columns) so an investigator can
--    still answer "what did this person's MFA look like in July" — but read-only,
--    because a legacy factor table the runtime can still WRITE is a second place
--    to enrol a factor, and one human with two second factors of which login
--    checks only one is a worse state than either table alone.
--
--    Declared in `RETIRED_TENANT_TABLE_PRIVILEGES`, which asserts it in BOTH
--    directions: regaining INSERT fails as loudly as losing SELECT.
REVOKE INSERT, UPDATE, DELETE ON awcms_identity_mfa_factors FROM awcms_app;
REVOKE INSERT, UPDATE, DELETE ON awcms_identity_mfa_recovery_codes FROM awcms_app;

COMMENT ON TABLE awcms_identity_mfa_factors IS
  'SUPERSEDED by awcms_principal_mfa_factors (ADR-0087, sql/114). Read-only history: the tenant-scoped factor as it stood before MFA moved to the principal. Retained populated, never written again.';

COMMENT ON TABLE awcms_identity_mfa_recovery_codes IS
  'SUPERSEDED by awcms_principal_mfa_recovery_codes (ADR-0087, sql/114). Read-only history — see the factor table''s comment.';

COMMENT ON TABLE awcms_principal_mfa_factors IS
  'ADR-0087. The MFA factor belongs to the HUMAN, not to a tenant-scoped identity: one enrolment authenticates every tenant they belong to. GLOBAL and RLS-free, standing on ADR-0085''s four controls. The tenant-scoped awcms_identity_mfa_factors is retained as history.';

COMMENT ON COLUMN awcms_principal_mfa_factors.last_used_step IS
  'Highest TOTP step already accepted, the replay guard from sql/024. Also the backfill selector: comparable across factors, so the highest identifies the authenticator the person most recently actually used.';

COMMENT ON COLUMN awcms_principal_mfa_factors.disabled_by_tenant_id IS
  'The tenant that ORDERED an administrative reset; NULL when nobody did — a self-service disable, or a factor stood down by the sql/114 backfill. ADR-0087 records the cross-tenant reach HERE rather than in the reached tenants'' audit logs, because FORCE RLS refuses an INSERT carrying another tenant_id and enumerating those tenants would be a cross-tenant membership oracle. No FK: it names a tenant this row''s owner may no longer belong to, and a cascade must never rewrite MFA history.';

COMMENT ON COLUMN awcms_principal_mfa_factors.locked_until IS
  'Per-factor verify lockout, now GLOBAL (ADR-0087). Taken together with its recovery levers, which are global too: recovery codes, self-service disable + re-enrol, and administrative reset.';

COMMENT ON TABLE awcms_principal_mfa_recovery_codes IS
  'ADR-0087. Single-use backup codes for the principal''s factor. Unique per (principal_id, code_hash) rather than globally, so a collision between two unrelated humans cannot raise a 23505 that leaks as a 500.';

COMMIT;
