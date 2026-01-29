SET client_min_messages TO warning;

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_full_access boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_level integer,
  ADD COLUMN IF NOT EXISTS is_tenant_admin boolean NOT NULL DEFAULT false;

ALTER TABLE public.notification_readers
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_scope_check') THEN
        ALTER TABLE public.roles
        ADD CONSTRAINT roles_scope_check
        CHECK (scope IN ('platform', 'tenant', 'public'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_staff_level_check') THEN
        ALTER TABLE public.roles
        ADD CONSTRAINT roles_staff_level_check
        CHECK ((is_staff AND staff_level BETWEEN 1 AND 10) OR (NOT is_staff AND staff_level IS NULL));
    END IF;
END $$;

ALTER TABLE public.roles
  DROP CONSTRAINT IF EXISTS roles_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS roles_name_global_unique
  ON public.roles (name)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS roles_name_tenant_unique
  ON public.roles (tenant_id, name)
  WHERE tenant_id IS NOT NULL;

UPDATE public.roles
SET is_system = false
WHERE is_system IS NULL;

UPDATE public.roles
SET scope = CASE WHEN tenant_id IS NULL THEN 'platform' ELSE 'tenant' END;

UPDATE public.roles
SET scope = 'public',
    is_public = true,
    is_system = true
WHERE name = 'public';

UPDATE public.roles
SET scope = 'public',
    is_guest = true,
    is_system = true
WHERE name = 'guest';

UPDATE public.roles
SET scope = 'platform',
    is_platform_admin = true,
    is_full_access = true,
    is_system = true
WHERE name IN ('owner', 'super_admin');

UPDATE public.roles
SET scope = 'tenant',
    is_tenant_admin = true,
    is_system = true
WHERE name = 'admin'
  AND tenant_id IS NOT NULL;

UPDATE public.roles
SET scope = 'tenant',
    is_system = true
WHERE name IN ('editor', 'author')
  AND tenant_id IS NOT NULL;

INSERT INTO public.permissions (name, description, resource, action, created_at, updated_at)
VALUES ('view_orders', 'Can view orders', 'orders', 'view', now(), now())
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.seed_staff_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  role_rec record;
BEGIN
  FOR role_rec IN
    SELECT * FROM (
      VALUES
        ('super_manager', 'Super Manager', 10),
        ('senior_manager', 'Senior Manager', 9),
        ('manager', 'Manager', 8),
        ('senior_supervisor', 'Senior Supervisor', 7),
        ('supervisor', 'Supervisor', 6),
        ('senior_specialist', 'Senior Specialist', 5),
        ('specialist', 'Specialist', 4),
        ('associate', 'Associate', 3),
        ('assistant', 'Assistant', 2),
        ('internship', 'Internship', 1)
    ) AS role_values(role_name, role_description, role_level)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.roles
      WHERE tenant_id = p_tenant_id
        AND name = role_rec.role_name
    ) THEN
      INSERT INTO public.roles (
        name,
        description,
        tenant_id,
        is_system,
        scope,
        is_staff,
        staff_level
      )
      VALUES (
        role_rec.role_name,
        role_rec.role_description,
        p_tenant_id,
        true,
        'tenant',
        true,
        role_rec.role_level
      );
    END IF;
  END LOOP;
END;
$$;

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

    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_tenant_admin)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true, 'tenant', true)
    RETURNING id INTO v_admin_role_id;

    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('editor', 'Content Editor', v_tenant_id, true, 'tenant');

    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('author', 'Content Author', v_tenant_id, true, 'tenant');

    PERFORM public.seed_staff_roles(v_tenant_id);

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

    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'Home', '/', 'header', true, true, 1);

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

DO $$
DECLARE
  tenant_row record;
BEGIN
  FOR tenant_row IN
    SELECT id FROM public.tenants
  LOOP
    PERFORM public.seed_staff_roles(tenant_row.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.auth_is_admin() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
      AND r.deleted_at IS NULL
      AND (r.is_tenant_admin OR r.is_platform_admin OR r.is_full_access)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  role_name text;
BEGIN
  SELECT r.name INTO role_name
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  WHERE u.id = (SELECT auth.uid())
    AND r.deleted_at IS NULL
  LIMIT 1;

  IF role_name IS NULL THEN
    SELECT r.name INTO role_name
    FROM public.roles r
    WHERE r.is_guest = true
      AND r.deleted_at IS NULL
      AND (r.tenant_id = public.current_tenant_id() OR r.tenant_id IS NULL)
    ORDER BY r.tenant_id NULLS LAST
    LIMIT 1;
  END IF;

  RETURN COALESCE(role_name, 'guest');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role_name() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.get_my_role();
$$;

CREATE OR REPLACE FUNCTION public.has_permission(permission_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  has_perm boolean;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = (SELECT auth.uid())
      AND r.deleted_at IS NULL
      AND (r.is_full_access OR r.is_platform_admin OR r.is_tenant_admin)
  ) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    JOIN public.role_permissions rp ON r.id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE u.id = (SELECT auth.uid())
      AND r.deleted_at IS NULL
      AND rp.deleted_at IS NULL
      AND p.deleted_at IS NULL
      AND p.name = permission_name
  ) INTO has_perm;

  RETURN has_perm;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
      AND r.deleted_at IS NULL
      AND r.is_platform_admin = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.is_platform_admin();
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_above() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
      AND r.deleted_at IS NULL
      AND (r.is_tenant_admin OR r.is_platform_admin OR r.is_full_access)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_media_manage_role() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    public.is_admin_or_above()
    OR public.has_permission('view_files')
    OR public.has_permission('create_files')
    OR public.has_permission('edit_files')
    OR public.has_permission('delete_files');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_backups() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT public.is_platform_admin(); $$;

CREATE OR REPLACE FUNCTION public.can_manage_extension() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT public.is_platform_admin(); $$;

CREATE OR REPLACE FUNCTION public.can_manage_extensions() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT public.is_platform_admin(); $$;

CREATE OR REPLACE FUNCTION public.can_manage_logs() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT public.is_platform_admin(); $$;

CREATE OR REPLACE FUNCTION public.can_manage_monitoring() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT public.is_platform_admin(); $$;

CREATE OR REPLACE FUNCTION public.can_manage_resource() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT public.is_admin_or_above(); $$;

CREATE OR REPLACE FUNCTION public.can_manage_settings() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT public.is_platform_admin(); $$;

DROP POLICY IF EXISTS "Admins View SSO Logs" ON public.sso_audit_logs;
CREATE POLICY "Admins View SSO Logs" ON public.sso_audit_logs
  FOR SELECT
  USING (((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.sso.read')) OR public.is_platform_admin());

DROP POLICY IF EXISTS "Users view own orders" ON public.orders;
CREATE POLICY "Users view own orders" ON public.orders
  FOR SELECT
  USING (
    (user_id = (SELECT auth.uid()))
    OR ((tenant_id = public.current_tenant_id()) AND public.has_permission('view_orders'))
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "extension_permissions_delete_admin" ON public.extension_permissions;
CREATE POLICY "extension_permissions_delete_admin" ON public.extension_permissions
  FOR DELETE
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "extension_permissions_insert_admin" ON public.extension_permissions;
CREATE POLICY "extension_permissions_insert_admin" ON public.extension_permissions
  FOR INSERT
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "extension_permissions_update_admin" ON public.extension_permissions;
CREATE POLICY "extension_permissions_update_admin" ON public.extension_permissions
  FOR UPDATE
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "extension_rbac_delete" ON public.extension_rbac_integration;
CREATE POLICY "extension_rbac_delete" ON public.extension_rbac_integration
  FOR DELETE
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = extension_rbac_integration.role_id
        AND r.tenant_id = public.current_tenant_id()
        AND public.is_admin_or_above()
    )
  );

DROP POLICY IF EXISTS "extension_rbac_insert" ON public.extension_rbac_integration;
CREATE POLICY "extension_rbac_insert" ON public.extension_rbac_integration
  FOR INSERT
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = extension_rbac_integration.role_id
        AND r.tenant_id = public.current_tenant_id()
        AND public.is_admin_or_above()
    )
  );

DROP POLICY IF EXISTS "extension_rbac_update" ON public.extension_rbac_integration;
CREATE POLICY "extension_rbac_update" ON public.extension_rbac_integration
  FOR UPDATE
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = extension_rbac_integration.role_id
        AND r.tenant_id = public.current_tenant_id()
        AND public.is_admin_or_above()
    )
  );

DROP POLICY IF EXISTS "extension_routes_registry_select" ON public.extension_routes_registry;
CREATE POLICY "extension_routes_registry_select" ON public.extension_routes_registry
  FOR SELECT
  USING ((deleted_at IS NULL) AND (is_active = true OR public.is_platform_admin()));

DROP POLICY IF EXISTS "notification_readers_select_policy" ON public.notification_readers;
CREATE POLICY "notification_readers_select_policy" ON public.notification_readers
  FOR SELECT
  USING (
    (user_id = (SELECT auth.uid()))
    OR ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above())
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "testimony_tags_delete" ON public.testimony_tags;
CREATE POLICY "testimony_tags_delete" ON public.testimony_tags
  FOR DELETE
  USING (
    ((tenant_id = public.current_tenant_id()) AND public.has_permission('edit_testimonies'))
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "testimony_tags_insert" ON public.testimony_tags;
CREATE POLICY "testimony_tags_insert" ON public.testimony_tags
  FOR INSERT
  WITH CHECK (
    ((tenant_id = public.current_tenant_id()) AND public.has_permission('edit_testimonies'))
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "testimony_tags_update" ON public.testimony_tags;
CREATE POLICY "testimony_tags_update" ON public.testimony_tags
  FOR UPDATE
  USING (
    ((tenant_id = public.current_tenant_id()) AND public.has_permission('edit_testimonies'))
    OR public.is_platform_admin()
  );
