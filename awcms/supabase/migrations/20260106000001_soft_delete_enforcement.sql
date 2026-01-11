-- Migration: Strict soft delete enforcement
-- Description: Adds deleted_at columns and aligns RLS policies/functions to ignore soft-deleted rows.

-- 1) Add deleted_at columns + indexes
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'extension_menu_items' AND table_schema = 'public') THEN
        ALTER TABLE public.extension_menu_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_extension_menu_items_deleted_at ON public.extension_menu_items(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'extension_routes_registry' AND table_schema = 'public') THEN
        ALTER TABLE public.extension_routes_registry ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_extension_routes_registry_deleted_at ON public.extension_routes_registry(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cart_items' AND table_schema = 'public') THEN
        ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_cart_items_deleted_at ON public.cart_items(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'role_permissions' AND table_schema = 'public') THEN
        ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_role_permissions_deleted_at ON public.role_permissions(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'role_policies' AND table_schema = 'public') THEN
        ALTER TABLE public.role_policies ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_role_policies_deleted_at ON public.role_policies(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'policies' AND table_schema = 'public') THEN
        ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_policies_deleted_at ON public.policies(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'themes' AND table_schema = 'public') THEN
        ALTER TABLE public.themes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_themes_deleted_at ON public.themes(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_notifications' AND table_schema = 'public') THEN
        ALTER TABLE public.push_notifications ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_push_notifications_deleted_at ON public.push_notifications(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'template_strings' AND table_schema = 'public') THEN
        ALTER TABLE public.template_strings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_template_strings_deleted_at ON public.template_strings(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'two_factor_auth' AND table_schema = 'public') THEN
        ALTER TABLE public.two_factor_auth ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_two_factor_auth_deleted_at ON public.two_factor_auth(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mobile_users' AND table_schema = 'public') THEN
        ALTER TABLE public.mobile_users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_mobile_users_deleted_at ON public.mobile_users(deleted_at);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settings' AND table_schema = 'public') THEN
        ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_settings_deleted_at ON public.settings(deleted_at);
    END IF;
END $$;

-- 2) RLS policy alignment for soft delete
DO $$
BEGIN
    -- extension_menu_items
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'extension_menu_items' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "Admins manage extension_menu_items" ON public.extension_menu_items;
        DROP POLICY IF EXISTS "extension_menu_items_select_admin" ON public.extension_menu_items;
        DROP POLICY IF EXISTS "extension_menu_items_insert_admin" ON public.extension_menu_items;
        DROP POLICY IF EXISTS "extension_menu_items_update_admin" ON public.extension_menu_items;

        CREATE POLICY "extension_menu_items_select_admin" ON public.extension_menu_items
            FOR SELECT TO authenticated
            USING (public.is_admin_or_above() AND deleted_at IS NULL);

        CREATE POLICY "extension_menu_items_insert_admin" ON public.extension_menu_items
            FOR INSERT TO authenticated
            WITH CHECK (public.is_admin_or_above() AND deleted_at IS NULL);

        CREATE POLICY "extension_menu_items_update_admin" ON public.extension_menu_items
            FOR UPDATE TO authenticated
            USING (public.is_admin_or_above())
            WITH CHECK (public.is_admin_or_above());
    END IF;

    -- extension_routes_registry
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'extension_routes_registry' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "extension_routes_registry_select" ON public.extension_routes_registry;
        DROP POLICY IF EXISTS "extension_routes_registry_insert_admin" ON public.extension_routes_registry;
        DROP POLICY IF EXISTS "extension_routes_registry_update_admin" ON public.extension_routes_registry;

        CREATE POLICY "extension_routes_registry_select" ON public.extension_routes_registry
            FOR SELECT TO public
            USING (deleted_at IS NULL AND (is_active = true OR public.is_platform_admin()));

        CREATE POLICY "extension_routes_registry_insert_admin" ON public.extension_routes_registry
            FOR INSERT TO authenticated
            WITH CHECK (public.is_admin_or_above() AND deleted_at IS NULL);

        CREATE POLICY "extension_routes_registry_update_admin" ON public.extension_routes_registry
            FOR UPDATE TO authenticated
            USING (public.is_admin_or_above())
            WITH CHECK (public.is_admin_or_above());
    END IF;

    -- cart_items
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cart_items' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "cart_items_delete_unified" ON public.cart_items;
        DROP POLICY IF EXISTS "cart_items_insert_unified" ON public.cart_items;
        DROP POLICY IF EXISTS "cart_items_select_unified" ON public.cart_items;
        DROP POLICY IF EXISTS "cart_items_update_unified" ON public.cart_items;

        CREATE POLICY "cart_items_select_unified" ON public.cart_items
            FOR SELECT TO public
            USING (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()) AND deleted_at IS NULL);

        CREATE POLICY "cart_items_insert_unified" ON public.cart_items
            FOR INSERT TO public
            WITH CHECK ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()) AND deleted_at IS NULL);

        CREATE POLICY "cart_items_update_unified" ON public.cart_items
            FOR UPDATE TO public
            USING ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()))
            WITH CHECK ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));
    END IF;

    -- role_permissions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'role_permissions' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "role_permissions_delete_policy" ON public.role_permissions;
        DROP POLICY IF EXISTS "role_permissions_insert_policy" ON public.role_permissions;
        DROP POLICY IF EXISTS "role_permissions_select_policy" ON public.role_permissions;
        DROP POLICY IF EXISTS "role_permissions_update_policy" ON public.role_permissions;

        CREATE POLICY "role_permissions_select_policy" ON public.role_permissions
            FOR SELECT TO authenticated
            USING (deleted_at IS NULL);

        CREATE POLICY "role_permissions_insert_policy" ON public.role_permissions
            FOR INSERT TO authenticated
            WITH CHECK (public.is_super_admin() AND deleted_at IS NULL);

        CREATE POLICY "role_permissions_update_policy" ON public.role_permissions
            FOR UPDATE TO authenticated
            USING (public.is_super_admin())
            WITH CHECK (public.is_super_admin());
    END IF;

    -- role_policies
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'role_policies' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "role_policies_delete_unified" ON public.role_policies;
        DROP POLICY IF EXISTS "role_policies_insert_unified" ON public.role_policies;
        DROP POLICY IF EXISTS "role_policies_select_unified" ON public.role_policies;
        DROP POLICY IF EXISTS "role_policies_update_unified" ON public.role_policies;

        CREATE POLICY "role_policies_select_unified" ON public.role_policies
            FOR SELECT TO authenticated
            USING (deleted_at IS NULL);

        CREATE POLICY "role_policies_insert_unified" ON public.role_policies
            FOR INSERT TO public
            WITH CHECK (public.is_platform_admin() AND deleted_at IS NULL);

        CREATE POLICY "role_policies_update_unified" ON public.role_policies
            FOR UPDATE TO public
            USING (public.is_platform_admin())
            WITH CHECK (public.is_platform_admin());
    END IF;

    -- permissions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'permissions' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "permissions_delete_policy" ON public.permissions;
        DROP POLICY IF EXISTS "permissions_insert_policy" ON public.permissions;
        DROP POLICY IF EXISTS "permissions_select_policy" ON public.permissions;
        DROP POLICY IF EXISTS "permissions_update_policy" ON public.permissions;

        CREATE POLICY "permissions_select_policy" ON public.permissions
            FOR SELECT TO authenticated
            USING (deleted_at IS NULL);

        CREATE POLICY "permissions_insert_policy" ON public.permissions
            FOR INSERT TO authenticated
            WITH CHECK (public.is_super_admin() AND deleted_at IS NULL);

        CREATE POLICY "permissions_update_policy" ON public.permissions
            FOR UPDATE TO authenticated
            USING (public.is_super_admin())
            WITH CHECK (public.is_super_admin());
    END IF;

    -- policies
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'policies' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "policies_delete_unified" ON public.policies;
        DROP POLICY IF EXISTS "policies_insert_unified" ON public.policies;
        DROP POLICY IF EXISTS "policies_select_unified" ON public.policies;
        DROP POLICY IF EXISTS "policies_update_unified" ON public.policies;

        CREATE POLICY "policies_select_unified" ON public.policies
            FOR SELECT TO public
            USING (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()) AND deleted_at IS NULL);

        CREATE POLICY "policies_insert_unified" ON public.policies
            FOR INSERT TO public
            WITH CHECK (public.is_platform_admin() AND deleted_at IS NULL);

        CREATE POLICY "policies_update_unified" ON public.policies
            FOR UPDATE TO public
            USING (public.is_platform_admin())
            WITH CHECK (public.is_platform_admin());
    END IF;

    -- themes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'themes' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "themes_delete_unified" ON public.themes;
        DROP POLICY IF EXISTS "themes_insert_unified" ON public.themes;
        DROP POLICY IF EXISTS "themes_select_unified" ON public.themes;
        DROP POLICY IF EXISTS "themes_update_unified" ON public.themes;

        CREATE POLICY "themes_select_unified" ON public.themes
            FOR SELECT TO public
            USING (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()) AND deleted_at IS NULL);

        CREATE POLICY "themes_insert_unified" ON public.themes
            FOR INSERT TO public
            WITH CHECK ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()) AND deleted_at IS NULL);

        CREATE POLICY "themes_update_unified" ON public.themes
            FOR UPDATE TO public
            USING ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()))
            WITH CHECK ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));
    END IF;

    -- push_notifications
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_notifications' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "push_notifications_access" ON public.push_notifications;
        DROP POLICY IF EXISTS "push_notifications_select" ON public.push_notifications;
        DROP POLICY IF EXISTS "push_notifications_insert" ON public.push_notifications;
        DROP POLICY IF EXISTS "push_notifications_update" ON public.push_notifications;

        CREATE POLICY "push_notifications_select" ON public.push_notifications
            FOR SELECT TO public
            USING (((tenant_id = (SELECT public.current_tenant_id() AS current_tenant_id)) OR (SELECT public.is_platform_admin() AS is_platform_admin)) AND deleted_at IS NULL);

        CREATE POLICY "push_notifications_insert" ON public.push_notifications
            FOR INSERT TO public
            WITH CHECK (((tenant_id = (SELECT public.current_tenant_id() AS current_tenant_id)) OR (SELECT public.is_platform_admin() AS is_platform_admin)) AND deleted_at IS NULL);

        CREATE POLICY "push_notifications_update" ON public.push_notifications
            FOR UPDATE TO public
            USING (((tenant_id = (SELECT public.current_tenant_id() AS current_tenant_id)) OR (SELECT public.is_platform_admin() AS is_platform_admin)))
            WITH CHECK (((tenant_id = (SELECT public.current_tenant_id() AS current_tenant_id)) OR (SELECT public.is_platform_admin() AS is_platform_admin)));
    END IF;

    -- template_strings
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'template_strings' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "template_strings_delete_unified" ON public.template_strings;
        DROP POLICY IF EXISTS "template_strings_insert_unified" ON public.template_strings;
        DROP POLICY IF EXISTS "template_strings_select_unified" ON public.template_strings;
        DROP POLICY IF EXISTS "template_strings_update_unified" ON public.template_strings;

        CREATE POLICY "template_strings_select_unified" ON public.template_strings
            FOR SELECT TO public
            USING (deleted_at IS NULL);

        CREATE POLICY "template_strings_insert_unified" ON public.template_strings
            FOR INSERT TO public
            WITH CHECK (public.is_platform_admin() AND deleted_at IS NULL);

        CREATE POLICY "template_strings_update_unified" ON public.template_strings
            FOR UPDATE TO public
            USING (public.is_platform_admin())
            WITH CHECK (public.is_platform_admin());
    END IF;

    -- two_factor_auth
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'two_factor_auth' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "Users can delete own 2fa" ON public.two_factor_auth;
        DROP POLICY IF EXISTS "Users can modify own 2fa" ON public.two_factor_auth;
        DROP POLICY IF EXISTS "Users can update own 2fa" ON public.two_factor_auth;
        DROP POLICY IF EXISTS "Users can view own 2fa" ON public.two_factor_auth;

        CREATE POLICY "Users can view own 2fa" ON public.two_factor_auth
            FOR SELECT TO public
            USING ((SELECT auth.uid() AS uid) = user_id AND deleted_at IS NULL);

        CREATE POLICY "Users can update own 2fa" ON public.two_factor_auth
            FOR INSERT TO public
            WITH CHECK ((SELECT auth.uid() AS uid) = user_id AND deleted_at IS NULL);

        CREATE POLICY "Users can modify own 2fa" ON public.two_factor_auth
            FOR UPDATE TO public
            USING ((SELECT auth.uid() AS uid) = user_id)
            WITH CHECK ((SELECT auth.uid() AS uid) = user_id);
    END IF;

    -- mobile_users
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mobile_users' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "mobile_users_access" ON public.mobile_users;
        DROP POLICY IF EXISTS "mobile_users_select" ON public.mobile_users;
        DROP POLICY IF EXISTS "mobile_users_insert" ON public.mobile_users;
        DROP POLICY IF EXISTS "mobile_users_update" ON public.mobile_users;

        CREATE POLICY "mobile_users_select" ON public.mobile_users
            FOR SELECT TO public
            USING ((((tenant_id = (SELECT public.current_tenant_id() AS current_tenant_id)) AND (user_id = (SELECT auth.uid() AS uid))) OR (SELECT public.is_admin_or_above() AS is_admin_or_above) OR (SELECT public.is_platform_admin() AS is_platform_admin)) AND deleted_at IS NULL);

        CREATE POLICY "mobile_users_insert" ON public.mobile_users
            FOR INSERT TO public
            WITH CHECK ((((tenant_id = (SELECT public.current_tenant_id() AS current_tenant_id)) AND (user_id = (SELECT auth.uid() AS uid))) OR (SELECT public.is_admin_or_above() AS is_admin_or_above) OR (SELECT public.is_platform_admin() AS is_platform_admin)) AND deleted_at IS NULL);

        CREATE POLICY "mobile_users_update" ON public.mobile_users
            FOR UPDATE TO public
            USING (((tenant_id = (SELECT public.current_tenant_id() AS current_tenant_id)) AND (user_id = (SELECT auth.uid() AS uid))) OR (SELECT public.is_admin_or_above() AS is_admin_or_above) OR (SELECT public.is_platform_admin() AS is_platform_admin))
            WITH CHECK (((tenant_id = (SELECT public.current_tenant_id() AS current_tenant_id)) AND (user_id = (SELECT auth.uid() AS uid))) OR (SELECT public.is_admin_or_above() AS is_admin_or_above) OR (SELECT public.is_platform_admin() AS is_platform_admin));
    END IF;

    -- settings
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settings' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "settings_delete_unified" ON public.settings;
        DROP POLICY IF EXISTS "settings_insert_unified" ON public.settings;
        DROP POLICY IF EXISTS "settings_select_unified" ON public.settings;
        DROP POLICY IF EXISTS "settings_update_unified" ON public.settings;

        CREATE POLICY "settings_select_unified" ON public.settings
            FOR SELECT TO public
            USING (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()) AND deleted_at IS NULL);

        CREATE POLICY "settings_insert_unified" ON public.settings
            FOR INSERT TO public
            WITH CHECK ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()) AND deleted_at IS NULL);

        CREATE POLICY "settings_update_unified" ON public.settings
            FOR UPDATE TO public
            USING ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()))
            WITH CHECK ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));
    END IF;
