-- Migration: Enforce tenant.user.update permission for User Updates
-- Objective: Ensure that updating users (including region assignment) requires strict ABAC permission 'tenant.user.update'.

SET client_min_messages TO warning;

-- 1. Update RLS Policy for Users Update
-- Current policy relies on 'tenant_can_access_resource' which is for cross-tenant sharing.
-- We need to add an OR condition for local tenant admin with specific permission.

DROP POLICY IF EXISTS users_update_hierarchy ON public.users;

CREATE POLICY users_update_hierarchy
  ON public.users
  FOR UPDATE
  USING (
    -- 1. Platform Admin always has access
    public.is_platform_admin()
    OR 
    (
        -- 2. Same Tenant
        tenant_id = public.current_tenant_id()
        AND (
            -- Self update (optional, usually handled by separate policy, but good to keep safe)
            id = auth.uid()
            OR
            -- Tenant Admin with explicit permission
            EXISTS (
                SELECT 1 FROM public.role_permissions rp
                JOIN public.permissions p ON p.id = rp.permission_id
                JOIN public.users u ON u.role_id = rp.role_id
                WHERE u.id = auth.uid()
                AND u.tenant_id = public.current_tenant_id()
                AND p.name = 'tenant.user.update'
            )
        )
    )
    OR
    -- 3. Cross-Tenant (Hierarchical) Access
    public.tenant_can_access_resource(tenant_id, 'users', 'write')
  )
  WITH CHECK (
    -- Same conditions as USING
    public.is_platform_admin()
    OR 
    (
        tenant_id = public.current_tenant_id()
        AND (
            id = auth.uid()
            OR
            EXISTS (
                SELECT 1 FROM public.role_permissions rp
                JOIN public.permissions p ON p.id = rp.permission_id
                JOIN public.users u ON u.role_id = rp.role_id
                WHERE u.id = auth.uid()
                AND u.tenant_id = public.current_tenant_id()
                AND p.name = 'tenant.user.update'
            )
        )
    )
    OR
    public.tenant_can_access_resource(tenant_id, 'users', 'write')
  );

-- 2. Ensure permission exists (idempotent)
INSERT INTO public.permissions (name, description, resource, action, created_at, updated_at)
VALUES 
  ('tenant.user.update', 'Can update tenant users', 'tenant.users', 'update', now(), now())
ON CONFLICT (name) DO NOTHING;

-- 3. Assign permission to Admin role (if not already)
DO $$
DECLARE
    v_perm_id uuid;
BEGIN
    SELECT id INTO v_perm_id FROM public.permissions WHERE name = 'tenant.user.update';
    
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT id, v_perm_id
    FROM public.roles
    WHERE name = 'admin' AND scope = 'tenant'
    ON CONFLICT DO NOTHING;
END $$;
