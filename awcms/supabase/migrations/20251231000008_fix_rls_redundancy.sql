-- Migration: Fix RLS Redundancy and Missed Tables (Corrected)
-- Date: 2025-12-31
-- Description: Splits 'FOR ALL' policies into separate actions to resolve 'multiple_permissive_policies'. Fixes sso_role_mappings logic.

-- 1. MACRO: Split Modify Policies for Standard Tables
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'admin_menus', 'articles', 'files', 'pages', 'products', 
        'audit_logs', 'policies', 'role_policies', 'template_strings', 'account_requests',
        'announcements', 'categories', 'contact_messages', 'extension_routes', 
        'extensions', 'menus', 'portfolio', 'promotions', 'settings', 'tags', 
        'testimonies', 'themes', 'video_gallery', 'notifications', 
        'backups', 'cart_items', 'contacts'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            
            -- Drop Duplicate/Redundant Policies
            EXECUTE format('DROP POLICY IF EXISTS "%I_modify_unified" ON public.%I;', t, t);
            
            -- Re-create as specific policies
            IF t = 'admin_menus' OR t = 'role_policies' OR t = 'template_strings' THEN
                 EXECUTE format('CREATE POLICY "%I_insert_unified" ON public.%I FOR INSERT WITH CHECK (public.is_platform_admin());', t, t);
                 EXECUTE format('CREATE POLICY "%I_update_unified" ON public.%I FOR UPDATE USING (public.is_platform_admin());', t, t);
                 EXECUTE format('CREATE POLICY "%I_delete_unified" ON public.%I FOR DELETE USING (public.is_platform_admin());', t, t);

            ELSIF t = 'policies' THEN
                 EXECUTE format('CREATE POLICY "%I_insert_unified" ON public.%I FOR INSERT WITH CHECK (public.is_platform_admin());', t, t);
                 EXECUTE format('CREATE POLICY "%I_update_unified" ON public.%I FOR UPDATE USING (public.is_platform_admin());', t, t);
                 EXECUTE format('CREATE POLICY "%I_delete_unified" ON public.%I FOR DELETE USING (public.is_platform_admin());', t, t);

            ELSIF t = 'contact_messages' THEN
                 NULL; -- Already specific in 07

            ELSIF t = 'audit_logs' THEN
                 NULL; -- Already specific in 07

            ELSE
                 -- Standard Tenant Isolation + Admin
                 -- Logic: ((tenant_id = current AND is_admin_or_above) OR platform)
                 -- Applies to: articles, files, pages, products, account_requests, generic list.
                 IF t = 'articles' OR t = 'products' THEN
                    EXECUTE format('CREATE POLICY "%I_insert_unified" ON public.%I FOR INSERT WITH CHECK ( (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() );', t, t);
                    EXECUTE format('CREATE POLICY "%I_update_unified" ON public.%I FOR UPDATE USING ( (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() );', t, t);
                    EXECUTE format('CREATE POLICY "%I_delete_unified" ON public.%I FOR DELETE USING ( (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() );', t, t);
                 
                 ELSIF t = 'files' OR t = 'pages' OR t = 'account_requests' THEN
                    -- Simple Tenant Check (Editor access implicitly allowed via lack of is_admin check? No, these policies are usually for "Modify". 
                    -- In 07 'pages' modify was: tenant_id = ... OR platform. (No admin check).
                    -- So we keep that permissive logic for pages/files (Editors need to upload/edit).
                    EXECUTE format('CREATE POLICY "%I_insert_unified" ON public.%I FOR INSERT WITH CHECK ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t, t);
                    EXECUTE format('CREATE POLICY "%I_update_unified" ON public.%I FOR UPDATE USING ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t, t);
                    EXECUTE format('CREATE POLICY "%I_delete_unified" ON public.%I FOR DELETE USING ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t, t);

                 ELSE
                    -- Generic tables defaults to Stricter (Admin only) to be safe, 
                    -- UNLESS they are content like 'testimonies', 'portfolio'.
                    -- 07 provided generic modify: ((tenant AND admin) OR platform).
                    EXECUTE format('CREATE POLICY "%I_insert_unified" ON public.%I FOR INSERT WITH CHECK ( (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() );', t, t);
                    EXECUTE format('CREATE POLICY "%I_update_unified" ON public.%I FOR UPDATE USING ( (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() );', t, t);
                    EXECUTE format('CREATE POLICY "%I_delete_unified" ON public.%I FOR DELETE USING ( (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() );', t, t);
                 END IF;

            END IF;
        END IF;
    END LOOP;
END $$;


-- 2. CLEANUP MISSED TABLES (photo_gallery, product_types, order_items)
DO $$
DECLARE
    t text;
    tables text[] := ARRAY['photo_gallery', 'product_types', 'order_items'];
    has_tenant_col boolean;
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            
            -- Check for tenant_id column
            SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'tenant_id') INTO has_tenant_col;
            
            IF has_tenant_col THEN
                -- Drop Old
                EXECUTE format('DROP POLICY IF EXISTS "Tenant Read Access" ON public.%I;', t);
                EXECUTE format('DROP POLICY IF EXISTS "Tenant Write Access" ON public.%I;', t);
                EXECUTE format('DROP POLICY IF EXISTS "Tenant Update Access" ON public.%I;', t);
                EXECUTE format('DROP POLICY IF EXISTS "Tenant Insert Access" ON public.%I;', t);
                EXECUTE format('DROP POLICY IF EXISTS "Tenant Delete Access" ON public.%I;', t);
                EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Select" ON public.%I;', t);
                EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Insert" ON public.%I;', t);
                EXECUTE format('DROP POLICY IF EXISTS "%I_access_policy" ON public.%I;', t, t); -- order_items_access_policy
                
                -- Create Unified (Split)
                EXECUTE format('CREATE POLICY "%I_select_unified" ON public.%I FOR SELECT USING ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t, t);
                EXECUTE format('CREATE POLICY "%I_insert_unified" ON public.%I FOR INSERT WITH CHECK ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t, t);
                EXECUTE format('CREATE POLICY "%I_update_unified" ON public.%I FOR UPDATE USING ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t, t);
                EXECUTE format('CREATE POLICY "%I_delete_unified" ON public.%I FOR DELETE USING ( tenant_id = public.current_tenant_id() OR public.is_platform_admin() );', t, t);
            END IF;
        END IF;
    END LOOP;
END $$;

-- 3. COMPLEX TABLES: Roles, Users, Tenants, SSO Maps

-- === USERS ===
DROP POLICY IF EXISTS "Tenant Read Access" ON public.users;
DROP POLICY IF EXISTS "Tenant Insert Access" ON public.users;
DROP POLICY IF EXISTS "Tenant Update Access" ON public.users;
DROP POLICY IF EXISTS "admins_view_pending_users" ON public.users;
DROP POLICY IF EXISTS "admins_approve_users" ON public.users;
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
DROP POLICY IF EXISTS "users_insert_policy" ON public.users;

CREATE POLICY "users_select_unified" ON public.users FOR SELECT USING (
    id = auth.uid() 
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);
CREATE POLICY "users_insert_unified" ON public.users FOR INSERT WITH CHECK (
    public.is_admin_or_above() OR public.is_platform_admin()
);
CREATE POLICY "users_update_unified" ON public.users FOR UPDATE USING (
    public.is_admin_or_above() OR public.is_platform_admin()
);
CREATE POLICY "users_delete_unified" ON public.users FOR DELETE USING (
    public.is_admin_or_above() OR public.is_platform_admin()
);


-- === ROLES ===
DROP POLICY IF EXISTS "Tenant Read Access" ON public.roles;
DROP POLICY IF EXISTS "roles_select_policy" ON public.roles;

CREATE POLICY "roles_select_unified" ON public.roles FOR SELECT USING (
    tenant_id = public.current_tenant_id() OR public.is_platform_admin()
);
CREATE POLICY "roles_insert_unified" ON public.roles FOR INSERT WITH CHECK (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin()
);
CREATE POLICY "roles_update_unified" ON public.roles FOR UPDATE USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin()
);
CREATE POLICY "roles_delete_unified" ON public.roles FOR DELETE USING (
    (tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin()
);

-- === TENANTS ===
DROP POLICY IF EXISTS "Platform Admin Manage Tenants" ON public.tenants;
DROP POLICY IF EXISTS "Users View Own Tenant" ON public.tenants;
DROP POLICY IF EXISTS "tenants_access_policy" ON public.tenants;

CREATE POLICY "tenants_select_unified" ON public.tenants FOR SELECT USING (
    id = public.current_tenant_id() OR public.is_platform_admin()
);
CREATE POLICY "tenants_insert_unified" ON public.tenants FOR INSERT WITH CHECK ( public.is_platform_admin() );
CREATE POLICY "tenants_update_unified" ON public.tenants FOR UPDATE USING ( public.is_platform_admin() );
CREATE POLICY "tenants_delete_unified" ON public.tenants FOR DELETE USING ( public.is_platform_admin() );


-- === SSO ROLE MAPPINGS ===
-- Fixes error: sso_role_mappings uses reference to sso_providers(id) -> tenant_id.
DROP POLICY IF EXISTS "sso_mappings_isolation_policy" ON public.sso_role_mappings;
DROP POLICY IF EXISTS "sso_role_mappings_access_policy" ON public.sso_role_mappings;

CREATE POLICY "sso_role_mappings_select_unified" ON public.sso_role_mappings FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.sso_providers p 
        WHERE p.id = sso_role_mappings.provider_id::uuid
        AND (p.tenant_id = public.current_tenant_id() OR public.is_platform_admin())
    )
);

CREATE POLICY "sso_role_mappings_insert_unified" ON public.sso_role_mappings FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.sso_providers p 
        WHERE p.id = sso_role_mappings.provider_id::uuid
        AND ( (p.tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() )
    )
);

CREATE POLICY "sso_role_mappings_update_unified" ON public.sso_role_mappings FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM public.sso_providers p 
        WHERE p.id = sso_role_mappings.provider_id::uuid
        AND ( (p.tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() )
    )
);

CREATE POLICY "sso_role_mappings_delete_unified" ON public.sso_role_mappings FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM public.sso_providers p 
        WHERE p.id = sso_role_mappings.provider_id::uuid
        AND ( (p.tenant_id = public.current_tenant_id() AND public.is_admin_or_above()) OR public.is_platform_admin() )
    )
);

-- 4. CLEANUP OLD TEMPLATE POLICIES
DO $$
DECLARE
    t text;
    tables text[] := ARRAY['templates', 'template_parts', 'widgets', 'template_assignments', 'product_types'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Tenant Read Access" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Tenant Write Access" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Tenant Update Access" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Tenant Delete Access" ON public.%I;', t);
        EXECUTE format('DROP POLICY IF EXISTS "Tenant Insert Access" ON public.%I;', t);
    END LOOP;
END $$;
