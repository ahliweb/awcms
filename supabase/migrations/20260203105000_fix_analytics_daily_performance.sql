-- Fix Multiple Permissive Policies on analytics_daily
-- Consolidating overlapping policies for SELECT (public read vs admin manage).
-- Optimizing function calls.

-- 1. DROP EXISTING POLICIES
DROP POLICY IF EXISTS "analytics_daily_public_read" ON public.analytics_daily;
DROP POLICY IF EXISTS "analytics_daily_admin_manage" ON public.analytics_daily;

-- 2. CREATE UNIFIED POLICIES

-- SELECT (Available to anon and authenticated)
-- Allows access if it matches current tenant OR if user is platform admin.
CREATE POLICY "Unified read analytics daily"
ON public.analytics_daily
FOR SELECT
TO public
USING (
    tenant_id = (select current_tenant_id()) OR 
    (select is_platform_admin())
);

-- MODIFY (INSERT, UPDATE, DELETE) - Authenticated only (implied by policy definition if we restrict roles, but logic handles it)
-- Actually existing 'admin_manage' was just for authenticated. Here we can set TO authenticated or public with checks.
-- Admin manage logic: (tenant match AND is_admin) OR platform_admin

CREATE POLICY "Unified insert analytics daily"
ON public.analytics_daily
FOR INSERT
TO authenticated
WITH CHECK (
    ((tenant_id = (select current_tenant_id())) AND is_admin_or_above()) OR 
    (select is_platform_admin())
);

CREATE POLICY "Unified update analytics daily"
ON public.analytics_daily
FOR UPDATE
TO authenticated
USING (
    ((tenant_id = (select current_tenant_id())) AND is_admin_or_above()) OR 
    (select is_platform_admin())
)
WITH CHECK (
    ((tenant_id = (select current_tenant_id())) AND is_admin_or_above()) OR 
    (select is_platform_admin())
);

CREATE POLICY "Unified delete analytics daily"
ON public.analytics_daily
FOR DELETE
TO authenticated
USING (
    ((tenant_id = (select current_tenant_id())) AND is_admin_or_above()) OR 
    (select is_platform_admin())
);
