-- Migration: Add soft delete to RBAC tables (role_permissions, role_policies, policies)
-- Description: Align RBAC tables with deleted_at usage and update RLS to ignore soft-deleted rows.

-- 1) Add deleted_at columns + indexes
DO $$
BEGIN
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
END $$;

-- 2) RLS policy alignment for soft delete
DO $$
BEGIN
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
END $$;
