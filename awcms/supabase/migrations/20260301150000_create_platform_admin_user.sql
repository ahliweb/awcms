-- Create platform admin user (cms@ahliweb.com) with full access
-- This creates a platform administrator with full CRUD permissions

-- Create platform admin role if not exists
INSERT INTO roles (id, name, description, is_platform_admin, is_tenant_admin, is_full_access, is_system, scope)
VALUES ('9e13bd1c-f87b-442e-b544-f3f8b3029ee7', 'platform_admin', 'Platform Administrator', true, true, true, true, 'platform')
ON CONFLICT (id) DO UPDATE SET
    is_platform_admin = true,
    is_tenant_admin = true,
    is_full_access = true;

-- Note: The user will be created via Supabase Auth
-- User ID: 5225c497-7f73-42b2-b759-9a2c83c76930

-- Grant all permissions to platform admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT '9e13bd1c-f87b-442e-b544-f3f8b3029ee7', p.id
FROM permissions p
ON CONFLICT DO NOTHING;
