-- Tenant-aware OIDC/SSO: provider config, tenant auth policy, external
-- identity linking, and the ephemeral Authorization-Code-flow request bridge
-- (Issue #185, epic ERP-readiness enterprise auth #177). Ported/adapted from
-- awcms-mini migrations 035/036/037 (Issues #590/#591) — mini's Google-specific
-- `sql/035` and generic `sql/036`/`sql/037` are CONSOLIDATED here into one
-- generic, provider-agnostic schema built directly for awcms (this base has no
-- Google baseline, so nothing to generalize FROM — the generic model is built
-- once). Prefix renamed `awcms_mini_` -> `awcms_`.
--
-- ADAPTATIONS vs mini (deliberate, all documented in the identity-access
-- README and ADR-0028):
--   1. External-identity key is `(tenant_id, provider_id, issuer, subject)`
--      (issue #185's own model), NOT mini's `(tenant_id, provider, subject)`:
--      `issuer` is added to the uniqueness key and `provider_id` is a real FK
--      (composite, tenant-bound) instead of free text — an immutable `sub` is
--      never keyed on email.
--   2. The OAuth-request bridge carries a PKCE `code_verifier` (server-side,
--      single-use) — mini's generic flow shipped without PKCE; issue #185
--      requires Auth Code + PKCE.
--   3. `redirect_after` (a validated same-origin relative path) is captured at
--      `start` so the post-login redirect can never become an open redirect.
--   4. mini's `awcms_mini_tenant_auth_policies.mfa_required` column is DROPPED:
--      awcms already models tenant MFA enforcement in
--      `awcms_tenant_mfa_policies` (sql/024, Issue #184) — a second source of
--      truth would drift.
--
-- Active only when `AUTH_SSO_ENABLED=true` (`isSsoEnabled`,
-- `src/lib/auth/sso-config.ts`). These tables exist on every deployment
-- (migrations always run) but stay entirely empty/unused on local/offline/LAN
-- deployments that never enable the feature.
--
-- GRANTS: no explicit GRANT statements — `sql/019` set
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE
-- TO awcms_app` (+ USAGE,SELECT on sequences), so every tenant table created
-- here inherits the full DML `awcms_app` needs at request time. The
-- worker/setup roles (`awcms_worker`/`awcms_setup`, sql/022) touch none of
-- these tables and are granted nothing on them. `security-readiness` treats any
-- un-registered `awcms_%` table as tenant-scoped and asserts RLS FORCE + all
-- four app grants, which the ENABLE+FORCE+default-privileges below satisfy.

-- 1. `awcms_auth_providers` — one tenant-configured OIDC identity provider
--    (Google Workspace, Microsoft Entra ID, Keycloak, Okta, ...). `provider_key`
--    is the stable slug used in the `/api/v1/auth/sso/{providerKey}/...` URL and
--    everywhere this issue binds an external identity to its provider. The
--    client secret is NEVER stored plaintext (issue's own out-of-scope note):
--    either `client_secret_ciphertext` (AES-256-GCM via
--    `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`, same at-rest pattern as sql/024's MFA
--    secret) or `client_secret_env_var` (the NAME of an env var holding the
--    secret, resolved at token-exchange time, never persisted) — exactly one of
--    the two, enforced by the CHECK. Soft delete since a provider config is
--    tenant master data, not an append-only/posted record.
CREATE TABLE IF NOT EXISTS awcms_auth_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  provider_key text NOT NULL,
  provider_type text NOT NULL DEFAULT 'oidc',
  display_name text NOT NULL,
  issuer_url text NOT NULL,
  client_id text NOT NULL,
  client_secret_ciphertext text,
  client_secret_env_var text,
  scopes text NOT NULL DEFAULT 'openid email profile',
  allowed_email_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_auth_providers_provider_type_check
    CHECK (provider_type IN ('oidc')),
  CONSTRAINT awcms_auth_providers_provider_key_format_check
    CHECK (provider_key ~ '^[a-z0-9][a-z0-9_-]*$'),
  CONSTRAINT awcms_auth_providers_secret_source_check
    CHECK (
      (client_secret_ciphertext IS NOT NULL AND client_secret_env_var IS NULL)
      OR (client_secret_ciphertext IS NULL AND client_secret_env_var IS NOT NULL)
    )
);

-- `provider_key` must be unique per tenant among non-deleted providers (an
-- archived provider's slug may be reused). Two DIFFERENT tenants may both name a
-- provider "okta" — uniqueness is per tenant, never global.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_auth_providers_key_active
  ON awcms_auth_providers (tenant_id, provider_key)
  WHERE deleted_at IS NULL;

-- Composite (id, tenant_id) uniqueness backs the tenant-bound composite FKs on
-- `awcms_external_identities` / `awcms_oidc_auth_requests` below (a plain FK on
-- `id` alone would let a row reference a provider in ANOTHER tenant, since a
-- foreign-key check bypasses RLS — see the office FK lesson, sql/020).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_auth_providers_id_tenant_key
  ON awcms_auth_providers (id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_awcms_auth_providers_tenant
  ON awcms_auth_providers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_awcms_auth_providers_tenant_created
  ON awcms_auth_providers (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE awcms_auth_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_auth_providers FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_auth_providers_tenant_isolation
  ON awcms_auth_providers
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. `awcms_tenant_auth_policies` — one row per tenant, upsert (same shape as
--    `awcms_tenant_mfa_policies`, sql/024). `break_glass_identity_ids` (jsonb
--    array of identity ids) implements the issue's break-glass model:
--    `sso_required=true` (or `password_login_enabled=false`) may only be saved
--    when at least one break-glass identity is a currently-active local owner —
--    enforced in the application (`tenant-auth-policy.ts`'s
--    `saveTenantAuthPolicy`) at SAVE time, since a DB CHECK cannot express
--    "at least one of these ids is a currently-active identity with an active
--    tenant_user membership" (cross-table validation). The safe backward-
--    compatible default (password login on, SSO off, no break-glass) means a
--    tenant that never touches this endpoint behaves exactly as before.
CREATE TABLE IF NOT EXISTS awcms_tenant_auth_policies (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  password_login_enabled boolean NOT NULL DEFAULT true,
  sso_enabled boolean NOT NULL DEFAULT false,
  sso_required boolean NOT NULL DEFAULT false,
  auto_link_verified_email boolean NOT NULL DEFAULT false,
  jit_provisioning_enabled boolean NOT NULL DEFAULT false,
  allowed_email_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  break_glass_identity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_tenant_auth_policies_login_method_check
    CHECK (password_login_enabled OR sso_enabled)
);

ALTER TABLE awcms_tenant_auth_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_tenant_auth_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_tenant_auth_policies_tenant_isolation
  ON awcms_tenant_auth_policies
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 3. `awcms_external_identities` — links a local identity to an external OIDC
--    provider's IMMUTABLE subject (`sub`), NEVER by email (issue's own
--    out-of-scope: "menghubungkan akun otomatis berdasarkan email yang tidak
--    diverifikasi"). Keyed by `(tenant_id, provider_id, issuer, subject)`
--    (issue #185's model): `issuer` is part of the key because a provider's
--    discovery document declares its own canonical issuer, and a `sub` is only
--    unique WITHIN an issuer. Composite FK `(provider_id, tenant_id)` binds the
--    link to a provider IN THE SAME TENANT (see the composite unique index on
--    `awcms_auth_providers` above). An identity may link only ONE account per
--    provider (`identity_key`); re-linking replaces, never duplicates.
CREATE TABLE IF NOT EXISTS awcms_external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  provider_id uuid NOT NULL,
  identity_id uuid NOT NULL REFERENCES awcms_identities (id),
  issuer text NOT NULL,
  subject text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_external_identities_provider_fk
    FOREIGN KEY (provider_id, tenant_id)
    REFERENCES awcms_auth_providers (id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_external_identities_subject_key
  ON awcms_external_identities (tenant_id, provider_id, issuer, subject);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_external_identities_identity_key
  ON awcms_external_identities (tenant_id, provider_id, identity_id);

CREATE INDEX IF NOT EXISTS idx_awcms_external_identities_identity
  ON awcms_external_identities (tenant_id, identity_id);

ALTER TABLE awcms_external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_external_identities FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_external_identities_tenant_isolation
  ON awcms_external_identities
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 4. `awcms_oidc_auth_requests` — the ephemeral bridge across the OAuth redirect
--    round-trip (browser leaves the app, goes to the IdP, comes back). Same
--    "ephemeral row, hash-only bearer token, TTL, single-use" shape as
--    `awcms_mfa_challenges` (sql/024). `state_hash` is the CSRF/replay defense
--    (`state` IS a bearer credential, so hashed at rest). `nonce` and
--    `code_verifier` are stored PLAINTEXT: neither is a bearer credential on its
--    own (the `nonce` must be compared literally against the returned ID token's
--    `nonce` claim; the PKCE `code_verifier` is only ever sent to the provider's
--    own token endpoint, and possessing it grants nothing without also holding
--    the authorization `code` AND the confidential client secret). `purpose`
--    distinguishes an unauthenticated login from an authenticated step-up-gated
--    account link; `identity_id` is only set for `purpose='link'` (captured
--    server-side at `start` so callback never trusts a client-supplied id).
--    `redirect_after` is a validated same-origin relative path (open-redirect
--    prevention). Composite FK binds the request to a provider in the tenant.
CREATE TABLE IF NOT EXISTS awcms_oidc_auth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  provider_id uuid NOT NULL,
  state_hash text NOT NULL,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  purpose text NOT NULL,
  identity_id uuid REFERENCES awcms_identities (id),
  redirect_after text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_oidc_auth_requests_purpose_check
    CHECK (purpose IN ('login', 'link')),
  CONSTRAINT awcms_oidc_auth_requests_link_has_identity_check
    CHECK (purpose <> 'link' OR identity_id IS NOT NULL),
  CONSTRAINT awcms_oidc_auth_requests_provider_fk
    FOREIGN KEY (provider_id, tenant_id)
    REFERENCES awcms_auth_providers (id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_oidc_auth_requests_hash_key
  ON awcms_oidc_auth_requests (state_hash);

CREATE INDEX IF NOT EXISTS idx_awcms_oidc_auth_requests_tenant
  ON awcms_oidc_auth_requests (tenant_id);

ALTER TABLE awcms_oidc_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_oidc_auth_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_oidc_auth_requests_tenant_isolation
  ON awcms_oidc_auth_requests
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
