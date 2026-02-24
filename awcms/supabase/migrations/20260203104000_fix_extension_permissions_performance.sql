-- Fix Multiple Permissive Policies on extension_permissions
-- Consolidating overlapping policies for SELECT, INSERT, UPDATE, DELETE.
-- Combining "admin" permission checks with "hierarchy" checks.
-- wrapping function calls like is_platform_admin() in (select ...) for performance.

-- 1. DROP EXISTING POLICIES
DROP POLICY IF EXISTS "extension_permissions_select" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_select_hierarchy" ON public.extension_permissions;

DROP POLICY IF EXISTS "extension_permissions_insert_admin" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_insert_hierarchy" ON public.extension_permissions;

DROP POLICY IF EXISTS "extension_permissions_update_admin" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_update_hierarchy" ON public.extension_permissions;

DROP POLICY IF EXISTS "extension_permissions_delete_admin" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_delete_hierarchy" ON public.extension_permissions;

-- 2. CREATE UNIFIED POLICIES

-- SELECT
CREATE POLICY "Unified select extension permissions"
ON public.extension_permissions
FOR SELECT
TO public
USING (
    (select is_platform_admin()) OR 
    tenant_id = (select current_tenant_id()) OR 
    tenant_can_access_resource(tenant_id, 'extensions', 'read') OR
    (select has_permission('platform.extensions.read'))
);

-- INSERT
CREATE POLICY "Unified insert extension permissions"
ON public.extension_permissions
FOR INSERT
TO public
WITH CHECK (
    (select is_platform_admin()) OR
    (tenant_id = (select current_tenant_id()) OR tenant_can_access_resource(tenant_id, 'extensions', 'write')) OR
    (select has_permission('platform.extensions.create'))
);

-- UPDATE
CREATE POLICY "Unified update extension permissions"
ON public.extension_permissions
FOR UPDATE
TO public
USING (
    (select is_platform_admin()) OR
    (tenant_id = (select current_tenant_id()) OR tenant_can_access_resource(tenant_id, 'extensions', 'write')) OR
    (select has_permission('platform.extensions.update'))
)
WITH CHECK (
    (select is_platform_admin()) OR
    (tenant_id = (select current_tenant_id()) OR tenant_can_access_resource(tenant_id, 'extensions', 'write')) OR
    (select has_permission('platform.extensions.update'))
);

-- DELETE
CREATE POLICY "Unified delete extension permissions"
ON public.extension_permissions
FOR DELETE
TO public
USING (
    (select is_platform_admin()) OR
    (tenant_id = (select current_tenant_id()) OR tenant_can_access_resource(tenant_id, 'extensions', 'write')) OR
    (select has_permission('platform.extensions.delete'))
);
