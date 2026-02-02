-- Fix Multiple Permissive Policies on extension_rbac_integration
-- Consolidating overlapping policies for SELECT, INSERT, UPDATE, DELETE.
-- Combining "standard" permission checks with "hierarchy" checks.
-- wrapping function calls like is_platform_admin() in (select ...) for performance.

-- 1. DROP EXISTING POLICIES
DROP POLICY IF EXISTS "extension_rbac_select" ON public.extension_rbac_integration;
DROP POLICY IF EXISTS "extension_rbac_select_hierarchy" ON public.extension_rbac_integration;

DROP POLICY IF EXISTS "extension_rbac_insert" ON public.extension_rbac_integration;
DROP POLICY IF EXISTS "extension_rbac_insert_hierarchy" ON public.extension_rbac_integration;

DROP POLICY IF EXISTS "extension_rbac_update" ON public.extension_rbac_integration;
DROP POLICY IF EXISTS "extension_rbac_update_hierarchy" ON public.extension_rbac_integration;

DROP POLICY IF EXISTS "extension_rbac_delete" ON public.extension_rbac_integration;
DROP POLICY IF EXISTS "extension_rbac_delete_hierarchy" ON public.extension_rbac_integration;

-- 2. CREATE UNIFIED POLICIES

-- SELECT
CREATE POLICY "Unified select extension rbac"
ON public.extension_rbac_integration
FOR SELECT
TO public
USING (
    (select is_platform_admin()) OR 
    tenant_id = (select current_tenant_id()) OR 
    tenant_can_access_resource(tenant_id, 'extensions', 'read') OR
    (select has_permission('platform.extensions.read'))
);

-- INSERT
CREATE POLICY "Unified insert extension rbac"
ON public.extension_rbac_integration
FOR INSERT
TO public
WITH CHECK (
    (select is_platform_admin()) OR
    -- Hierarchy check
    (tenant_id = (select current_tenant_id()) OR tenant_can_access_resource(tenant_id, 'extensions', 'write')) OR
    -- Permission check
    (select has_permission('platform.extensions.create')) OR
    -- Admin role check (inherited from previous logic)
    (EXISTS (
        SELECT 1 FROM roles r 
        WHERE r.id = extension_rbac_integration.role_id 
        AND r.tenant_id = (select current_tenant_id()) 
        AND is_admin_or_above()
    ))
);

-- UPDATE
CREATE POLICY "Unified update extension rbac"
ON public.extension_rbac_integration
FOR UPDATE
TO public
USING (
    (select is_platform_admin()) OR
    (tenant_id = (select current_tenant_id()) OR tenant_can_access_resource(tenant_id, 'extensions', 'write')) OR
    (select has_permission('platform.extensions.update')) OR
    (EXISTS (
        SELECT 1 FROM roles r 
        WHERE r.id = extension_rbac_integration.role_id 
        AND r.tenant_id = (select current_tenant_id()) 
        AND is_admin_or_above()
    ))
)
WITH CHECK (
    (select is_platform_admin()) OR
    (tenant_id = (select current_tenant_id()) OR tenant_can_access_resource(tenant_id, 'extensions', 'write')) OR
    (select has_permission('platform.extensions.update')) OR
    (EXISTS (
        SELECT 1 FROM roles r 
        WHERE r.id = extension_rbac_integration.role_id 
        AND r.tenant_id = (select current_tenant_id()) 
        AND is_admin_or_above()
    ))
);

-- DELETE
CREATE POLICY "Unified delete extension rbac"
ON public.extension_rbac_integration
FOR DELETE
TO public
USING (
    (select is_platform_admin()) OR
    (tenant_id = (select current_tenant_id()) OR tenant_can_access_resource(tenant_id, 'extensions', 'write')) OR
    (select has_permission('platform.extensions.delete')) OR
    (EXISTS (
        SELECT 1 FROM roles r 
        WHERE r.id = extension_rbac_integration.role_id 
        AND r.tenant_id = (select current_tenant_id()) 
        AND is_admin_or_above()
    ))
);
