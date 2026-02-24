-- Migration: Seed primary tenant (if missing)
-- Purpose: Ensure the primary tenant exists for dev defaults and admin tooling.

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'primary';

  IF v_tenant_id IS NULL THEN
    PERFORM public.create_tenant_with_defaults(
      'Primary Tenant'::text,
      'primary'::text,
      'primary'::text,
      'enterprise'::text,
      NULL::uuid,
      'auto'::text
    );
  END IF;
END $$;
