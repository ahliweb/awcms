-- Migration: Fix Tenant Onboarding RPC Schema Mismatch
-- Date: 2025-12-31
-- Description: Updates the create_tenant_with_defaults function to match the actual 'menus' table schema (label, url) instead of (name, location).

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(
    p_name text,
    p_slug text,
    p_domain text DEFAULT NULL,
    p_tier text DEFAULT 'free'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id uuid;
    v_admin_role_id uuid;
BEGIN
    -- 1. Create Tenant
    INSERT INTO public.tenants (name, slug, domain, subscription_tier, status)
    VALUES (p_name, p_slug, p_domain, p_tier, 'active')
    RETURNING id INTO v_tenant_id;

    -- 2. Create Default Roles (Scoped to Tenant)
    -- Admin
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true)
    RETURNING id INTO v_admin_role_id;

    -- Editor
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('editor', 'Content Editor', v_tenant_id, true);

    -- Author
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('author', 'Content Author', v_tenant_id, true);

    -- 3. Create Default Pages (Home, About, Contact)
    -- Homepage
    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id, 
        'Home', 
        'home', 
        '{"root":{"props":{"title":"Home"},"children":[]}}', 
        'published', 
        true, 
        'homepage', 
        (SELECT auth.uid()) -- Safe auth.uid() usage
    );

    -- About
    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id, 
        'About Us', 
        'about', 
        '{"root":{"props":{"title":"About Us"},"children":[]}}', 
        'published', 
        true, 
        'regular', 
        (SELECT auth.uid())
    );

    -- 4. Create Default Menu Items (Header)
    -- Fixed to match schema: label, url, group_label, is_public, order
    
    -- Home Link
    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'Home', '/', 'header', true, true, 1);

    -- About Link
    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'About', '/about', 'header', true, true, 2);

    RETURN jsonb_build_object(
        'tenant_id', v_tenant_id,
        'message', 'Tenant created with default data.'
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
