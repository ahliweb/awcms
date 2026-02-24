-- Migration: Add school_pages permissions
-- Created: 2026-01-31
-- Purpose: Add ABAC permissions for SchoolPagesManager component

-- Add permissions for school website page management
INSERT INTO permissions (name, resource, action, description, created_at, updated_at)
VALUES 
  ('tenant.school_pages.read', 'school_pages', 'read', 'View school website content pages', now(), now()),
  ('tenant.school_pages.update', 'school_pages', 'update', 'Edit school website content pages', now(), now())
ON CONFLICT (name) DO NOTHING;

-- Grant these permissions to tenant_admin roles
DO $$
DECLARE
    v_permission_id UUID;
    v_role_id UUID;
BEGIN
    -- Find all tenant_admin roles that exist
    FOR v_role_id IN 
        SELECT id FROM roles WHERE is_tenant_admin = true
    LOOP
        -- Grant read permission
        SELECT id INTO v_permission_id FROM permissions WHERE name = 'tenant.school_pages.read';
        IF v_permission_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END IF;
        
        -- Grant update permission
        SELECT id INTO v_permission_id FROM permissions WHERE name = 'tenant.school_pages.update';
        IF v_permission_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;
