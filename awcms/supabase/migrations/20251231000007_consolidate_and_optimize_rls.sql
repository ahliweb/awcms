-- Migration: Consolidate and Optimize RLS Policies
-- Date: 2025-12-31
-- Description: Drops redundant policies and creates unified, optimized policies to resolve Supabase Advisor 'multiple_permissive_policies' and 'auth_rls_initplan' warnings.

-- 1. Update current_tenant_id to be ultra-safe for linter
-- The usage of (SELECT ...) prevents re-planning in some contexts.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _setting_val TEXT;
BEGIN
    -- Fast Path 1: App Setting (Middleware)
    _setting_val := current_setting('app.current_tenant_id', true);
    IF _setting_val IS NOT NULL AND _setting_val <> '' THEN
        RETURN _setting_val::UUID;
    END IF;

    -- Fast Path 2: JWT Claim (using subquery wrapper for linter satisfaction)
    SELECT (auth.jwt() ->> 'tenant_id')::UUID INTO _tenant_id;
    IF _tenant_id IS NOT NULL THEN
        RETURN _tenant_id;
    END IF;

    -- Slow Path: DB Lookup
    SELECT tenant_id INTO _tenant_id
    FROM public.users
    WHERE id = (SELECT auth.uid()); -- Wrap auth.uid()
    
    RETURN _tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- 2. Helper Macro to Clean Policies
-- We'll just execute drops directly for known problem policies.

-- === TABLE: admin_menus ===
DROP POLICY IF EXISTS "admin_menus_read" ON public.admin_menus;
DROP POLICY IF EXISTS "admin_menus_write" ON public.admin_menus;
DROP POLICY IF EXISTS "Platform admins manage admin_menus" ON public.admin_menus;
DROP POLICY IF EXISTS "Authenticated users view admin_menus" ON public.admin_menus;
DROP POLICY IF EXISTS "Admins manage admin_menus" ON public.admin_menus;

CREATE POLICY "admin_menus_select_unified" ON public.admin_menus FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_menus_modify_unified" ON public.admin_menus FOR ALL TO authenticated USING (public.is_platform_admin());

-- === TABLE: articles ===
DROP POLICY IF EXISTS "articles_select_policy" ON public.articles;
DROP POLICY IF EXISTS "articles_update_policy" ON public.articles;
DROP POLICY IF EXISTS "articles_delete_policy" ON public.articles;
DROP POLICY IF EXISTS "articles_insert_policy" ON public.articles;
DROP POLICY IF EXISTS "Tenant Read Access" ON public.articles;
DROP POLICY IF EXISTS "Tenant Write Access" ON public.articles;

CREATE POLICY "articles_select_unified" ON public.articles FOR SELECT USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);
CREATE POLICY "articles_modify_unified" ON public.articles FOR ALL USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);

-- === TABLE: files ===
DROP POLICY IF EXISTS "files_update_owner" ON public.files;
DROP POLICY IF EXISTS "files_isolation_policy" ON public.files;
DROP POLICY IF EXISTS "files_modify_policy" ON public.files;
DROP POLICY IF EXISTS "files_select_policy" ON public.files;

CREATE POLICY "files_select_unified" ON public.files FOR SELECT USING (
    (tenant_id = public.current_tenant_id() AND deleted_at IS NULL) OR public.is_platform_admin()
);
CREATE POLICY "files_modify_unified" ON public.files FOR ALL USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);

-- === TABLE: pages ===
DROP POLICY IF EXISTS "pages_delete_policy" ON public.pages;
DROP POLICY IF EXISTS "pages_update_policy" ON public.pages;
DROP POLICY IF EXISTS "pages_modify_policy" ON public.pages;
DROP POLICY IF EXISTS "pages_select_policy" ON public.pages;

CREATE POLICY "pages_select_unified" ON public.pages FOR SELECT USING (
    (tenant_id = public.current_tenant_id() AND deleted_at IS NULL) OR public.is_platform_admin()
);
CREATE POLICY "pages_modify_unified" ON public.pages FOR ALL USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);

