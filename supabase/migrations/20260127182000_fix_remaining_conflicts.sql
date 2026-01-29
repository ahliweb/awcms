SET client_min_messages TO warning;

-- Fix Remaining Advisor Conflicts

-- 1. Roles: Drop redundant unified/abac policies (superseded by hierarchy)
DROP POLICY IF EXISTS roles_update_unified ON public.roles;
DROP POLICY IF EXISTS roles_select_abac ON public.roles;
DROP POLICY IF EXISTS roles_insert_unified ON public.roles;
DROP POLICY IF EXISTS roles_delete_unified ON public.roles;

-- 2. Services: Fix Anon Duplicate Policy
-- "Public Read Published Services" matches anon.
-- "services_select_hierarchy" matched anon (implied public) -> Conflict.
-- Fix: Restrict services_select_hierarchy to authenticated users.

DO $$
BEGIN
  IF to_regclass('public.services') IS NOT NULL THEN
    -- Drop existing permissive policy
    DROP POLICY IF EXISTS services_select_hierarchy ON public.services;
    
    -- Recreate restricted to authenticated
    CREATE POLICY services_select_hierarchy
      ON public.services
      FOR SELECT
      TO authenticated
      USING (
        tenant_id = public.current_tenant_id()
        OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
        OR public.is_platform_admin()
      );
  END IF;
END $$;
