CREATE TABLE IF NOT EXISTS awcms_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL,
  activity_code text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_permissions_key
  ON awcms_permissions (module_key, activity_code, action);

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('tenant_admin', 'office_management', 'read', 'Read office records'),
  ('tenant_admin', 'office_management', 'create', 'Create office records'),
  ('tenant_admin', 'office_management', 'update', 'Update office records'),
  ('tenant_admin', 'tenant_settings', 'read', 'Read tenant settings'),
  ('tenant_admin', 'tenant_settings', 'update', 'Update tenant settings'),
  ('identity_access', 'access_control', 'read', 'Read roles, permissions, and decision logs'),
  ('identity_access', 'access_control', 'assign', 'Assign roles to tenant users'),
  ('identity_access', 'access_control', 'configure', 'Manage roles and role permissions'),
  ('profile_identity', 'profile_management', 'read', 'Read profile records'),
  ('profile_identity', 'profile_management', 'create', 'Create profile records'),
  ('profile_identity', 'profile_management', 'update', 'Update profile records'),
  ('profile_identity', 'profile_management', 'delete', 'Soft delete profile records'),
  ('profile_identity', 'profile_management', 'restore', 'Restore soft-deleted profile records')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

CREATE TABLE IF NOT EXISTS awcms_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  role_code text NOT NULL,
  role_name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_roles_tenant_code_key
  ON awcms_roles (tenant_id, role_code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_roles_tenant_idx ON awcms_roles (tenant_id);

ALTER TABLE awcms_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_roles_tenant_isolation
  ON awcms_roles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  role_id uuid NOT NULL REFERENCES awcms_roles (id),
  permission_id uuid NOT NULL REFERENCES awcms_permissions (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_role_permissions_key
  ON awcms_role_permissions (tenant_id, role_id, permission_id);

CREATE INDEX IF NOT EXISTS awcms_role_permissions_tenant_idx ON awcms_role_permissions (tenant_id);

ALTER TABLE awcms_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_role_permissions_tenant_isolation
  ON awcms_role_permissions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_access_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  tenant_user_id uuid NOT NULL REFERENCES awcms_tenant_users (id),
  role_id uuid NOT NULL REFERENCES awcms_roles (id),
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_access_assignments_key
  ON awcms_access_assignments (tenant_id, tenant_user_id, role_id);

CREATE INDEX IF NOT EXISTS awcms_access_assignments_tenant_idx ON awcms_access_assignments (tenant_id);

ALTER TABLE awcms_access_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_access_assignments_tenant_isolation
  ON awcms_access_assignments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_abac_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  policy_code text NOT NULL,
  effect text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_abac_policies_effect_check
    CHECK (effect IN ('allow', 'deny'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_abac_policies_tenant_code_key
  ON awcms_abac_policies (tenant_id, policy_code);

ALTER TABLE awcms_abac_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_abac_policies_tenant_isolation
  ON awcms_abac_policies
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_abac_decision_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  tenant_user_id uuid REFERENCES awcms_tenant_users (id),
  module_key text NOT NULL,
  activity_code text NOT NULL,
  action text NOT NULL,
  resource_type text,
  resource_id uuid,
  decision text NOT NULL,
  reason text NOT NULL,
  matched_policy text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_abac_decision_logs_decision_check
    CHECK (decision IN ('allow', 'deny'))
);

CREATE INDEX IF NOT EXISTS awcms_abac_decision_logs_tenant_idx
  ON awcms_abac_decision_logs (tenant_id, created_at DESC);

ALTER TABLE awcms_abac_decision_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY awcms_abac_decision_logs_tenant_isolation
  ON awcms_abac_decision_logs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
