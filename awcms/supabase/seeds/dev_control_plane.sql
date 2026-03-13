-- =============================================================
-- Dev Control-Plane Seed
-- File: supabase/seeds/dev_control_plane.sql
--
-- Seeds the control-plane tables (platform_projects, deployment_cells,
-- tenants_control, tenant_domains) for LOCAL DEVELOPMENT only.
--
-- KEY DESIGN DECISIONS:
-- 1. tenants_control is inserted with the same UUID as the existing
--    tenants row (slug='primary'). This ensures setGlobalTenantId()
--    in TenantContext continues to match the application RLS policies
--    which resolve via users.tenant_id.
-- 2. 'localhost' is registered as a verified domain so
--    resolve_tenant_by_hostname('localhost') returns a full context.
-- 3. All rows use IF NOT EXISTS / ON CONFLICT guards so this script
--    is idempotent — safe to run multiple times.
--
-- TO APPLY:
--   psql "$LOCAL_DB_URL" -f supabase/seeds/dev_control_plane.sql
--   or via Supabase Studio > SQL Editor
-- =============================================================

DO $$
DECLARE
  v_app_tenant_id     UUID;
  v_project_id        UUID;
  v_cell_id           UUID;
  v_domain_id         UUID;
BEGIN

  -- -------------------------------------------------------
  -- Step 1: Lookup the existing application tenant by slug
  -- -------------------------------------------------------
  SELECT id INTO v_app_tenant_id
  FROM public.tenants
  WHERE slug = current_setting('app.dev_tenant_slug', true)
           ::text
  LIMIT 1;

  -- Fallback: pick the first tenant if slug setting not provided
  IF v_app_tenant_id IS NULL THEN
    SELECT id INTO v_app_tenant_id
    FROM public.tenants
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_app_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Dev seed: no tenant found in public.tenants. '
                    'Create at least one application tenant first.';
  END IF;

  RAISE NOTICE 'Dev seed: using app tenant id = %', v_app_tenant_id;

  -- -------------------------------------------------------
  -- Step 2: platform_projects — one project for local dev
  -- -------------------------------------------------------
  INSERT INTO public.platform_projects (
    id, code, name, status, default_region
  )
  VALUES (
    gen_random_uuid(),
    'awcms-dev',
    'AWCMS Local Development',
    'active',
    'local'
  )
  ON CONFLICT (code) DO NOTHING
  RETURNING id INTO v_project_id;

  -- If already existed, look it up
  IF v_project_id IS NULL THEN
    SELECT id INTO v_project_id
    FROM public.platform_projects
    WHERE code = 'awcms-dev';
  END IF;

  RAISE NOTICE 'Dev seed: project_id = %', v_project_id;

  -- -------------------------------------------------------
  -- Step 3: deployment_cells — local dev cell
  -- -------------------------------------------------------
  INSERT INTO public.deployment_cells (
    id, project_id, environment, service_profile,
    coolify_mode, supabase_mode,
    status, notes
  )
  VALUES (
    gen_random_uuid(),
    v_project_id,
    'development',
    'shared_managed',
    'self_hosted',
    'managed',
    'active',
    'Local development cell. Seeded automatically by dev_control_plane.sql.'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_cell_id;

  -- If already existed, look it up
  IF v_cell_id IS NULL THEN
    SELECT id INTO v_cell_id
    FROM public.deployment_cells
    WHERE project_id = v_project_id
      AND environment = 'development'
    LIMIT 1;
  END IF;

  RAISE NOTICE 'Dev seed: cell_id = %', v_cell_id;

  -- -------------------------------------------------------
  -- Step 4: tenants_control
  -- Use the existing app tenant UUID as the id so that
  -- setGlobalTenantId() keeps working with existing RLS policies.
  -- -------------------------------------------------------
  INSERT INTO public.tenants_control (
    id, project_id, tenant_code, display_name,
    status, current_cell_id, billing_model
  )
  SELECT
    v_app_tenant_id,             -- same UUID as tenants.id
    v_project_id,
    t.slug,
    t.name,
    'active',
    v_cell_id,
    'self_serve'
  FROM public.tenants t
  WHERE t.id = v_app_tenant_id
  ON CONFLICT (id) DO UPDATE
    SET current_cell_id = EXCLUDED.current_cell_id,
        status = 'active';

  RAISE NOTICE 'Dev seed: tenants_control upserted for id = %', v_app_tenant_id;

  -- -------------------------------------------------------
  -- Step 5: tenant_domains — register 'localhost'
  -- -------------------------------------------------------
  INSERT INTO public.tenant_domains (
    id, tenant_id, cell_id,
    hostname, domain_kind,
    is_primary, verification_status,
    certificate_mode, routing_mode,
    notes
  )
  VALUES (
    gen_random_uuid(),
    v_app_tenant_id,
    v_cell_id,
    'localhost',
    'platform_subdomain',
    true,
    'verified',           -- pre-verified for dev
    'none',
    'direct',
    'Auto-seeded for local development. Resolves platform_subdomain → routeClass.PUBLIC.'
  )
  ON CONFLICT (hostname) DO UPDATE
    SET tenant_id           = EXCLUDED.tenant_id,
        cell_id             = EXCLUDED.cell_id,
        verification_status = 'verified',
        domain_kind         = 'platform_subdomain',
        is_primary          = true
  RETURNING id INTO v_domain_id;

  IF v_domain_id IS NULL THEN
    SELECT id INTO v_domain_id
    FROM public.tenant_domains WHERE hostname = 'localhost';
  END IF;

  RAISE NOTICE 'Dev seed: domain_id = %', v_domain_id;

  -- -------------------------------------------------------
  -- Step 6: Set primary_domain_id on tenants_control
  -- -------------------------------------------------------
  UPDATE public.tenants_control
  SET primary_domain_id = v_domain_id
  WHERE id = v_app_tenant_id;

  -- -------------------------------------------------------
  -- Step 7: tenant_service_contracts — initial contract
  -- -------------------------------------------------------
  INSERT INTO public.tenant_service_contracts (
    tenant_id, service_profile,
    runtime_isolation_level, data_isolation_level, edge_isolation_level,
    backup_tier, support_tier
  )
  SELECT
    v_app_tenant_id,
    'shared_managed',
    'shared', 'shared', 'shared',
    'none', 'self_serve'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tenant_service_contracts
    WHERE tenant_id = v_app_tenant_id
  );

  RAISE NOTICE 'Dev seed: complete for tenant = %', v_app_tenant_id;

END $$;
