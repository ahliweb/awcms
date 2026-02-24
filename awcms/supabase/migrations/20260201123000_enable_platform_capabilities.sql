-- Migration: Enable Platform Capabilities (Unlock Permissions for Custom Roles)

-- 1. Helper to insert permissions safely
CREATE OR REPLACE FUNCTION public.seed_platform_permission(
  p_resource text,
  p_action text,
  p_module text DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO public.permissions (name, description, resource, action, module)
  VALUES (
    'platform.' || p_resource || '.' || p_action,
    'Manage ' || p_resource || ': ' || p_action,
    p_resource,
    p_action,
    COALESCE(p_module, p_resource)
  )
  ON CONFLICT (name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 2. Insert Permissions
-- Settings
SELECT public.seed_platform_permission('settings', 'read');
SELECT public.seed_platform_permission('settings', 'update');
-- Backups
SELECT public.seed_platform_permission('backups', 'create');
SELECT public.seed_platform_permission('backups', 'read');
SELECT public.seed_platform_permission('backups', 'delete');
SELECT public.seed_platform_permission('backups', 'restore');
-- Extensions
SELECT public.seed_platform_permission('extensions', 'create');
SELECT public.seed_platform_permission('extensions', 'read');
SELECT public.seed_platform_permission('extensions', 'update');
SELECT public.seed_platform_permission('extensions', 'delete');
-- Logs
SELECT public.seed_platform_permission('logs', 'read');
-- Monitoring
SELECT public.seed_platform_permission('monitoring', 'read');
-- SSO
SELECT public.seed_platform_permission('sso', 'read');
SELECT public.seed_platform_permission('sso', 'update', 'sso');
-- System
SELECT public.seed_platform_permission('system', 'read');
SELECT public.seed_platform_permission('system', 'update');
-- Languages
SELECT public.seed_platform_permission('languages', 'create');
SELECT public.seed_platform_permission('languages', 'read');
SELECT public.seed_platform_permission('languages', 'update');
SELECT public.seed_platform_permission('languages', 'delete');
-- SEO
SELECT public.seed_platform_permission('seo', 'read');
SELECT public.seed_platform_permission('seo', 'update');


-- 3. Update Functions

CREATE OR REPLACE FUNCTION public.can_manage_settings() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_platform_admin() OR public.has_permission('platform.settings.update') OR public.has_permission('platform.settings.read');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_backups() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_platform_admin() 
  OR public.has_permission('platform.backups.read') 
  OR public.has_permission('platform.backups.create')
  OR public.has_permission('platform.backups.delete')
  OR public.has_permission('platform.backups.restore');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_extensions() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_platform_admin() OR public.has_permission('platform.extensions.read');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_extension() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_platform_admin() OR public.has_permission('platform.extensions.read');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_logs() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_platform_admin() OR public.has_permission('platform.logs.read');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_monitoring() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.is_platform_admin() OR public.has_permission('platform.monitoring.read');
$$;


-- 4. Update Policies

-- SSO Logs
DROP POLICY IF EXISTS "Admins View SSO Logs" ON public.sso_audit_logs;
CREATE POLICY "Admins View SSO Logs" ON public.sso_audit_logs
  FOR SELECT
  USING (
    ((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.sso.read'))
    OR public.is_platform_admin()
    OR public.has_permission('platform.sso.read')
  );

-- Extension Permissions
DROP POLICY IF EXISTS "extension_permissions_delete_admin" ON public.extension_permissions;
CREATE POLICY "extension_permissions_delete_admin" ON public.extension_permissions
  FOR DELETE
  USING (public.is_platform_admin() OR public.has_permission('platform.extensions.delete'));

DROP POLICY IF EXISTS "extension_permissions_insert_admin" ON public.extension_permissions;
CREATE POLICY "extension_permissions_insert_admin" ON public.extension_permissions
  FOR INSERT
  WITH CHECK (public.is_platform_admin() OR public.has_permission('platform.extensions.create'));

DROP POLICY IF EXISTS "extension_permissions_update_admin" ON public.extension_permissions;
CREATE POLICY "extension_permissions_update_admin" ON public.extension_permissions
  FOR UPDATE
  USING (public.is_platform_admin() OR public.has_permission('platform.extensions.update'));

-- Extension RBAC
DROP POLICY IF EXISTS "extension_rbac_delete" ON public.extension_rbac_integration;
CREATE POLICY "extension_rbac_delete" ON public.extension_rbac_integration
  FOR DELETE
  USING (
    public.is_platform_admin()
    OR public.has_permission('platform.extensions.delete')
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
    OR public.has_permission('platform.extensions.create')
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
    OR public.has_permission('platform.extensions.update')
    OR EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = extension_rbac_integration.role_id
        AND r.tenant_id = public.current_tenant_id()
        AND public.is_admin_or_above()
    )
  );

-- Extension Routes Registry
DROP POLICY IF EXISTS "extension_routes_registry_select" ON public.extension_routes_registry;
CREATE POLICY "extension_routes_registry_select" ON public.extension_routes_registry
  FOR SELECT
  USING ((deleted_at IS NULL) AND (is_active = true OR public.is_platform_admin() OR public.has_permission('platform.extensions.read')));

-- CLEANUP
DROP FUNCTION public.seed_platform_permission(text, text, text);
