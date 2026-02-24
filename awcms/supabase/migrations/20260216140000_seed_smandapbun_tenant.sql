-- Migration: Seed smandapbun tenant (if missing)
-- Purpose: Ensure the smandapbun tenant exists before tenant-specific seeds run.

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM public.tenants WHERE slug = 'smandapbun';

  IF v_tenant_id IS NULL THEN
    PERFORM public.create_tenant_with_defaults(
      'SMAN 2 Pangkalan Bun'::text,
      'smandapbun'::text,
      'sman2pangkalanbun.sch.id'::text,
      'enterprise'::text,
      NULL::uuid,
      'auto'::text
    );
  END IF;
END $$;
