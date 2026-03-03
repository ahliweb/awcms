-- Fix unused variable warning in create_tenant_with_defaults
-- The v_admin_role_id was declared and assigned but never used

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(
    p_name text,
    p_slug text,
    p_domain text DEFAULT NULL::text,
    p_tier text DEFAULT 'free'::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_tenant_id uuid;
BEGIN
    INSERT INTO public.tenants (name, slug, domain, subscription_tier, status)
    VALUES (p_name, p_slug, p_domain, p_tier, 'active')
    RETURNING id INTO v_tenant_id;

    -- 1. Admin (Tenant Admin)
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_tenant_admin)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true, 'tenant', true);

    -- 2. Editor
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('editor', 'Content Editor', v_tenant_id, true, 'tenant');

    -- 3. Author
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('author', 'Content Author', v_tenant_id, true, 'tenant');

    -- 4. Auditor (Read-Only)
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('auditor', 'Auditor (Read-Only)', v_tenant_id, true, 'tenant');

    -- 5. Member
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('member', 'Standard Member', v_tenant_id, true, 'tenant');

    -- 6. Subscriber
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('subscriber', 'Premium Subscriber', v_tenant_id, true, 'tenant');

    -- 7. Public
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_public)
    VALUES ('public', 'Public Visitor', v_tenant_id, true, 'tenant', true);

    -- 8. No Access
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('no_access', 'Suspended / No Access', v_tenant_id, true, 'tenant');

    -- Seed Staff Roles
    PERFORM public.seed_staff_roles(v_tenant_id);

    -- Default Pages
    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id,
        'Home',
        'home',
        '{"root":{"props":{"title":"Home"},"children":[]}}',
        'published',
        true,
        'homepage',
        (SELECT auth.uid())
    );

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

    -- Default Menus
    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'Home', '/', 'header', true, true, 1);

    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'About', '/about', 'header', true, true, 2);

    RETURN jsonb_build_object(
        'tenant_id', v_tenant_id,
        'message', 'Tenant created with default data (Standard Roles applied).'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$function$;

GRANT ALL ON FUNCTION public.create_tenant_with_defaults(text, text, text, text) TO anon;
GRANT ALL ON FUNCTION public.create_tenant_with_defaults(text, text, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.create_tenant_with_defaults(text, text, text, text) TO service_role;
