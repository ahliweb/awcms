-- Migration: Cross-table RLS policies for control-plane tables
-- Must run AFTER all control-plane tables are created (migrations 000100–000700).
--
-- These policies reference multiple tables and therefore cannot be placed in
-- the individual table creation migrations without causing dependency errors.

-- ============================================================
-- platform_projects: tenant-member read access
-- Users can see the project that their tenant belongs to.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_projects'
      AND policyname = 'Authenticated users can read their platform_project'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Authenticated users can read their platform_project"
        ON public.platform_projects FOR SELECT
        USING (
          auth.role() = 'authenticated'
          AND EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.deleted_at IS NULL
              AND u.tenant_id IN (
                SELECT id FROM public.tenants_control
                WHERE project_id = public.platform_projects.id
              )
          )
        )
    $policy$;
  END IF;
END $$;

-- ============================================================
-- deployment_cells: tenant-member read access
-- Users can see the cell their tenant is currently assigned to.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deployment_cells'
      AND policyname = 'Tenant members can read their active cell'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Tenant members can read their active cell"
        ON public.deployment_cells FOR SELECT
        USING (
          auth.role() = 'authenticated'
          AND id IN (
            SELECT current_cell_id FROM public.tenants_control
            WHERE id IN (
              SELECT tenant_id FROM public.users
              WHERE id = auth.uid() AND deleted_at IS NULL
            )
          )
        )
    $policy$;
  END IF;
END $$;
