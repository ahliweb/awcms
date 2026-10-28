-- `channel_accounts` — the account and credential CONTROL PLANE of the
-- omnichannel foundation (Issue #1140, ADR-0148 capability C1; data dictionary
-- in docs/awcms/omnichannel-foundation.md section 2.1).
--
-- This schema holds identities, grants, capability evidence, secret REFERENCES
-- and health. It SENDS NOTHING: there is no queue here, no provider call and no
-- dispatcher. A website's social links are not connected accounts; a tenant's
-- own WhatsApp number, Page, channel, bot or ESP login is, and it is modelled
-- here exactly once so that every channel conforms to one account model.
--
-- ## Invariants this file enforces in the schema (ADR-0148 section 2)
--
--   I1  Every table is tenant-scoped, ENABLE + FORCE ROW LEVEL SECURITY, with a
--       tenant-isolation policy. A brand is a BUSINESS SCOPE reference
--       (`business_scope_type`/`business_scope_id`, the generic pair sql/027
--       uses), never a new ABAC attribute. An external account is unique per
--       (provider, external id) ACROSS tenants among live rows: a second tenant
--       claiming an account another tenant holds is REFUSED, not merged. That
--       index is the one place the schema deliberately spans tenants, because
--       RLS cannot show tenant B that tenant A holds the account; a unique index
--       is not subject to RLS. The API answers the conflict with one generic code
--       for "same tenant" and "other tenant" alike.
--   I2  Capability is FAIL-CLOSED per account: no row means denied, and a
--       `granted` row must carry evidence (CHECK below).
--   I3  Secrets are rows in `awcms_channel_secrets`, addressed by an opaque
--       uuid reference. The only value column is `ciphertext`, and a CHECK pins
--       it to the shared field-encryption envelope (`v2:<keyId>:...`), so a
--       plaintext token cannot be written even by a buggy code path.
--   I13 Additive and forward-only: new tables, nothing existing is altered.
--
-- ## Provider and kind are validated in code, not by CHECK on a list
--
-- The provider capability matrix is a versioned artefact with a code mirror
-- (`domain/provider-matrix.ts`) held equal to the documentation by a test.
-- Repeating the provider list as a CHECK here would be a second copy that has to
-- be edited by a migration for every provider the matrix admits. The columns are
-- constrained to a safe SHAPE (lower snake case, bounded); the closed set lives
-- where the matrix lives.
--
-- ## Deletion
--
-- Accounts are soft-deleted (`deleted_at`, status `deleted`). SECRETS are the one
-- deliberate exception: revoking or disconnecting hard-deletes the ciphertext
-- row, because a soft-deleted secret would keep a recoverable credential alive
-- after the tenant was told it was gone.
--
-- Every table here also answers the two retention questions in the same change:
-- `subjectData` descriptors (or a reasoned `NO_SUBJECT_DATA` entry for the health
-- table) in `src/modules/channel-accounts/module.ts`, and a reasoned
-- `BOUNDED_BY_DESIGN` entry in `scripts/data-lifecycle-table-coverage-check.ts`
-- (every table is bounded by authorship, a unique key or the bounded sweep, and a
-- delegated lifecycle descriptor would have needed a worker read grant on a
-- control-plane table).

-- ---------------------------------------------------------------------------
-- Secrets: envelope-encrypted credentials, referenced by uuid, never returned.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_channel_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  purpose text NOT NULL,
  -- `v2:<keyId>:<iv>:<tag>:<ciphertext>` (src/lib/security/field-encryption.ts).
  -- The associated data binds purpose, tenant and THIS row's id, so a ciphertext
  -- copied to another row or tenant fails authentication.
  ciphertext text NOT NULL,
  -- Denormalised from the envelope so a re-encrypt job can find rows not under
  -- the active key with a plain index scan; the envelope is authoritative.
  key_id text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_channel_secrets_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_channel_secrets_purpose_check CHECK (
    purpose IN (
      'provider_access_token',
      'provider_refresh_token',
      'api_token',
      'device_key',
      'bot_token',
      'webhook_signing_secret',
      'oauth_pkce_verifier',
      'oauth_authorization_code'
    )
  ),
  CONSTRAINT awcms_channel_secrets_envelope_check CHECK (
    ciphertext ~ '^v2:[a-z0-9]{1,8}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*$'
    AND char_length(ciphertext) <= 8192
  ),
  CONSTRAINT awcms_channel_secrets_key_id_check CHECK (key_id ~ '^[a-z0-9]{1,8}$'),
  CONSTRAINT awcms_channel_secrets_version_check CHECK (version >= 1),
  CONSTRAINT awcms_channel_secrets_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_channel_secrets_rekey_idx
  ON awcms_channel_secrets (tenant_id, key_id);

