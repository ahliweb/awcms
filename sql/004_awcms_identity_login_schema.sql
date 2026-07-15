CREATE TABLE IF NOT EXISTS awcms_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  profile_id uuid NOT NULL REFERENCES awcms_profiles (id),
  login_identifier text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_identities_status_check
    CHECK (status IN ('active', 'inactive', 'locked')),
  CONSTRAINT awcms_identities_failed_login_count_check
    CHECK (failed_login_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_identities_tenant_login_key
  ON awcms_identities (tenant_id, login_identifier);
CREATE INDEX IF NOT EXISTS awcms_identities_tenant_idx ON awcms_identities (tenant_id);
CREATE INDEX IF NOT EXISTS awcms_identities_profile_idx ON awcms_identities (profile_id);

ALTER TABLE awcms_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_identities_tenant_isolation
  ON awcms_identities
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_tenant_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  identity_id uuid NOT NULL REFERENCES awcms_identities (id),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_tenant_users_status_check
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_tenant_users_tenant_identity_key
  ON awcms_tenant_users (tenant_id, identity_id);
CREATE INDEX IF NOT EXISTS awcms_tenant_users_tenant_idx ON awcms_tenant_users (tenant_id);

ALTER TABLE awcms_tenant_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_tenant_users_tenant_isolation
  ON awcms_tenant_users
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  identity_id uuid NOT NULL REFERENCES awcms_identities (id),
  token_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_sessions_token_hash_key ON awcms_sessions (token_hash);
CREATE INDEX IF NOT EXISTS awcms_sessions_tenant_identity_idx ON awcms_sessions (tenant_id, identity_id);

ALTER TABLE awcms_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_sessions_tenant_isolation
  ON awcms_sessions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
