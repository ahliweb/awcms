CREATE TABLE IF NOT EXISTS awcms_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  profile_type text NOT NULL,
  display_name text NOT NULL,
  legal_name text,
  status text NOT NULL DEFAULT 'active',
  verification_status text NOT NULL DEFAULT 'unverified',
  risk_level text NOT NULL DEFAULT 'normal',
  merged_into_profile_id uuid REFERENCES awcms_profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_profiles_profile_type_check
    CHECK (profile_type IN ('person', 'organization')),
  CONSTRAINT awcms_profiles_status_check
    CHECK (status IN ('active', 'inactive', 'merged')),
  CONSTRAINT awcms_profiles_verification_status_check
    CHECK (verification_status IN ('unverified', 'pending', 'verified')),
  CONSTRAINT awcms_profiles_risk_level_check
    CHECK (risk_level IN ('low', 'normal', 'high'))
);

CREATE INDEX IF NOT EXISTS awcms_profiles_tenant_idx ON awcms_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS awcms_profiles_tenant_deleted_idx ON awcms_profiles (tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS awcms_profiles_merged_into_idx ON awcms_profiles (merged_into_profile_id);

ALTER TABLE awcms_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_profiles_tenant_isolation
  ON awcms_profiles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_profile_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  profile_id uuid NOT NULL REFERENCES awcms_profiles (id),
  identifier_type text NOT NULL,
  normalized_value text NOT NULL,
  value_hash text NOT NULL,
  masked_value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_profile_identifiers_type_check
    CHECK (identifier_type IN ('email', 'phone', 'whatsapp', 'national_id', 'tax_id', 'external_code', 'other')),
  CONSTRAINT awcms_profile_identifiers_verification_status_check
    CHECK (verification_status IN ('unverified', 'pending', 'verified'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_profile_identifiers_dedup_key
  ON awcms_profile_identifiers (tenant_id, identifier_type, value_hash)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_profile_identifiers_tenant_idx ON awcms_profile_identifiers (tenant_id);
CREATE INDEX IF NOT EXISTS awcms_profile_identifiers_profile_idx ON awcms_profile_identifiers (profile_id);

ALTER TABLE awcms_profile_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_profile_identifiers_tenant_isolation
  ON awcms_profile_identifiers
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_profile_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  profile_id uuid NOT NULL REFERENCES awcms_profiles (id),
  module_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  link_role text NOT NULL DEFAULT 'related',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_profile_entity_links_entity_key
  ON awcms_profile_entity_links (tenant_id, module_key, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS awcms_profile_entity_links_profile_idx ON awcms_profile_entity_links (profile_id);

ALTER TABLE awcms_profile_entity_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_profile_entity_links_tenant_isolation
  ON awcms_profile_entity_links
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
