-- Migration: Create tenant_service_contracts table
-- Phase 1 of the Deployment Cell Implementation Package v1

-- ============================================================
-- TABLE: tenant_service_contracts
-- Records the historical log of service profile assignments for
-- a tenant. The most recent row with the greatest effective_at
-- is the current contract. This table is append-only — never
-- update a past contract row.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_service_contracts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL
                             REFERENCES public.tenants_control(id) ON DELETE CASCADE,
  service_profile          TEXT NOT NULL
                             CHECK (service_profile IN (
                               'shared_managed',
                               'dedicated_managed',
                               'dedicated_hybrid',
                               'dedicated_self_hosted',
                               'vanity_domain_saas'
                             )),
  runtime_isolation_level  TEXT NOT NULL
                             CHECK (runtime_isolation_level IN ('shared', 'scoped', 'dedicated')),
  data_isolation_level     TEXT NOT NULL
                             CHECK (data_isolation_level IN ('shared', 'dedicated')),
  edge_isolation_level     TEXT NOT NULL
                             CHECK (edge_isolation_level IN ('shared', 'byod', 'dedicated')),
  backup_tier              TEXT,          -- e.g. 'none', 'daily', 'hourly', 'continuous'
  support_tier             TEXT,          -- e.g. 'self_serve', 'standard', 'enterprise'
  effective_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
  -- This table is intentionally NOT editable after insert.
  -- Service profile changes are additive: insert a new row with a new effective_at.
);

COMMENT ON TABLE public.tenant_service_contracts IS
  'Append-only ledger of service profile assignments. The row with the highest effective_at is the current contract. Must not be updated after insert.';
COMMENT ON COLUMN public.tenant_service_contracts.service_profile IS
  'Maps to the ServiceProfile enum in src/lib/tenancy/serviceProfile.js. Controls runtime, data, and edge isolation behavior.';

-- Lookup index: most-recent contract per tenant
CREATE INDEX IF NOT EXISTS idx_tenant_service_contracts_tenant_effective
  ON public.tenant_service_contracts(tenant_id, effective_at DESC);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.tenant_service_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage tenant_service_contracts"
  ON public.tenant_service_contracts FOR ALL
  USING (public.auth_is_platform_admin())
  WITH CHECK (public.auth_is_platform_admin());

-- Tenant members can read their own contracts (read-only; no update/delete for tenants)
CREATE POLICY "Tenant members can read own service_contracts"
  ON public.tenant_service_contracts FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND tenant_id IN (
      SELECT tenant_id FROM public.users
      WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );
