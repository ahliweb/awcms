-- Migration: Register 'modules' resource in tenant_resource_registry
-- Timestamp: 20260207100000

DO $$
BEGIN
  -- Insert 'modules' into registry if it doesn't exist
  INSERT INTO public.tenant_resource_registry (resource_key, description, default_share_mode, default_access_mode)
  VALUES ('modules', 'System modules and feature activation', 'shared_descendants', 'read_write')
  ON CONFLICT (resource_key) DO UPDATE
  SET default_share_mode = 'shared_descendants',
      default_access_mode = 'read_write';

  -- Refresh rules for all existing tenants
  PERFORM public.seed_tenant_resource_rules(id) FROM public.tenants;

END $$;
