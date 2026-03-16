-- Migration: Create deployment_cells control-plane table
-- Phase 1 of the Deployment Cell Implementation Package v1

-- ============================================================
-- TABLE: deployment_cells
-- Represents a specific runtime environment instance within a
-- project. Combines Cloudflare runtime/zone and
-- Supabase project reference into a single auditable record.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deployment_cells (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL
                            REFERENCES public.platform_projects(id) ON DELETE CASCADE,
  environment             TEXT NOT NULL
                            CHECK (environment IN ('production', 'staging', 'preview', 'development')),
  service_profile         TEXT NOT NULL
                            CHECK (service_profile IN (
                              'shared_managed',
                              'dedicated_managed',
                              'dedicated_hybrid',
                              'dedicated_self_hosted',
                              'vanity_domain_saas'
                            )),
  -- Cloudflare
  cloudflare_account_ref  TEXT,
  cloudflare_zone_ref     TEXT,
  edge_profile_id         UUID,
  -- Supabase / Data plane
  supabase_mode           TEXT NOT NULL
                            CHECK (supabase_mode IN ('managed', 'self_hosted')),
  supabase_project_ref    TEXT,
  -- Runtime metadata
  linode_region           TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'provisioning', 'active', 'maintenance', 'decommissioned')),
  ops_owner_type          TEXT,
  ops_owner_id            UUID,
  billing_owner_type      TEXT,
  billing_owner_id        UUID,
  runtime_capacity_class  TEXT,
  notes                   TEXT,
  decommission_after      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.deployment_cells IS
  'A specific runtime environment instance within a project. Binds Cloudflare and Supabase references together. A tenant is always associated with exactly one active cell.';

-- Index for efficient cell queries per project+environment
CREATE INDEX IF NOT EXISTS idx_deployment_cells_project_env
  ON public.deployment_cells(project_id, environment, status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_deployment_cells_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deployment_cells_updated_at ON public.deployment_cells;
CREATE TRIGGER trg_deployment_cells_updated_at
  BEFORE UPDATE ON public.deployment_cells
  FOR EACH ROW
  EXECUTE FUNCTION public.set_deployment_cells_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.deployment_cells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage deployment_cells"
  ON public.deployment_cells FOR ALL
  USING (public.auth_is_platform_admin())
  WITH CHECK (public.auth_is_platform_admin());

-- NOTE: The SELECT policy for tenant members (which references tenants_control)
-- is added in migration 20260313000800_cross_table_rls_policies.sql after all
-- control-plane tables have been created.
