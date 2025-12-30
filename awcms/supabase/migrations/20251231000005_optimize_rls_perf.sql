-- Migration: Optimize RLS Performance
-- Date: 2025-12-31
-- Description: Updates current_tenant_id() to use fast-path (app setting/JWT) and standardizes RLS policies to use this function.

-- 1. Optimize current_tenant_id() function
-- Strategies: 
-- a) Check 'app.current_tenant_id' setting (Fastest - set by middleware)
-- b) Check JWT 'tenant_id' claim (Fast - set by auth)
-- c) Fallback to 'users' table query (Slow - DB lookup)
-- This reduces overhead for every row evaluation.

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _setting_val TEXT;
BEGIN
    -- Fast Path 1: Middleware/App Setting
    _setting_val := current_setting('app.current_tenant_id', true);
    IF _setting_val IS NOT NULL AND _setting_val <> '' THEN
        RETURN _setting_val::UUID;
    END IF;

    -- Fast Path 2: JWT Claim
    -- Note: auth.jwt() is stable.
    _tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
    IF _tenant_id IS NOT NULL THEN
        RETURN _tenant_id;
    END IF;

    -- Slow Path: Database Lookup
    -- This is cached per transaction if STABLE is respected, but better avoided if possible.
    SELECT tenant_id INTO _tenant_id
    FROM public.users
    WHERE id = auth.uid();
    
    RETURN _tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 2. Standardize RLS Policies to use the optimized function
-- This replaces the verbose COALESCE(...) logic which re-evaluates settings.

-- Templates
DROP POLICY IF EXISTS "Tenant Isolation Select Templates" ON public.templates;
CREATE POLICY "Tenant Isolation Select Templates" ON public.templates
FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

DROP POLICY IF EXISTS "Tenant Isolation All Templates" ON public.templates;
CREATE POLICY "Tenant Isolation All Templates" ON public.templates
FOR ALL USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

-- Template Parts
DROP POLICY IF EXISTS "Tenant Isolation Select Parts" ON public.template_parts;
CREATE POLICY "Tenant Isolation Select Parts" ON public.template_parts
FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

DROP POLICY IF EXISTS "Tenant Isolation All Parts" ON public.template_parts;
CREATE POLICY "Tenant Isolation All Parts" ON public.template_parts
FOR ALL USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

-- Widgets
DROP POLICY IF EXISTS "Tenant Isolation Select Widgets" ON public.widgets;
CREATE POLICY "Tenant Isolation Select Widgets" ON public.widgets
FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

DROP POLICY IF EXISTS "Tenant Isolation All Widgets" ON public.widgets;
CREATE POLICY "Tenant Isolation All Widgets" ON public.widgets
FOR ALL USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

-- Template Assignments
DROP POLICY IF EXISTS "Tenant Isolation Select Assignments" ON public.template_assignments;
CREATE POLICY "Tenant Isolation Select Assignments" ON public.template_assignments
FOR SELECT USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

DROP POLICY IF EXISTS "Tenant Isolation All Assignments" ON public.template_assignments;
CREATE POLICY "Tenant Isolation All Assignments" ON public.template_assignments
FOR ALL USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

-- Articles, Files, Products etc. already use public.current_tenant_id() 
-- so they benefit automatically from the function update.

-- Admin Menus (if needed, verified in step 1417)