-- === TABLE: products ===
DROP POLICY IF EXISTS "products_delete_policy" ON public.products;
DROP POLICY IF EXISTS "products_update_policy" ON public.products;
DROP POLICY IF EXISTS "products_modify_perf" ON public.products;
DROP POLICY IF EXISTS "products_select_perf" ON public.products;

CREATE POLICY "products_select_unified" ON public.products FOR SELECT USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);
CREATE POLICY "products_modify_unified" ON public.products FOR ALL USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);

-- === TABLE: audit_logs ===
DROP POLICY IF EXISTS "audit_view_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_insert_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_read_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Tenant Audit Insert" ON public.audit_logs;

CREATE POLICY "audit_logs_select_unified" ON public.audit_logs FOR SELECT USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR (tenant_id IS NULL AND public.is_platform_admin())
    OR public.is_platform_admin()
);
-- Audit logs usually shouldn't be manually inserted by users, only triggers. 
-- But keeping an insert policy for now if the app inserts directly.
CREATE POLICY "audit_logs_insert_unified" ON public.audit_logs FOR INSERT WITH CHECK (
    tenant_id = public.current_tenant_id()
);

-- === TABLE: policies ===
DROP POLICY IF EXISTS "policies_all_policy" ON public.policies;
DROP POLICY IF EXISTS "policies_read_policy" ON public.policies;

CREATE POLICY "policies_select_unified" ON public.policies FOR SELECT USING (
    tenant_id = public.current_tenant_id() OR tenant_id IS NULL OR public.is_platform_admin()
);
CREATE POLICY "policies_modify_unified" ON public.policies FOR ALL USING (
    public.is_platform_admin()
);

-- === TABLE: role_policies ===
DROP POLICY IF EXISTS "Admins can manage role_policies" ON public.role_policies;
DROP POLICY IF EXISTS "Authenticated can read role_policies" ON public.role_policies;

CREATE POLICY "role_policies_select_unified" ON public.role_policies FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_policies_modify_unified" ON public.role_policies FOR ALL USING (public.is_platform_admin());

-- === TABLE: template_strings ===
DROP POLICY IF EXISTS "Admins can insert" ON public.template_strings;
DROP POLICY IF EXISTS "Admins can update" ON public.template_strings;
DROP POLICY IF EXISTS "Admins can delete" ON public.template_strings;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.template_strings;
DROP POLICY IF EXISTS "Enable read access for tenant" ON public.template_strings;
DROP POLICY IF EXISTS "Public read access" ON public.template_strings;

CREATE POLICY "template_strings_select_unified" ON public.template_strings FOR SELECT USING (true); -- Public read usually
CREATE POLICY "template_strings_modify_unified" ON public.template_strings FOR ALL USING (public.is_platform_admin());

