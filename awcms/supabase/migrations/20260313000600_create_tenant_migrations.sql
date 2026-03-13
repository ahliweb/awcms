-- Migration: Create tenant_migrations tracking table
-- Phase 1 of the Deployment Cell Implementation Package v1

-- ============================================================
-- TABLE: tenant_migrations
-- Records the lifecycle of every planned or in-progress move
-- of a tenant from one deployment cell to another. Required
-- for safe runbook execution and rollback window enforcement.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_migrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL
                          REFERENCES public.tenants_control(id) ON DELETE CASCADE,
  source_cell_id        UUID REFERENCES public.deployment_cells(id),
  target_cell_id        UUID REFERENCES public.deployment_cells(id),
  migration_kind        TEXT NOT NULL
                          CHECK (migration_kind IN (
                            'shared_to_dedicated_managed',
                            'dedicated_managed_to_hybrid',
                            'dedicated_managed_to_self_hosted',
                            'self_hosted_to_dedicated_managed',
                            'cell_upgrade',
                            'cell_downgrade',
                            'profile_only_change'
                          )),
  status                TEXT NOT NULL DEFAULT 'planned'
                          CHECK (status IN (
                            'planned',
                            'in_progress',
                            'validating',
                            'completed',
                            'rolled_back',
                            'failed'
                          )),
  planned_cutover_at    TIMESTAMPTZ,
  actual_cutover_at     TIMESTAMPTZ,
  rollback_deadline     TIMESTAMPTZ,
  operator_notes        TEXT,
  rollback_owner        TEXT,          -- name or ID of who is responsible for rollback decisions
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_migrations IS
  'Tracking table for tenant cell migrations / service-profile changes that require infrastructure moves. Each runbook execution corresponds to one row. Must define rollback_deadline before marking in_progress.';
COMMENT ON COLUMN public.tenant_migrations.migration_kind IS
  'Corresponds to Runbooks A–D in the Deployment Cell Implementation Package spec.';
COMMENT ON COLUMN public.tenant_migrations.rollback_deadline IS
  'After this timestamp, rollback to the source cell is no longer guaranteed. Required before status transitions to in_progress.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_tenant_migrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_migrations_updated_at ON public.tenant_migrations;
CREATE TRIGGER trg_tenant_migrations_updated_at
  BEFORE UPDATE ON public.tenant_migrations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_migrations_updated_at();

-- Index: list migrations per tenant
CREATE INDEX IF NOT EXISTS idx_tenant_migrations_tenant
  ON public.tenant_migrations(tenant_id, status, created_at DESC);

-- Index: list migrations per source/target cell
CREATE INDEX IF NOT EXISTS idx_tenant_migrations_cells
  ON public.tenant_migrations(source_cell_id, target_cell_id);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.tenant_migrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage tenant_migrations"
  ON public.tenant_migrations FOR ALL
  USING (public.auth_is_platform_admin())
  WITH CHECK (public.auth_is_platform_admin());

-- Tenant members can read migrations for their own tenant (visibility for status updates)
CREATE POLICY "Tenant members can read own tenant_migrations"
  ON public.tenant_migrations FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND tenant_id IN (
      SELECT tenant_id FROM public.users
      WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );
