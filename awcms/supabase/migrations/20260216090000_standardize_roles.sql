-- Migration: Standardize Tenant Roles
-- Objective: Ensure 'Auditor', 'Member', 'Subscriber', 'Public', 'No Access' exist for all tenants.

SET client_min_messages TO warning;

-- 1. Update the Tenant Creation Function
CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(
  p_name text,
  p_slug text,
  p_domain text DEFAULT NULL::text,
  p_tier text DEFAULT 'free'::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_tenant_id uuid;
    v_admin_role_id uuid;
BEGIN
    INSERT INTO public.tenants (name, slug, domain, subscription_tier, status)
    VALUES (p_name, p_slug, p_domain, p_tier, 'active')
    RETURNING id INTO v_tenant_id;

    -- 1. Admin (Tenant Admin)
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_tenant_admin)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true, 'tenant', true)
    RETURNING id INTO v_admin_role_id;

    -- 2. Editor
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('editor', 'Content Editor', v_tenant_id, true, 'tenant');

    -- 3. Author
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('author', 'Content Author', v_tenant_id, true, 'tenant');

    -- 4. Auditor (Read-Only) - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('auditor', 'Auditor (Read-Only)', v_tenant_id, true, 'tenant');

    -- 5. Member - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('member', 'Standard Member', v_tenant_id, true, 'tenant');

    -- 6. Subscriber - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('subscriber', 'Premium Subscriber', v_tenant_id, true, 'tenant');

    -- 7. Public - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_public)
    VALUES ('public', 'Public Visitor', v_tenant_id, true, 'tenant', true);

    -- 8. No Access - NEW
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
$$;

-- 2. Backfill Existing Tenants
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    -- Auditor
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('auditor', 'Auditor (Read-Only)', t.id, true, 'tenant')
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- Member
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('member', 'Standard Member', t.id, true, 'tenant')
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- Subscriber
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('subscriber', 'Premium Subscriber', t.id, true, 'tenant')
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- Public
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_public)
    VALUES ('public', 'Public Visitor', t.id, true, 'tenant', true)
    ON CONFLICT (tenant_id, name) DO NOTHING;

    -- No Access
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('no_access', 'Suspended / No Access', t.id, true, 'tenant')
    ON CONFLICT (tenant_id, name) DO NOTHING;
  END LOOP;
END;
$$;