-- === GENERIC LOOP FOR STANDARD MODULES ===
-- announcements, categories, contact_messages, extension_routes, extensions, menus, 
-- portfolio, promotions, settings, tags, testimonies, themes, video_gallery
-- notifications, backups, cart_items, contacts
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'announcements', 'categories', 'contact_messages', 'extension_routes', 
        'extensions', 'menus', 'portfolio', 'promotions', 'settings', 'tags', 
        'testimonies', 'themes', 'video_gallery', 'notifications', 
        'backups', 'cart_items', 'contacts'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            -- DROP ALL known potential policies
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Read Access" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Write Access" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Update Access" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Insert Access" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Delete Access" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Select" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Insert" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Update" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Delete" ON public.%I;', t);
            
            -- Specific messy ones from logs
            EXECUTE format('DROP POLICY IF EXISTS "%I_delete_auth" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_insert_auth" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_write_policy" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_read_policy" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_select_policy" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_insert_policy" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_update_policy" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_delete_policy" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_access_policy" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_delete_admin" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_insert_public" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_select_admin" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_update_admin" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "%I_policy" ON public.%I;', t, t);
            EXECUTE format('DROP POLICY IF EXISTS "Settings Delete" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Settings Insert" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Settings Select" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Settings Update" ON public.%I;', t);
            EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Select Notifications" ON public.%I;', t);


            -- CREATE UNIFIED POLICIES
            -- 1. READ
            IF t = 'themes' OR t = 'settings' OR t = 'extensions' THEN
                 EXECUTE format('CREATE POLICY "%I_select_unified" ON public.%I FOR SELECT USING ( tenant_id = public.current_tenant_id() OR tenant_id IS NULL OR public.is_platform_admin() );', t, t);
            ELSE
                 EXECUTE format('CREATE POLICY "%I_select_unified" ON public.%I FOR SELECT USING ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t, t);
            END IF;

            -- 2. WRITE
            IF t = 'contact_messages' THEN
                -- Public insert, admin read
                EXECUTE format('CREATE POLICY "%I_insert_public" ON public.%I FOR INSERT WITH CHECK (true);', t, t);
                EXECUTE format('CREATE POLICY "%I_modify_admin" ON public.%I FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());', t, t);
                EXECUTE format('CREATE POLICY "%I_delete_admin" ON public.%I FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());', t, t);
            ELSE
                EXECUTE format('CREATE POLICY "%I_modify_unified" ON public.%I FOR ALL USING ( (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() );', t, t);
            END IF;
            
        END IF;
    END LOOP;
END $$;

-- === TEMPLATES & WIDGETS ===
-- template_assignments, template_parts, templates, widgets
-- Already have "Tenant Isolation Select..." and "Tenant Isolation All..."
-- They are duplicated by my previous migration potentially? 
-- Migration 20251231000005 created "Tenant Isolation Select Templates" etc.
-- Migration 20251230000001 created the same names. 
-- The warning "multiple permissive policies" suggests older policies might still be there OR I created duplicates with slightly different names (unlikely if names match)
-- OR the system thinks "Tenant Isolation Select" and "Tenant Isolation All" (which covers select) trigger the warning.
-- "Tenant Isolation All" covers SELECT, INSERT, UPDATE, DELETE.
-- "Tenant Isolation Select" covers SELECT.
-- So for SELECT, both apply -> Multiple Permissive Policies.
-- FIX: "Tenant Isolation All" should be for INSERT/UPDATE/DELETE only, OR remove "Select" policy and rely on "All" if logic is identical.
-- Logic Check: 
-- Perf: SELECT logic is tenant_id = ...
-- All: tenant_id = ...
-- They are identical. I should Drop "Tenant Isolation Select..." and just use "Tenant Isolation All...".
-- OR make "All" apply to INSERT, UPDATE, DELETE only.

DO $$
DECLARE
    t text;
    tables text[] := ARRAY['templates', 'template_parts', 'widgets', 'template_assignments'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        -- Drop duplicates
        EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Select %s" ON public.%I;', CASE 
            WHEN t='templates' THEN 'Templates' 
            WHEN t='template_parts' THEN 'Parts'
            WHEN t='widgets' THEN 'Widgets'
            WHEN t='template_assignments' THEN 'Assignments'
        END, t);
        
        EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation All %s" ON public.%I;', CASE 
            WHEN t='templates' THEN 'Templates' 
            WHEN t='template_parts' THEN 'Parts'
            WHEN t='widgets' THEN 'Widgets'
            WHEN t='template_assignments' THEN 'Assignments'
        END, t);

        -- Create unified 
        EXECUTE format('CREATE POLICY "%I_select_unified" ON public.%I FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());', t, t);
        EXECUTE format('CREATE POLICY "%I_modify_unified" ON public.%I FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_platform_admin());', t, t);
        EXECUTE format('CREATE POLICY "%I_update_unified" ON public.%I FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());', t, t);
        EXECUTE format('CREATE POLICY "%I_delete_unified" ON public.%I FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());', t, t);
    END LOOP;
END $$;

-- === account_requests ===
DROP POLICY IF EXISTS "Platform Admins manage all requests" ON public.account_requests;
DROP POLICY IF EXISTS "Tenant Admins manage own requests" ON public.account_requests;
DROP POLICY IF EXISTS "account_requests_access_policy" ON public.account_requests;

CREATE POLICY "account_requests_select_unified" ON public.account_requests FOR SELECT USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);
CREATE POLICY "account_requests_modify_unified" ON public.account_requests FOR ALL USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);
