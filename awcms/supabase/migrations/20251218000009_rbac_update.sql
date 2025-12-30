-- Migration: 20251218_rbac_update.sql
-- Description: Adds Platform Admin Role and specific permissions for multi-tenant management.

BEGIN;

  -- 1. Create 'super_super_admin' role if not exists
  INSERT INTO public.roles (name, description, is_system)
  VALUES ('super_super_admin', 'Platform Administrator. Full system access.', TRUE)
  ON CONFLICT (name) DO NOTHING;

  -- 2. Ensure Permissions Table has correct columns (Fix for missing columns in legacy DBs)
  ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS module TEXT;
  ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS action TEXT;
  ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS resource TEXT; -- App uses this, ensure it exists

  -- 3. Insert New Permissions
  INSERT INTO public.permissions (name, description, module, resource, action)
  VALUES
    ('manage_tenants', 'Create, Edit, Delete Tenants', 'tenants', 'tenants', 'manage'),
    ('manage_platform_settings', 'Manage Global Platform Config', 'settings', 'settings', 'manage'),
    ('view_system_audit_logs', 'View All System Logs', 'audit_logs', 'audit_logs', 'view')
  ON CONFLICT (name) DO UPDATE SET
    module = EXCLUDED.module,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

  -- 3. Assign Permissions to 'super_super_admin' (Optional, code bypass exists but good for DB integrity)
  -- Note: The PermissionContext typically bypasses DB checks for this role, but we add them for consistency.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM public.roles r, public.permissions p
  WHERE r.name = 'super_super_admin'
    AND p.name IN ('manage_tenants', 'manage_platform_settings', 'view_system_audit_logs')
  ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