CREATE INDEX IF NOT EXISTS awcms_channel_secrets_created_by_idx
  ON awcms_channel_secrets (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

COMMENT ON TABLE awcms_channel_secrets IS
  'Issue #1140 / ADR-0148 section 5 — envelope-encrypted provider credentials (AES-256-GCM, shared field-encryption helper). Never returned by any API, never logged, never in an event, audit row, job payload or AI context. Hard-deleted on revoke.';

ALTER TABLE awcms_channel_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_secrets FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_secrets_tenant_isolation
  ON awcms_channel_secrets
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Provider connections: ONE authorisation a tenant granted a provider. A
-- connection can expose several accounts (a user who administers several Pages)
-- and an account can be re-bound to a new connection: the TOKEN HOLDER is not
-- the account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_channel_provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  provider text NOT NULL,
  auth_mode text NOT NULL,
  grant_state text NOT NULL DEFAULT 'pending',
  label text,
  -- Scope MINIMISATION is recorded, not assumed: what the provider actually
  -- granted, and a hash of that list as capability evidence.
  granted_scopes text[] NOT NULL DEFAULT '{}',
  scope_list_hash text,
  issued_at timestamptz,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  revoked_at timestamptz,
  -- References into awcms_channel_secrets; nullable (an API-token or device
  -- connection has no refresh token, a pending grant has neither).
  access_secret_id uuid,
  refresh_secret_id uuid,
  -- A callback that has been verified but not yet exchanged for tokens: the
  -- provider's authorisation code (encrypted, purpose `oauth_authorization_code`)
  -- and the state it belongs to (whose PKCE verifier is still held). The token
  -- exchange is provider I/O and therefore runs OUTSIDE any request transaction
  -- (ADR-0148 I10), in the adapter issue's job; this row is the durable hand-off.
  oauth_state_id uuid,
  pending_code_secret_id uuid,
  connected_by uuid,
  -- Provenance of the grant (ADR-0148 / pack 2.1): which consent text the person
  -- saw and a hash of the redirect URI the grant was issued against.
  consent_text_version text,
  redirect_uri_hash text,
  -- Server-side refresh lock. A refresh takes the lease with a compare-and-set;
  -- the loser of a race sees zero rows updated and does NOT call the provider.
  refresh_lease_until timestamptz,
  refresh_failure_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_channel_provider_connections_tenant_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT awcms_channel_provider_connections_provider_check
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT awcms_channel_provider_connections_auth_mode_check
    CHECK (auth_mode IN ('oauth2', 'api_token', 'bot_token', 'device_key')),
  CONSTRAINT awcms_channel_provider_connections_grant_state_check
    CHECK (grant_state IN ('pending', 'active', 'expired', 'revoked', 'failed')),
  CONSTRAINT awcms_channel_provider_connections_label_check
    CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 200),
  CONSTRAINT awcms_channel_provider_connections_scopes_bounded
    CHECK (cardinality(granted_scopes) <= 64),
  CONSTRAINT awcms_channel_provider_connections_failures_check
    CHECK (refresh_failure_count >= 0),
  -- A revoked grant holds no credential reference: revocation clears them.
  CONSTRAINT awcms_channel_provider_connections_revoked_clears_secrets
    CHECK (
      grant_state <> 'revoked'
      OR (
        access_secret_id IS NULL
        AND refresh_secret_id IS NULL
        AND pending_code_secret_id IS NULL
      )
    ),
  CONSTRAINT awcms_channel_provider_connections_access_secret_fk
    FOREIGN KEY (tenant_id, access_secret_id)
    REFERENCES awcms_channel_secrets (tenant_id, id),
  CONSTRAINT awcms_channel_provider_connections_refresh_secret_fk
    FOREIGN KEY (tenant_id, refresh_secret_id)
    REFERENCES awcms_channel_secrets (tenant_id, id),
  CONSTRAINT awcms_channel_provider_connections_code_secret_fk
    FOREIGN KEY (tenant_id, pending_code_secret_id)
    REFERENCES awcms_channel_secrets (tenant_id, id),
  CONSTRAINT awcms_channel_provider_connections_connected_by_fk
    FOREIGN KEY (tenant_id, connected_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_channel_provider_connections_list_idx
  ON awcms_channel_provider_connections (tenant_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_channel_provider_connections_access_secret_idx
  ON awcms_channel_provider_connections (tenant_id, access_secret_id)
  WHERE access_secret_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_provider_connections_refresh_secret_idx
  ON awcms_channel_provider_connections (tenant_id, refresh_secret_id)
  WHERE refresh_secret_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_provider_connections_code_secret_idx
  ON awcms_channel_provider_connections (tenant_id, pending_code_secret_id)
  WHERE pending_code_secret_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_provider_connections_oauth_state_idx
  ON awcms_channel_provider_connections (tenant_id, oauth_state_id)
  WHERE oauth_state_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_provider_connections_connected_by_idx
  ON awcms_channel_provider_connections (tenant_id, connected_by)
  WHERE connected_by IS NOT NULL;

COMMENT ON TABLE awcms_channel_provider_connections IS
  'Issue #1140 / ADR-0148 — one authorisation a tenant granted a provider (OAuth grant, API token, bot token or device key). Holds secret REFERENCES only. One connection can expose several accounts; the token holder is not the account.';

ALTER TABLE awcms_channel_provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_provider_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_provider_connections_tenant_isolation
  ON awcms_channel_provider_connections
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Accounts: a page, profile, channel, WABA phone, device, bot, ESP login or
-- sender identity. `parent_account_id` links a child identity to its container
-- (a phone number to its WABA, a verified sender to its ESP account) so they are
-- modelled uniformly as linked identities.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_channel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- A brand/unit is a business scope: the generic (type, id) pair of sql/027.
  -- Both NULL means tenant-wide.
  business_scope_type text,
  business_scope_id uuid,
  provider text NOT NULL,
  account_kind text NOT NULL,
  -- The provider-stable identity: page id, phone_number_id, device id, bot id,
  -- channel id, ESP account id. Immutable once written (sql/320).
  external_id text NOT NULL,
  display_name text NOT NULL,
  auth_mode text NOT NULL,
  connection_id uuid,
  parent_account_id uuid,
  -- The account's own credential reference (API token, device key, bot token).
  -- OAuth accounts keep theirs on the connection instead.
  secret_id uuid,
  status text NOT NULL DEFAULT 'pending',
  status_reason text,
  connected_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_channel_accounts_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_channel_accounts_provider_check
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT awcms_channel_accounts_kind_check
    CHECK (account_kind ~ '^[a-z][a-z0-9_]{1,47}$'),
  CONSTRAINT awcms_channel_accounts_external_id_check
    CHECK (char_length(external_id) BETWEEN 1 AND 256 AND external_id = btrim(external_id)),
  CONSTRAINT awcms_channel_accounts_display_name_check
    CHECK (char_length(display_name) BETWEEN 1 AND 200),
  CONSTRAINT awcms_channel_accounts_auth_mode_check
    CHECK (auth_mode IN ('oauth2', 'api_token', 'bot_token', 'device_key')),
  CONSTRAINT awcms_channel_accounts_status_check
    CHECK (status IN ('pending', 'connected', 'degraded', 'revoked', 'disabled', 'deleted')),
  CONSTRAINT awcms_channel_accounts_status_reason_check
    CHECK (status_reason IS NULL OR char_length(status_reason) <= 120),
  CONSTRAINT awcms_channel_accounts_scope_pair_check CHECK (
    (business_scope_type IS NULL AND business_scope_id IS NULL)
    OR (
      business_scope_type IS NOT NULL
      AND business_scope_id IS NOT NULL
      AND business_scope_type ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  CONSTRAINT awcms_channel_accounts_deleted_pair_check
    CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT awcms_channel_accounts_not_own_parent_check
    CHECK (parent_account_id IS NULL OR parent_account_id <> id),
  CONSTRAINT awcms_channel_accounts_connection_fk
    FOREIGN KEY (tenant_id, connection_id)
    REFERENCES awcms_channel_provider_connections (tenant_id, id),
  CONSTRAINT awcms_channel_accounts_parent_fk
    FOREIGN KEY (tenant_id, parent_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_channel_accounts_secret_fk
    FOREIGN KEY (tenant_id, secret_id)
    REFERENCES awcms_channel_secrets (tenant_id, id),
  CONSTRAINT awcms_channel_accounts_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_channel_accounts_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_channel_accounts_deleted_by_fk
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- I1: a live external account belongs to exactly ONE tenant. NOT scoped by
-- tenant_id on purpose (see the header); a deleted row releases the claim.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_channel_accounts_live_external_key
  ON awcms_channel_accounts (provider, external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_accounts_list_idx
  ON awcms_channel_accounts (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS awcms_channel_accounts_scope_idx
  ON awcms_channel_accounts (tenant_id, business_scope_type, business_scope_id)
  WHERE business_scope_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_accounts_connection_idx
  ON awcms_channel_accounts (tenant_id, connection_id)
  WHERE connection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_accounts_parent_idx
  ON awcms_channel_accounts (tenant_id, parent_account_id)
  WHERE parent_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_accounts_secret_idx
  ON awcms_channel_accounts (tenant_id, secret_id)
  WHERE secret_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_accounts_created_by_idx
  ON awcms_channel_accounts (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_accounts_updated_by_idx
  ON awcms_channel_accounts (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_accounts_deleted_by_idx
  ON awcms_channel_accounts (tenant_id, deleted_by)
  WHERE deleted_by IS NOT NULL;

COMMENT ON TABLE awcms_channel_accounts IS
  'Issue #1140 / ADR-0148 — a tenant''s connected external account (page, profile, channel, WABA phone, device, bot, ESP login, sender identity). Unique per live (provider, external_id) across tenants; a brand is a business scope. Holds no credential, only a secret reference.';

ALTER TABLE awcms_channel_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_accounts_tenant_isolation
  ON awcms_channel_accounts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Capabilities: what an account may do. ROW ABSENT MEANS DENIED (I2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_channel_account_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  account_id uuid NOT NULL,
  capability text NOT NULL,
  state text NOT NULL,
  -- The approval, scope list or contract that grants it. Required to be
  -- `granted`; the provider matrix additionally decides whether the cell can be
  -- used at all, and the application re-evaluates both on every use.
  evidence_kind text,
  evidence_ref text,
  matrix_version integer NOT NULL,
  verified_at timestamptz,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_channel_account_capabilities_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_channel_account_capabilities_account_capability_key
    UNIQUE (tenant_id, account_id, capability),
  CONSTRAINT awcms_channel_account_capabilities_capability_check CHECK (
    capability IN (
      'publish', 'reply', 'dm', 'inbound', 'comments',
      'analytics', 'leads', 'ads', 'broadcast'
    )
  ),
  CONSTRAINT awcms_channel_account_capabilities_state_check
    CHECK (state IN ('granted', 'pending_approval', 'denied', 'not_offered')),
  CONSTRAINT awcms_channel_account_capabilities_evidence_kind_check CHECK (
    evidence_kind IS NULL OR evidence_kind IN (
      'scope_list_hash', 'app_review_reference',
      'contract_reference', 'written_authorization'
    )
  ),
  CONSTRAINT awcms_channel_account_capabilities_evidence_ref_check
    CHECK (evidence_ref IS NULL OR char_length(evidence_ref) BETWEEN 1 AND 200),
  CONSTRAINT awcms_channel_account_capabilities_granted_needs_evidence CHECK (
    state <> 'granted'
    OR (evidence_kind IS NOT NULL AND evidence_ref IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CONSTRAINT awcms_channel_account_capabilities_matrix_version_check
    CHECK (matrix_version >= 1),
  CONSTRAINT awcms_channel_account_capabilities_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_channel_account_capabilities_granted_by_fk
    FOREIGN KEY (tenant_id, granted_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_channel_account_capabilities_granted_by_idx
  ON awcms_channel_account_capabilities (tenant_id, granted_by)
  WHERE granted_by IS NOT NULL;

COMMENT ON TABLE awcms_channel_account_capabilities IS
  'Issue #1140 / ADR-0148 I2 — per-account capability, fail-closed: a missing row is denied, a granted row needs evidence, and the code-mirrored provider matrix has the last word on every use.';

ALTER TABLE awcms_channel_account_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_account_capabilities FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_account_capabilities_tenant_isolation
  ON awcms_channel_account_capabilities
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Webhook subscriptions: HOW inbound events will reach us for one account.
-- Metadata only in this issue; no endpoint reads this table yet (inbound is
-- #1144 and the per-provider connector issues).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_channel_webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  account_id uuid NOT NULL,
  provider text NOT NULL,
  -- SHA-256 of an opaque per-account callback token. UNIQUE across tenants
  -- because a future public webhook route resolves tenant and account from the
  -- token alone; 256 random bits make that safe, and only the hash is stored.
  callback_token_hash text NOT NULL,
  verification_mode text NOT NULL,
  -- I9: a provider that cannot authenticate its callbacks may only ever deliver
  -- STATUS-class events. Content events from `unauthenticated` are refused by
  -- this CHECK, not by configuration.
  accepts_content_events boolean NOT NULL DEFAULT false,
  replay_window_seconds integer NOT NULL DEFAULT 300,
  signing_secret_id uuid,
  status text NOT NULL DEFAULT 'pending',
  last_event_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_channel_webhook_subscriptions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_channel_webhook_subscriptions_token_key
    UNIQUE (callback_token_hash),
  CONSTRAINT awcms_channel_webhook_subscriptions_provider_check
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT awcms_channel_webhook_subscriptions_token_hash_check
    CHECK (callback_token_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT awcms_channel_webhook_subscriptions_mode_check CHECK (
    verification_mode IN ('hmac_signature', 'secret_header', 'challenge', 'unauthenticated')
  ),
  CONSTRAINT awcms_channel_webhook_subscriptions_unauthenticated_status_only CHECK (
    verification_mode <> 'unauthenticated' OR accepts_content_events = false
  ),
  CONSTRAINT awcms_channel_webhook_subscriptions_replay_window_check
    CHECK (replay_window_seconds BETWEEN 0 AND 3600),
  CONSTRAINT awcms_channel_webhook_subscriptions_status_check
    CHECK (status IN ('pending', 'active', 'paused', 'revoked')),
  CONSTRAINT awcms_channel_webhook_subscriptions_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_channel_webhook_subscriptions_secret_fk
    FOREIGN KEY (tenant_id, signing_secret_id)
    REFERENCES awcms_channel_secrets (tenant_id, id),
  CONSTRAINT awcms_channel_webhook_subscriptions_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_channel_webhook_subscriptions_account_idx
  ON awcms_channel_webhook_subscriptions (tenant_id, account_id);

CREATE INDEX IF NOT EXISTS awcms_channel_webhook_subscriptions_secret_idx
  ON awcms_channel_webhook_subscriptions (tenant_id, signing_secret_id)
  WHERE signing_secret_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_webhook_subscriptions_created_by_idx
  ON awcms_channel_webhook_subscriptions (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

COMMENT ON TABLE awcms_channel_webhook_subscriptions IS
  'Issue #1140 / ADR-0148 I9 — how inbound events reach us for one account. Callback token stored hashed; an unauthenticated provider is status-class only (CHECK). Metadata only: no route reads it yet.';

ALTER TABLE awcms_channel_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_webhook_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_webhook_subscriptions_tenant_isolation
  ON awcms_channel_webhook_subscriptions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Health: the LATEST state per account (one row, upserted). The bounded history
-- the pack mentions is deliberately not a table here: it would be an unbounded
-- append log needing its own purge before any consumer exists.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_channel_account_health (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  account_id uuid NOT NULL,
  state text NOT NULL,
  reason_code text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  token_expires_at timestamptz,
  quota_remaining bigint,
  quota_limit bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id),
  CONSTRAINT awcms_channel_account_health_state_check
    CHECK (state IN ('ok', 'degraded', 'failing', 'unknown')),
  CONSTRAINT awcms_channel_account_health_reason_check
    CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT awcms_channel_account_health_quota_check CHECK (
    (quota_remaining IS NULL OR quota_remaining >= 0)
    AND (quota_limit IS NULL OR quota_limit >= 0)
  ),
  CONSTRAINT awcms_channel_account_health_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id)
);

COMMENT ON TABLE awcms_channel_account_health IS
  'Issue #1140 / ADR-0148 — latest health per account (state, reason code, token expiry, quota). One row per account; reason codes are fixed codes, never provider text.';

ALTER TABLE awcms_channel_account_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_account_health FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_account_health_tenant_isolation
  ON awcms_channel_account_health
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Assignments: who may operate an account. In addition to, NEVER instead of,
-- the permission checks (default deny, deny overrides).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_channel_account_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  account_id uuid NOT NULL,
  tenant_user_id uuid NOT NULL,
  kind text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_channel_account_assignments_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_channel_account_assignments_account_user_key
    UNIQUE (tenant_id, account_id, tenant_user_id),
  CONSTRAINT awcms_channel_account_assignments_kind_check
    CHECK (kind IN ('owner', 'operator', 'viewer')),
  CONSTRAINT awcms_channel_account_assignments_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_channel_account_assignments_user_fk
    FOREIGN KEY (tenant_id, tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_channel_account_assignments_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_channel_account_assignments_user_idx
  ON awcms_channel_account_assignments (tenant_id, tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_channel_account_assignments_created_by_idx
  ON awcms_channel_account_assignments (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

COMMENT ON TABLE awcms_channel_account_assignments IS
  'Issue #1140 / ADR-0148 — who may operate a channel account (owner / operator / viewer), additive to RBAC/ABAC, never a replacement.';

ALTER TABLE awcms_channel_account_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_account_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_account_assignments_tenant_isolation
  ON awcms_channel_account_assignments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- OAuth states: the single-use `state` nonce and PKCE verifier reference of an
-- authorisation in flight. Only the SHA-256 of the 256-bit state is stored; the
-- PKCE verifier is a secret row (purpose `oauth_pkce_verifier`), deleted at
-- consumption. The callback is accepted only for the tenant AND the person that
-- started the flow (T1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_channel_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  provider text NOT NULL,
  state_hash text NOT NULL,
  initiated_by uuid NOT NULL,
  pkce_secret_id uuid,
  redirect_uri_hash text NOT NULL,
  requested_scopes text[] NOT NULL DEFAULT '{}',
  business_scope_type text,
  business_scope_id uuid,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_channel_oauth_states_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_channel_oauth_states_state_hash_key UNIQUE (state_hash),
  CONSTRAINT awcms_channel_oauth_states_state_hash_check
    CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT awcms_channel_oauth_states_provider_check
    CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT awcms_channel_oauth_states_redirect_hash_check
    CHECK (redirect_uri_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT awcms_channel_oauth_states_scopes_bounded
    CHECK (cardinality(requested_scopes) <= 64),
  CONSTRAINT awcms_channel_oauth_states_scope_pair_check CHECK (
    (business_scope_type IS NULL AND business_scope_id IS NULL)
    OR (business_scope_type IS NOT NULL AND business_scope_id IS NOT NULL)
  ),
  CONSTRAINT awcms_channel_oauth_states_initiated_by_fk
    FOREIGN KEY (tenant_id, initiated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  -- The verifier outlives consumption (the token exchange needs it) and is then
  -- deleted by whoever finishes the exchange; the reference clears itself.
  CONSTRAINT awcms_channel_oauth_states_pkce_secret_fk
    FOREIGN KEY (tenant_id, pkce_secret_id)
    REFERENCES awcms_channel_secrets (tenant_id, id)
    ON DELETE SET NULL (pkce_secret_id)
);

ALTER TABLE awcms_channel_provider_connections
  ADD CONSTRAINT awcms_channel_provider_connections_oauth_state_fk
  FOREIGN KEY (tenant_id, oauth_state_id)
  REFERENCES awcms_channel_oauth_states (tenant_id, id);

CREATE INDEX IF NOT EXISTS awcms_channel_oauth_states_initiated_by_idx
  ON awcms_channel_oauth_states (tenant_id, initiated_by);

CREATE INDEX IF NOT EXISTS awcms_channel_oauth_states_pkce_secret_idx
  ON awcms_channel_oauth_states (tenant_id, pkce_secret_id)
  WHERE pkce_secret_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_oauth_states_retention_idx
  ON awcms_channel_oauth_states (tenant_id, created_at);

COMMENT ON TABLE awcms_channel_oauth_states IS
  'Issue #1140 / ADR-0148 T1 — single-use OAuth state (hashed) and PKCE verifier reference for an authorisation in flight, bound to the tenant and the person that started it. Short-lived; swept by data_lifecycle.';

ALTER TABLE awcms_channel_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_oauth_states FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_oauth_states_tenant_isolation
  ON awcms_channel_oauth_states
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- No `awcms_app` GRANT: sql/019's ALTER DEFAULT PRIVILEGES covers tables created
-- afterwards. No `awcms_worker` GRANT: no job reads or writes these tables in
-- this issue (the re-encrypt job runs as awcms_app, like telegram:chat:rekey);
-- the first dispatcher that needs a column adds its own narrow grant and a
-- WORKER_ROLE_GRANTS entry in the same change.
