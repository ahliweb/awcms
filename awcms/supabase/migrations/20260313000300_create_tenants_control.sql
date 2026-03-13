-- Migration: Create tenants_control control-plane table
-- Phase 1 of the Deployment Cell Implementation Package v1
--
-- NOTE: This is a CONTROL-PLANE table named `tenants_control` to avoid
-- colliding with the existing tenant-scoped `tenants` application table
-- (if one exists). It tracks the commercial and infrastructure identity
-- of a tenant across all deployment cells.

-- ============================================================
-- TABLE: tenants_control
-- The canonical commercial tenant record. Links a business entity
-- to a project, a deployment cell, and a primary domain.
-- primary_domain_id FK is added via a deferred constraint in a later
-- migration once tenant_domains exists.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenants_control (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL
                     REFERENCES public.platform_projects(id) ON DELETE CASCADE,
  tenant_code      TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN (
                       'draft', 'active', 'suspended', 'migrating', 'archived'
                     )),
  current_cell_id  UUID REFERENCES public.deployment_cells(id),
  -- primary_domain_id added after tenant_domains is created (deferred FK migration)
  primary_domain_id UUID,
  billing_model    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, tenant_code)
);

COMMENT ON TABLE public.tenants_control IS
  'Control-plane tenant registry. Tracks commercial tenant identity, current cell assignment, and primary domain. Distinct from any application-level tenant settings table.';
COMMENT ON COLUMN public.tenants_control.tenant_code IS
  'Short, immutable code used to identify this tenant in object keys and internal routing. Must not change after creation.';
COMMENT ON COLUMN public.tenants_control.status IS
  'migrating: tenant is mid-way through a cell migration. Mutations to routing, domain, or service-profile require elevated checks.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_tenants_control_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_control_updated_at ON public.tenants_control;
CREATE TRIGGER trg_tenants_control_updated_at
  BEFORE UPDATE ON public.tenants_control
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenants_control_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.tenants_control ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage tenants_control"
  ON public.tenants_control FOR ALL
  USING (public.auth_is_platform_admin())
  WITH CHECK (public.auth_is_platform_admin());

-- Tenant members can read their own record
CREATE POLICY "Tenant members can read their own tenants_control row"
  ON public.tenants_control FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND id IN (
      SELECT tenant_id FROM public.users
      WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );
