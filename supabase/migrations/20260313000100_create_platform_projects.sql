-- Migration: Create platform_projects control-plane table
-- Phase 1 of the Deployment Cell Implementation Package v1

-- ============================================================
-- TABLE: platform_projects
-- Represents the top-level umbrella for a multi-tenant product
-- deployment. One project can have many cells, many tenants.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_projects (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'archived')),
  default_region          TEXT,
  default_edge_profile_id UUID,            -- future FK to edge_profiles if implemented
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_projects IS
  'Top-level project container. One project maps to one commercial product deployment that may span many deployment cells and tenants.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_platform_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_platform_projects_updated_at ON public.platform_projects;
CREATE TRIGGER trg_platform_projects_updated_at
  BEFORE UPDATE ON public.platform_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_platform_projects_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.platform_projects ENABLE ROW LEVEL SECURITY;

-- Platform admins retain full access
CREATE POLICY "Platform admins manage platform_projects"
  ON public.platform_projects FOR ALL
  USING (public.auth_is_platform_admin())
  WITH CHECK (public.auth_is_platform_admin());

-- NOTE: The SELECT policy for authenticated tenant members references
-- tenants_control (created in migration 000300). It is added in
-- migration 20260313000800_cross_table_rls_policies.sql after all
-- control-plane tables have been created.
