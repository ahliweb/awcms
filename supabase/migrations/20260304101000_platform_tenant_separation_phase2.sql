-- Migration: Platform vs Tenant Configuration Separation - Phase 2 Roles & Permissions

BEGIN;

-- 1. Insert new platform-scoped permissions
INSERT INTO public.permissions (name, description, resource, action, module)
VALUES 
  -- Platform Settings
  ('platform.setting.read', 'View platform-level settings', 'platform.setting', 'read', 'platform'),
  ('platform.setting.create', 'Create platform settings', 'platform.setting', 'create', 'platform'),
  ('platform.setting.update', 'Modify platform settings', 'platform.setting', 'update', 'platform'),
  ('platform.setting.delete', 'Remove platform settings', 'platform.setting', 'delete', 'platform'),
  
  -- Tenant Management at Platform Level
  ('platform.tenant.read', 'View all tenants', 'platform.tenant', 'read', 'platform'),
  ('platform.tenant.create', 'Create new tenants', 'platform.tenant', 'create', 'platform'),
  ('platform.tenant.update', 'Modify tenant config', 'platform.tenant', 'update', 'platform'),
  ('platform.tenant.delete', 'Deactivate tenants', 'platform.tenant', 'delete', 'platform'),
  
  -- Platform Modules & Extensions
  ('platform.module.manage', 'Enable/disable modules globally', 'platform.module', 'manage', 'platform'),
  ('platform.extensions.manage', 'Manage extensions globally', 'platform.extensions', 'manage', 'platform')
ON CONFLICT (name) DO NOTHING;

-- 2. Assign these new permissions to the Platform Admin and Super Admin roles
DO $$
DECLARE
  v_role_id UUID;
  v_perm_id UUID;
  v_perm_name TEXT;
  v_new_perms TEXT[] := ARRAY[
    'platform.setting.read', 'platform.setting.create', 'platform.setting.update', 'platform.setting.delete',
    'platform.tenant.read', 'platform.tenant.create', 'platform.tenant.update', 'platform.tenant.delete',
    'platform.module.manage', 'platform.extensions.manage'
  ];
BEGIN
  -- Loop through all roles that are either platform admin or full access
  FOR v_role_id IN 
    SELECT id FROM public.roles 
    WHERE (is_platform_admin = true OR is_full_access = true) AND deleted_at IS NULL
  LOOP
    -- Loop through the new permissions
    FOREACH v_perm_name IN ARRAY v_new_perms
    LOOP
      -- Get permission ID
      SELECT id INTO v_perm_id FROM public.permissions WHERE name = v_perm_name AND deleted_at IS NULL;
      
      -- Assign if not exists
      IF v_perm_id IS NOT NULL THEN
        INSERT INTO public.role_permissions (role_id, permission_id)
        VALUES (v_role_id, v_perm_id)
        ON CONFLICT (role_id, permission_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- 3. Log the migration
INSERT INTO audit_logs (
  action,
  resource,
  details,
  created_at
) VALUES (
  'MIGRATION',
  'permissions',
  jsonb_build_object(
    'description', 'Added platform-scoped permissions for Settings, Tenants, Modules, and Extensions',
    'migration', '20260304101000_platform_tenant_separation_phase2'
  ),
  NOW()
);

COMMIT;
