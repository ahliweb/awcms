-- Drop Zombie Policies on public.services
-- These policies conflict with services_select_hierarchy etc.

DO $$
BEGIN
  IF to_regclass('public.services') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Tenant Select Services" ON public.services;
    DROP POLICY IF EXISTS "Tenant Insert Services" ON public.services;
    DROP POLICY IF EXISTS "Tenant Update Services" ON public.services;
    DROP POLICY IF EXISTS "Tenant Delete Services" ON public.services; -- Just in case
  END IF;
END $$;
