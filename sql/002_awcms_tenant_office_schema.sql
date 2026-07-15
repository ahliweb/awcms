CREATE TABLE IF NOT EXISTS awcms_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code text NOT NULL,
  tenant_name text NOT NULL,
  legal_name text,
  status text NOT NULL DEFAULT 'active',
  default_locale text NOT NULL DEFAULT 'id',
  default_theme text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT awcms_tenants_status_check
    CHECK (status IN ('active', 'inactive', 'suspended'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_tenants_tenant_code_key
  ON awcms_tenants (tenant_code);

CREATE TABLE IF NOT EXISTS awcms_offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  office_code text NOT NULL,
  office_name text NOT NULL,
  office_type text NOT NULL DEFAULT 'head_office',
  parent_office_id uuid REFERENCES awcms_offices (id),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_offices_office_type_check
    CHECK (office_type IN ('head_office', 'branch', 'store', 'warehouse', 'other')),
  CONSTRAINT awcms_offices_status_check
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_offices_tenant_code_key
  ON awcms_offices (tenant_id, office_code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_offices_tenant_idx
  ON awcms_offices (tenant_id);

CREATE INDEX IF NOT EXISTS awcms_offices_tenant_deleted_idx
  ON awcms_offices (tenant_id, deleted_at);

CREATE INDEX IF NOT EXISTS awcms_offices_parent_office_idx
  ON awcms_offices (parent_office_id);

ALTER TABLE awcms_offices ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_offices_tenant_isolation
  ON awcms_offices
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE awcms_tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_tenant_settings_tenant_isolation
  ON awcms_tenant_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
