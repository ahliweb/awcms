-- Fix Auth RLS Initialization Plan warnings and consolidate policies

-- 1. Fix ui_configs Unified read policy (wrap auth calls)
DROP POLICY IF EXISTS "Unified read schemas" ON public.ui_configs;

CREATE POLICY "Unified read schemas"
ON public.ui_configs
FOR SELECT
TO public
USING (
    (select is_platform_admin()) OR 
    tenant_id IS NULL OR 
    tenant_id = (SELECT users.tenant_id FROM users WHERE users.id = (select auth.uid()))
);


-- 2. Consolidate policies on resources_registry
DROP POLICY IF EXISTS "Platform admins manage resources" ON public.resources_registry;
DROP POLICY IF EXISTS "Everyone read active resources" ON public.resources_registry;

CREATE POLICY "Platform admins insert resources"
ON public.resources_registry
FOR INSERT
TO public
WITH CHECK ((select is_platform_admin()));

CREATE POLICY "Platform admins update resources"
ON public.resources_registry
FOR UPDATE
TO public
USING ((select is_platform_admin()))
WITH CHECK ((select is_platform_admin()));

CREATE POLICY "Platform admins delete resources"
ON public.resources_registry
FOR DELETE
TO public
USING ((select is_platform_admin()));

CREATE POLICY "Unified read resources"
ON public.resources_registry
FOR SELECT
TO public
USING (
    (select is_platform_admin()) OR 
    active = true
);


-- 3. Consolidate policies on component_registry
DROP POLICY IF EXISTS "Platform admins manage editor configs" ON public.component_registry;
DROP POLICY IF EXISTS "Tenants read editor configs" ON public.component_registry;

CREATE POLICY "Platform admins insert editor configs"
ON public.component_registry
FOR INSERT
TO public
WITH CHECK ((select is_platform_admin()));

CREATE POLICY "Platform admins update editor configs"
ON public.component_registry
FOR UPDATE
TO public
USING ((select is_platform_admin()))
WITH CHECK ((select is_platform_admin()));

CREATE POLICY "Platform admins delete editor configs"
ON public.component_registry
FOR DELETE
TO public
USING ((select is_platform_admin()));

CREATE POLICY "Unified read editor configs"
ON public.component_registry
FOR SELECT
TO public
USING (
    (select is_platform_admin()) OR 
    tenant_id IS NULL OR 
    tenant_id = (SELECT users.tenant_id FROM users WHERE users.id = (select auth.uid()))
);
