-- Add tenant_id to admin_menus if it doesn't exist (required for policy below)
ALTER TABLE IF EXISTS "public"."admin_menus" ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "public"."tenants"("id");
CREATE INDEX IF NOT EXISTS idx_admin_menus_tenant_id ON public.admin_menus (tenant_id);

-- Performance: Add indices for foreign keys on tenant_id
CREATE INDEX IF NOT EXISTS idx_analytics_daily_tenant_id ON public.analytics_daily (tenant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_id ON public.analytics_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mobile_app_config_tenant_id ON public.mobile_app_config (tenant_id);
CREATE INDEX IF NOT EXISTS idx_modules_tenant_id ON public.modules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_channels_tenant_id ON public.tenant_channels (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_resource_rules_tenant_id ON public.tenant_resource_rules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_role_links_tenant_id ON public.tenant_role_links (tenant_id);

-- Security: Fix permissive policies for Categories
DROP POLICY IF EXISTS "Enable read access for all users" ON public.categories;
CREATE POLICY "categories_select_tenant" ON public.categories
    FOR SELECT
    TO public
    USING (tenant_id = public.current_tenant_id());

-- Security: Fix permissive policies for Admin Menus
DROP POLICY IF EXISTS "admin_menus_select_unified" ON public.admin_menus;
CREATE POLICY "admin_menus_select_unified" ON public.admin_menus
    FOR SELECT
    TO authenticated
    USING (
        (tenant_id = public.current_tenant_id())
        OR public.is_platform_admin()
    );

-- Security: Fix permissive policies for Template Strings
DROP POLICY IF EXISTS "template_strings_select_unified" ON public.template_strings;
CREATE POLICY "template_strings_select_unified" ON public.template_strings
    FOR SELECT
    TO public
    USING (tenant_id = public.current_tenant_id());

-- Security: Fix permissive policies for Content Translations
DROP POLICY IF EXISTS "content_translations_read_all" ON public.content_translations;
CREATE POLICY "content_translations_read_all" ON public.content_translations
    FOR SELECT
    TO public
    USING (tenant_id = public.current_tenant_id());

-- Security: Fix permissive policies for Page Files
DROP POLICY IF EXISTS "page_files_read_all" ON public.page_files;
CREATE POLICY "page_files_read_all" ON public.page_files
    FOR SELECT
    TO public
    USING (tenant_id = public.current_tenant_id());

-- Security: Fix permissive policies for SEO Metadata
DROP POLICY IF EXISTS "seo_metadata_select_public" ON public.seo_metadata;
CREATE POLICY "seo_metadata_select_public" ON public.seo_metadata
    FOR SELECT
    TO public
    USING (tenant_id = public.current_tenant_id());

-- Security: Fix permissive policies for Orders (Insert)
DROP POLICY IF EXISTS "Enable insert for anonymous users" ON public.orders;
CREATE POLICY "Enable insert for anonymous users" ON public.orders
    FOR INSERT
    TO anon
    WITH CHECK (
        tenant_id = public.current_tenant_id()
    );
