-- MFA TOTP, recovery codes, session assurance, and step-up (Issue #184, epic
-- ERP-readiness enterprise auth #177). Ported/adapted from awcms-mini
-- migration 034 (Issue #589), with the mini prefix renamed
-- `awcms_mini_` -> `awcms_` and three additions mini does not have: session
-- assurance columns, a tenant enforcement-policy table, and an admin-reset
-- permission seed.
--
-- GRANTS: no explicit GRANT statements. `sql/019` set
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE
-- TO awcms_app` (and USAGE,SELECT on sequences), so every tenant table created
-- here inherits the full DML `awcms_app` needs at request time. The
-- background/worker and setup roles (`awcms_worker`/`awcms_setup`, sql/022)
-- touch none of these tables and are deliberately granted nothing on them.
-- `security-readiness` treats any un-registered `awcms_%` table as
-- tenant-scoped and asserts RLS FORCE + all four app grants, which the
-- `ENABLE`+`FORCE`+default-privileges below satisfy.

-- 1. Session assurance level (aal1/aal2) + step-up freshness on the existing
--    opaque-session table. `sql/004` is applied/immutable, so these are added
--    here as ADD COLUMN (pure DDL — safe on a populated FORCE-RLS table, no
--    DML). A password-only login stays `aal1`; completing an MFA challenge or a
--    step-up raises the (freshly rotated) session to `aal2` and stamps
--    `stepped_up_at`. `last_authenticated_at` records the most recent
--    credential/second-factor proof for this session.
ALTER TABLE awcms_sessions
  ADD COLUMN IF NOT EXISTS assurance_level text NOT NULL DEFAULT 'aal1',
  ADD COLUMN IF NOT EXISTS last_authenticated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stepped_up_at timestamptz;

ALTER TABLE awcms_sessions
  ADD CONSTRAINT awcms_sessions_assurance_level_check
    CHECK (assurance_level IN ('aal1', 'aal2'));

-- 2. `awcms_identity_mfa_factors` — one row per identity per factor type.
--    `secret_ciphertext` is the TOTP shared secret encrypted at rest
--    (`src/lib/auth/mfa-secret-crypto.ts`, AES-256-GCM keyed by
--    `AUTH_MFA_SECRET_ENCRYPTION_KEY`) — never stored plaintext, never returned
--    again after enrollment start. `status`: `pending` (enrolled, not yet
--    confirmed — unusable for login) -> `active` (confirmed) -> `disabled`
--    (turned off; kept as a row for audit/history, not deleted). Partial unique
--    index allows only one non-disabled factor per identity at a time. Only
--    TOTP is implemented; `factor_type` is modeled for a possible future factor
--    without a schema change (WebAuthn is explicitly out of scope here).
--    `last_used_step` is the highest TOTP time-step counter ever accepted — a
--    verification is accepted only if its matched step is strictly greater,
--    which is the replay defense (see `application/mfa.ts`).
CREATE TABLE IF NOT EXISTS awcms_identity_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  identity_id uuid NOT NULL REFERENCES awcms_identities (id),
  factor_type text NOT NULL DEFAULT 'totp',
  secret_ciphertext text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_used_step bigint NOT NULL DEFAULT -1,
  -- Per-factor cumulative failed-verify lockout (Issue #184, F4). Independent
  -- of source IP and of any single challenge row: an attacker who knows the
  -- password can mint fresh challenges and rotate IPs, so the per-challenge cap
  -- and per-source rate limit alone do not bound guessing against ONE factor.
  -- Mirrors the password lockout model (`awcms_identities.failed_login_count`/
  -- `locked_until`): incremented on every failed verify, reset to 0 on success,
  -- and once it reaches `AUTH_MFA_MAX_VERIFY_ATTEMPTS` the factor is locked
  -- until `now + AUTH_MFA_LOCKOUT_MINUTES`.
  failed_verify_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  disabled_at timestamptz,
  CONSTRAINT awcms_identity_mfa_factors_factor_type_check
    CHECK (factor_type IN ('totp')),
  CONSTRAINT awcms_identity_mfa_factors_status_check
    CHECK (status IN ('pending', 'active', 'disabled')),
  CONSTRAINT awcms_identity_mfa_factors_failed_verify_count_check
    CHECK (failed_verify_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_identity_mfa_factors_active_key
  ON awcms_identity_mfa_factors (tenant_id, identity_id, factor_type)
  WHERE status <> 'disabled';

CREATE INDEX IF NOT EXISTS awcms_identity_mfa_factors_identity_idx
  ON awcms_identity_mfa_factors (tenant_id, identity_id);

ALTER TABLE awcms_identity_mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_identity_mfa_factors FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_identity_mfa_factors_tenant_isolation
  ON awcms_identity_mfa_factors
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 3. `awcms_identity_mfa_recovery_codes` — single-use backup codes shown once
--    at enrollment-verify (and again on regenerate); only `code_hash` (sha256,
--    same construction as `session-token.ts`) is ever persisted.
--    `ON DELETE CASCADE` on `factor_id` is a backstop — the application deletes
--    codes explicitly on disable/regenerate/reset.
CREATE TABLE IF NOT EXISTS awcms_identity_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  identity_id uuid NOT NULL REFERENCES awcms_identities (id),
  factor_id uuid NOT NULL REFERENCES awcms_identity_mfa_factors (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Scoped to (tenant_id, code_hash), NOT (code_hash) alone (Issue #184, F5): a
-- global unique index would let a 40-bit recovery-code collision across two
-- tenants raise a cross-tenant 23505 that surfaces as a 500 (and is a faint
-- cross-tenant signal). Uniqueness only needs to hold within a tenant.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_identity_mfa_recovery_codes_hash_key
  ON awcms_identity_mfa_recovery_codes (tenant_id, code_hash);

CREATE INDEX IF NOT EXISTS awcms_identity_mfa_recovery_codes_factor_idx
  ON awcms_identity_mfa_recovery_codes (tenant_id, factor_id)
  WHERE used_at IS NULL;

ALTER TABLE awcms_identity_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_identity_mfa_recovery_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_identity_mfa_recovery_codes_tenant_isolation
  ON awcms_identity_mfa_recovery_codes
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 4. `awcms_mfa_challenges` — the ephemeral bridge between "password verified"
--    and "session created" for an identity with an active MFA factor
--    (`login.ts`). Password-valid + MFA-active issues a challenge row (no
--    session yet) whose raw token is returned as `mfaChallengeToken`;
--    `POST /auth/mfa/totp/verify` looks it up by `challenge_token_hash` and
--    only creates the real session once the submitted TOTP/recovery code is
--    valid. `failed_attempts` bounds brute-force against one challenge
--    independently of the source-scoped endpoint rate limit.
CREATE TABLE IF NOT EXISTS awcms_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  identity_id uuid NOT NULL REFERENCES awcms_identities (id),
  challenge_token_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'login',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_mfa_challenges_failed_attempts_check
    CHECK (failed_attempts >= 0),
  -- `login` bridges password->session for an ENROLLED identity; `enrollment`
  -- (Issue #184, F1) is the scoped grant issued when a tenant policy REQUIRES
  -- MFA but the identity has no factor yet — it authorizes ONLY the enroll
  -- endpoints, never a general session, and is consumed when enrollment
  -- completes.
  CONSTRAINT awcms_mfa_challenges_purpose_check
    CHECK (purpose IN ('login', 'enrollment'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_mfa_challenges_hash_key
  ON awcms_mfa_challenges (challenge_token_hash);

CREATE INDEX IF NOT EXISTS awcms_mfa_challenges_identity_idx
  ON awcms_mfa_challenges (tenant_id, identity_id)
  WHERE consumed_at IS NULL;

ALTER TABLE awcms_mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_mfa_challenges FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_mfa_challenges_tenant_isolation
  ON awcms_mfa_challenges
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 5. `awcms_tenant_mfa_policies` — one row per tenant, upsert. Enforcement
--    enum defaults to `optional` (safe default: MFA available, never forced),
--    so every existing tenant behaves exactly as before this migration until
--    an admin opts in.
CREATE TABLE IF NOT EXISTS awcms_tenant_mfa_policies (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  enforcement_level text NOT NULL DEFAULT 'optional',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_tenant_mfa_policies_enforcement_level_check
    CHECK (enforcement_level IN
      ('optional', 'required_for_privileged', 'required_for_all'))
);

ALTER TABLE awcms_tenant_mfa_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_tenant_mfa_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_tenant_mfa_policies_tenant_isolation
  ON awcms_tenant_mfa_policies
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 6. Permission catalog seed for the admin MFA reset workflow. Like sql/023
--    (office delete), the guard action must exist as a catalog row before
--    tenant bootstrap grants the owner every permission — a guard on an
--    un-seeded action would default-deny even the owner. Declaring it in
--    `identity-access/module.ts` alone is not enough; sql/005 is immutable, so
--    the row is seeded here (idempotent).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('identity_access', 'mfa_admin', 'reset',
   'Administratively reset (disable) another user''s MFA factor'),
  ('identity_access', 'mfa_admin', 'configure',
   'Configure the tenant MFA enforcement policy')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
