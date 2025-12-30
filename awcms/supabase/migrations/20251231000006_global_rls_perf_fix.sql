-- Migration: Global RLS Performance Fix & Security Hardening
-- Date: 2025-12-31
-- Description: Fixes search_path for current_tenant_id and updates all remaining RLS policies to use optimized function.

-- 1. Security: Fix search_path for current_tenant_id
-- Was missing in the previous replace, causing "Function Search Path Mutable" warning.
ALTER FUNCTION public.current_tenant_id() SET search_path = public;

-- 2. Performance: Update RLS Policies for Core Content Tables
-- Replacing heavy initialization plans with the optimized STABLE function.

-- Articles
DROP POLICY IF EXISTS "Tenant Read Access" ON public.articles;
CREATE POLICY "Tenant Read Access" ON public.articles FOR SELECT USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);

DROP POLICY IF EXISTS "Tenant Write Access" ON public.articles;
CREATE POLICY "Tenant Write Access" ON public.articles FOR ALL USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);

-- Pages
DROP POLICY IF EXISTS "pages_select_policy" ON public.pages;
CREATE POLICY "pages_select_policy" ON public.pages FOR SELECT USING (
    (tenant_id = public.current_tenant_id() AND deleted_at IS NULL)
    OR public.is_platform_admin()
);

DROP POLICY IF EXISTS "pages_modify_policy" ON public.pages;
CREATE POLICY "pages_modify_policy" ON public.pages FOR ALL USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

-- Files
DROP POLICY IF EXISTS "files_select_policy" ON public.files;
CREATE POLICY "files_select_policy" ON public.files FOR SELECT USING (
    (tenant_id = public.current_tenant_id() AND deleted_at IS NULL)
    OR public.is_platform_admin()
);

DROP POLICY IF EXISTS "files_modify_policy" ON public.files;
CREATE POLICY "files_modify_policy" ON public.files FOR ALL USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
);

-- Products
DROP POLICY IF EXISTS "Tenant Read Access" ON public.products; -- Try dropping generic name if exists
DROP POLICY IF EXISTS "products_select_policy" ON public.products; -- Or specific name
-- Note: Products usually created in 20251218000001 with inline logic. We'll standardise.
CREATE POLICY "products_select_perf" ON public.products FOR SELECT USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);
CREATE POLICY "products_modify_perf" ON public.products FOR ALL USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);
-- Clean up old potentially conflicting policies if possible (names guessed from standard patterns)
DROP POLICY IF EXISTS "Tenant Write Access" ON public.products;

-- Admin Menus
DROP POLICY IF EXISTS "Authenticated users view admin_menus" ON public.admin_menus;
CREATE POLICY "Authenticated users view admin_menus" ON public.admin_menus FOR SELECT TO authenticated USING (true); -- This is already optimal (true), keep it.

DROP POLICY IF EXISTS "Platform admins manage admin_menus" ON public.admin_menus;
CREATE POLICY "Platform admins manage admin_menus" ON public.admin_menus FOR ALL USING (
    public.is_platform_admin()
);

-- Notifications
DROP POLICY IF EXISTS "Tenant Isolation Select Notifications" ON public.notifications;
CREATE POLICY "Tenant Isolation Select Notifications" ON public.notifications FOR SELECT USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);

-- Audit Logs
DROP POLICY IF EXISTS "Admins view audit logs" ON public.audit_logs;
CREATE POLICY "Admins view audit logs" ON public.audit_logs FOR SELECT USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR (tenant_id IS NULL AND public.is_platform_admin())
    OR public.is_platform_admin()
);

-- 3. Update Global Modules (Categories, Tags, etc.)
-- Improving loop from 20251218000008
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'categories', 'tags', 'menus', 
        'announcements', 'promotions', 'testimonies', 'portfolio', 
        'contact_messages', 'product_types', 'themes', 'extensions'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Read Access" ON public.%I;', t);
            
            IF t = 'themes' THEN
                 EXECUTE format('CREATE POLICY "Tenant Read Access" ON public.%I FOR SELECT USING ( tenant_id = public.current_tenant_id() OR tenant_id IS NULL OR public.is_platform_admin() );', t);
            ELSE
                EXECUTE format('CREATE POLICY "Tenant Read Access" ON public.%I FOR SELECT USING ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t);
            END IF;

            EXECUTE format('DROP POLICY IF EXISTS "Tenant Write Access" ON public.%I;', t);
            EXECUTE format('CREATE POLICY "Tenant Write Access" ON public.%I FOR ALL USING ( (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() );', t);
        END IF;
    END LOOP;
END $$;
