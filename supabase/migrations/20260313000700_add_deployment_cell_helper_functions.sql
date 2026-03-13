-- Migration: DB helper functions for deployment-cell tenancy resolution
-- Phase 1 of the Deployment Cell Implementation Package v1
--
-- Provides RPC and helper functions needed by the runtime resolution
-- layer to look up tenant context, verify domain ownership, and power
-- the ABAC permission checks on new control-plane tables.

-- ============================================================
-- FUNCTION: is_platform_admin()
-- Returns true if the current user is a platform admin.
-- Wraps auth_is_platform_admin() with deployment-cell awareness.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Delegate to the existing platform admin check
  RETURN public.auth_is_platform_admin();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- FUNCTION: current_tenant_control_id()
-- Returns the tenants_control.id for the authenticated user
-- by looking up users.tenant_id and joining to tenants_control.
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_tenant_control_id()
RETURNS UUID AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT tc.id INTO v_tenant_id
  FROM public.users u
  JOIN public.tenants_control tc ON tc.id = u.tenant_id
  WHERE u.id = auth.uid()
    AND u.deleted_at IS NULL
  LIMIT 1;
  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- FUNCTION: current_project_id()
-- Returns the platform_projects.id for the authenticated user's tenant.
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_project_id()
RETURNS UUID AS $$
DECLARE
  v_project_id UUID;
BEGIN
  SELECT tc.project_id INTO v_project_id
  FROM public.users u
  JOIN public.tenants_control tc ON tc.id = u.tenant_id
  WHERE u.id = auth.uid()
    AND u.deleted_at IS NULL
  LIMIT 1;
  RETURN v_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- FUNCTION: can_manage_domain(p_tenant_id UUID)
-- Returns true if the current user can perform domain operations
-- on the given tenant.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_domain(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Platform admins can manage any domain
  IF public.auth_is_platform_admin() THEN
    RETURN true;
  END IF;

  -- Users may manage domains for their own tenant only
  RETURN EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.tenant_id = p_tenant_id
      AND u.deleted_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- FUNCTION: can_manage_cell(p_cell_id UUID)
-- Returns true if the current user can perform operations on
-- the given deployment cell.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_cell(p_cell_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Only platform admins may manage cells
  RETURN public.auth_is_platform_admin();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- RPC: resolve_tenant_by_hostname(p_hostname TEXT)
-- Primary lookup used by the AWCMS runtime resolver.
-- Returns a single JSON object with full context for the hostname.
-- Returns NULL if:
--   - hostname is not found in tenant_domains
--   - domain is not verified
--   - domain has expired (active_to < now)
--   - deployment cell is not active
--   - tenant is not active
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_tenant_by_hostname(p_hostname TEXT)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
  v_hostname TEXT := lower(trim(p_hostname));
BEGIN
  SELECT json_build_object(
    'projectId',      pp.id,
    'tenantId',       tc.id,
    'tenantCode',     tc.tenant_code,
    'tenantStatus',   tc.status,
    'cellId',         dc.id,
    'serviceProfile', dc.service_profile,
    'domainId',       td.id,
    'hostname',       td.hostname,
    'domainKind',     td.domain_kind,
    'isPrimary',      td.is_primary,
    'name',           tc.display_name
  ) INTO v_result
  FROM public.tenant_domains td
  JOIN public.tenants_control tc ON tc.id = td.tenant_id
  JOIN public.deployment_cells dc ON dc.id = td.cell_id
  JOIN public.platform_projects pp ON pp.id = tc.project_id
  WHERE td.hostname = v_hostname
    AND td.verification_status = 'verified'
    AND (td.active_from IS NULL OR td.active_from <= now())
    AND (td.active_to IS NULL OR td.active_to > now())
    AND dc.status = 'active'
    AND tc.status = 'active'
  LIMIT 1;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION public.resolve_tenant_by_hostname(TEXT) IS
  'Primary RPC for the AWCMS runtime tenant resolver. Returns a canonical JSON context object or NULL. NULL means: unknown, inactive, or expired hostname → apply 404/fallback policy.';

-- ============================================================
-- Update task.md cross-reference: confirm RPC matches spec §10.1
-- ============================================================
-- TenantResolutionResult fields from spec §10.1:
--   projectId ✓  tenantId ✓  tenantCode ✓  tenantStatus ✓
--   cellId ✓  serviceProfile ✓  domainId ✓  hostname ✓
--   routeClass (derived client-side from domainKind) ✓  isPrimary ✓
