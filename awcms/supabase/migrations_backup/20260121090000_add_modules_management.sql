-- Create modules table
CREATE TABLE IF NOT EXISTS public.modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

-- Enable RLS
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Combined policy for reading modules
DROP POLICY IF EXISTS "modules_read_policy" ON public.modules;
CREATE POLICY "modules_read_policy" ON public.modules
    FOR SELECT
    TO public
    USING (
        -- Platform Admins (Owner, Super Admin) can see all
        public.is_platform_admin()
        OR
        -- Tenant Admins can see their own tenant's modules
        (
            tenant_id = public.get_current_tenant_id()
            AND
            public.is_admin_or_above()
        )
    );

-- Permissions and Roles Setup
DO $$
DECLARE
    v_perm_id uuid;
    v_owner_role_id uuid;
    v_super_admin_role_id uuid;
    v_admin_role_id uuid;
BEGIN
    -- 1. Insert Permission (using 'name' as the code)
    -- Check if it exists first to get ID, or insert
    SELECT id INTO v_perm_id FROM public.permissions WHERE name = 'tenant.modules.read';
    
    IF v_perm_id IS NULL THEN
        INSERT INTO public.permissions (name, description, resource, action, module)
        VALUES ('tenant.modules.read', 'Can view modules list', 'modules', 'read', 'top_level') -- 'top_level' or 'system'
        RETURNING id INTO v_perm_id;
    END IF;

    -- 2. Get Role IDs
    SELECT id INTO v_owner_role_id FROM public.roles WHERE name = 'owner' LIMIT 1;
    SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin' LIMIT 1;
    SELECT id INTO v_admin_role_id FROM public.roles WHERE name = 'admin' LIMIT 1;

    -- 3. Assign Permission to Roles
    IF v_perm_id IS NOT NULL THEN
        -- Owner
        IF v_owner_role_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = v_owner_role_id AND permission_id = v_perm_id) THEN
                INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_owner_role_id, v_perm_id);
            END IF;
        END IF;

        -- Super Admin
        IF v_super_admin_role_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = v_super_admin_role_id AND permission_id = v_perm_id) THEN
                INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_super_admin_role_id, v_perm_id);
            END IF;
        END IF;

        -- Admin
        IF v_admin_role_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = v_admin_role_id AND permission_id = v_perm_id) THEN
                INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_admin_role_id, v_perm_id);
            END IF;
        END IF;
    END IF;
END $$;

-- Add Menu Item
INSERT INTO public.admin_menus (
    key, 
    label, 
    path, 
    icon, 
    permission, 
    group_label, 
    "order", 
    group_order,
    is_visible
) VALUES (
    'modules_management',
    'Module Management',
    'modules',
    'Box',
    'tenant.modules.read',
    'SYSTEM',
    35, -- Order between Extensions (30) and Sidebar Manager (40)
    60, -- SYSTEM group order
    true
) ON CONFLICT (key) DO NOTHING;
