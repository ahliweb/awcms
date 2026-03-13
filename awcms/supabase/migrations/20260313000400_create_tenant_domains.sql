-- Migration: Create tenant_domains canonical registry
-- Phase 1 of the Deployment Cell Implementation Package v1

-- ============================================================
-- TABLE: tenant_domains
-- The canonical hostname registry for multi-tenancy. Every domain,
-- subdomain, admin, api, cdn, or preview hostname used by any tenant
-- must have a row here before it will be accepted by the runtime
-- resolution layer.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_domains (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL
                            REFERENCES public.tenants_control(id) ON DELETE CASCADE,
  cell_id                 UUID NOT NULL
                            REFERENCES public.deployment_cells(id),
  hostname                TEXT NOT NULL,
  domain_kind             TEXT NOT NULL
                            CHECK (domain_kind IN (
                              'platform_subdomain',
                              'custom_domain',
                              'admin_domain',
                              'api_domain',
                              'cdn_domain',
                              'preview_domain'
                            )),
  is_primary              BOOLEAN NOT NULL DEFAULT false,
  certificate_mode        TEXT,                        -- e.g. 'cloudflare_managed', 'lets_encrypt', 'custom'
  routing_mode            TEXT,                        -- e.g. 'proxied', 'direct', 'bypass'
  verification_status     TEXT NOT NULL DEFAULT 'pending'
                            CHECK (verification_status IN ('pending', 'verified', 'failed', 'revoked')),
  cloudflare_hostname_ref TEXT,                        -- Cloudflare Custom Hostname ID if applicable
  origin_hint             TEXT,                        -- IP or origin hostname for proxy config
  redirect_target         TEXT,                        -- if this hostname should redirect elsewhere
  notes                   TEXT,
  active_from             TIMESTAMPTZ,
  active_to               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hostname)
);

COMMENT ON TABLE public.tenant_domains IS
  'Canonical hostname registry. Every domain a tenant uses must have a verified entry here before it participates in runtime route resolution.';
COMMENT ON COLUMN public.tenant_domains.domain_kind IS
  'Controls how this hostname is classified at runtime (public app, admin panel, API endpoint, CDN, or preview).';
COMMENT ON COLUMN public.tenant_domains.is_primary IS
  'True for the single primary public domain (platform_subdomain or custom_domain) promoted by the tenant. Only one may be primary per tenant.';
COMMENT ON COLUMN public.tenant_domains.cloudflare_hostname_ref IS
  'Cloudflare Custom Hostname resource ID. Used for vanity domain SaaS profiles where Cloudflare manages per-hostname TLS.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_tenant_domains_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_domains_updated_at ON public.tenant_domains;
CREATE TRIGGER trg_tenant_domains_updated_at
  BEFORE UPDATE ON public.tenant_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.set_tenant_domains_updated_at();

-- Domain resolution index: lookup by hostname (the most critical hot path)
CREATE INDEX IF NOT EXISTS idx_tenant_domains_hostname
  ON public.tenant_domains(hostname);

-- Resolution filter: tenant + kind + verification + expiry
CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant_kind_active
  ON public.tenant_domains(tenant_id, domain_kind, verification_status, active_to);

-- Cell scope: list all domains for a cell
CREATE INDEX IF NOT EXISTS idx_tenant_domains_cell
  ON public.tenant_domains(cell_id);

-- ============================================================
-- Fix-up: add deferred FK from tenants_control.primary_domain_id
-- to tenant_domains.id (deferred because of the circular dependency:
-- tenant_domains references tenants_control AND tenants_control
-- will reference tenant_domains).
-- ============================================================

ALTER TABLE public.tenants_control
  ADD CONSTRAINT tenants_control_primary_domain_fk
  FOREIGN KEY (primary_domain_id)
  REFERENCES public.tenant_domains(id)
  DEFERRABLE INITIALLY DEFERRED;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage tenant_domains"
  ON public.tenant_domains FOR ALL
  USING (public.auth_is_platform_admin())
  WITH CHECK (public.auth_is_platform_admin());

-- Tenant members can read domains belonging to their own tenant
CREATE POLICY "Tenant members can read own tenant_domains"
  ON public.tenant_domains FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND tenant_id IN (
      SELECT tenant_id FROM public.users
      WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );

-- Tenant managers can update their own domains (verification_status, notes, etc)
-- but NOT cross-tenant domains — enforced by tenant_id check
CREATE POLICY "Tenant domain managers can update own domains"
  ON public.tenant_domains FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND tenant_id IN (
      SELECT tenant_id FROM public.users
      WHERE id = auth.uid() AND deleted_at IS NULL
    )
  );