END $$;

-- 3) Permission helpers should ignore soft-deleted rows
CREATE OR REPLACE FUNCTION public.get_my_permissions()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  perms text[];
BEGIN
  SELECT ARRAY_AGG(p.name)
  INTO perms
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  JOIN public.role_permissions rp ON r.id = rp.role_id
  JOIN public.permissions p ON rp.permission_id = p.id
  WHERE u.id = (SELECT auth.uid())
    AND r.deleted_at IS NULL
    AND rp.deleted_at IS NULL
    AND p.deleted_at IS NULL;

  RETURN COALESCE(perms, ARRAY[]::text[]);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_public_permission(permission_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  has_perm boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE r.name = 'public'
      AND p.name = permission_name
      AND r.deleted_at IS NULL
      AND rp.deleted_at IS NULL
      AND p.deleted_at IS NULL
  ) INTO has_perm;
  RETURN has_perm;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_permission(permission_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  has_perm boolean;
  v_role text;
BEGIN
  v_role := (SELECT public.get_my_role());

  IF v_role = 'super_admin' THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    JOIN public.role_permissions rp ON r.id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE u.id = (SELECT auth.uid())
      AND p.name = permission_name
      AND r.deleted_at IS NULL
      AND rp.deleted_at IS NULL
      AND p.deleted_at IS NULL
  ) INTO has_perm;

  RETURN has_perm;
END;
$function$;
