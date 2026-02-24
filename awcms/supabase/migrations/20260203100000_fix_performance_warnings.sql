-- Fix unindexed foreign keys to improve performance
CREATE INDEX IF NOT EXISTS idx_ui_configs_tenant_id ON public.ui_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_component_registry_resource_key ON public.component_registry(resource_key);
CREATE INDEX IF NOT EXISTS idx_component_registry_tenant_id ON public.component_registry(tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON public.analytics_events(user_id);

-- Consolidate policies on ui_configs to reduce policy evaluation overhead
-- Previous state: overlapping policies for SELECT (Platform Admin + Tenant)

DROP POLICY IF EXISTS "Platform admins manage schemas" ON public.ui_configs;
DROP POLICY IF EXISTS "Tenants read schemas" ON public.ui_configs;

-- 1. Write policies (Platform Admin only)
-- We split these to avoid "ALL" which includes SELECT, or we could use ALL and rely on the new SELECT policy handling the read case?
-- No, if we use ALL, we can't exclude SELECT easily.
-- So explicit CRUD policies for writes.

CREATE POLICY "Platform admins insert schemas"
ON public.ui_configs
FOR INSERT
TO public
WITH CHECK (is_platform_admin());

CREATE POLICY "Platform admins update schemas"
ON public.ui_configs
FOR UPDATE
TO public
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

CREATE POLICY "Platform admins delete schemas"
ON public.ui_configs
FOR DELETE
TO public
USING (is_platform_admin());

-- 2. Unified read policy associated with roles
CREATE POLICY "Unified read schemas"
ON public.ui_configs
FOR SELECT
TO public
USING (
    is_platform_admin() OR 
    tenant_id IS NULL OR 
    tenant_id = (SELECT users.tenant_id FROM users WHERE users.id = auth.uid())
);
