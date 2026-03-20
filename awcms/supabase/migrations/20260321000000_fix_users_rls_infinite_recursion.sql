-- =============================================================================
-- Fix: Infinite recursion in public.users RLS policies
--
-- Root cause: the users_update_hierarchy policy contains an EXISTS subquery
-- that joins public.users (to check the caller's role/permissions) while the
-- RLS engine is already evaluating a policy ON public.users → recursion.
--
-- Fix: Extract the permission check into a SECURITY DEFINER function with
-- row_security = off, then rewrite both users SELECT and UPDATE policies to
-- use only safe (SECURITY DEFINER / init-plan wrapped) helpers.
-- =============================================================================

SET client_min_messages TO warning;

-- ---------------------------------------------------------------------------
-- 1. SECURITY DEFINER helper: caller_has_permission(permission_name text)
--    Returns true if auth.uid() has the named permission via their role.
--    row_security = off prevents re-entering RLS on public.users.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caller_has_permission(p_permission_name text)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  SET row_security = off
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    JOIN public.users u       ON u.role_id = rp.role_id
    WHERE u.id         = auth.uid()
      AND u.deleted_at IS NULL
      AND p.name       = p_permission_name
  );
END;
$$;

COMMENT ON FUNCTION public.caller_has_permission(text) IS
  'SECURITY DEFINER (row_security=off) permission check — safe to call from RLS policies on public.users.';

-- ---------------------------------------------------------------------------
-- 2. Rebuild users_select_hierarchy using only SECURITY DEFINER helpers
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_select_hierarchy ON public.users;

CREATE POLICY users_select_hierarchy ON public.users
  FOR SELECT
  USING (
    (SELECT public.is_platform_admin())
    OR tenant_id = (SELECT public.current_tenant_id())
    OR public.tenant_can_access_resource(tenant_id, 'users', 'read')
  );

-- ---------------------------------------------------------------------------
-- 3. Rebuild users_update_hierarchy — replace recursive EXISTS with helper
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS users_update_hierarchy ON public.users;

CREATE POLICY users_update_hierarchy ON public.users
  FOR UPDATE
  USING (
    -- Platform admin: full access
    (SELECT public.is_platform_admin())
    OR (
      -- Same tenant: self-update OR caller has tenant.user.update permission
      tenant_id = (SELECT public.current_tenant_id())
      AND (
        id = (SELECT auth.uid())
        OR (SELECT public.caller_has_permission('tenant.user.update'))
      )
    )
    -- Cross-tenant hierarchical access
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
  );
