-- Migration: Add Region Hierarchy and User Assignment
-- Objective: Implement 10-level region hierarchy and allow users to be assigned to regions.

SET client_min_messages TO warning;

-- 0. Define Trigger Function (if not exists)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Create Regions Table
CREATE TABLE IF NOT EXISTS public.regions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  level integer NOT NULL CHECK (level BETWEEN 1 AND 10),
  parent_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (slug)
);

-- Index for parent/hierarchy lookups
CREATE INDEX IF NOT EXISTS idx_regions_parent_id ON public.regions(parent_id);

-- 2. Add Region Assignment to Users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL;

-- Index for user region lookups
CREATE INDEX IF NOT EXISTS idx_users_region_id ON public.users(region_id);

-- 3. RLS Policies for Regions
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

-- Everyone can read active regions
DROP POLICY IF EXISTS "regions_select_all" ON public.regions;
CREATE POLICY "regions_select_all" ON public.regions
  FOR SELECT
  USING (is_active = true OR public.is_platform_admin());

-- Only Platform Admins can manage regions
DROP POLICY IF EXISTS "regions_insert_admin" ON public.regions;
CREATE POLICY "regions_insert_admin" ON public.regions
  FOR INSERT
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "regions_update_admin" ON public.regions;
CREATE POLICY "regions_update_admin" ON public.regions
  FOR UPDATE
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "regions_delete_admin" ON public.regions;
CREATE POLICY "regions_delete_admin" ON public.regions
  FOR DELETE
  USING (public.is_platform_admin());

-- 4. Seed basic levels (Conceptual Placeholders)
-- Optional: We can insert the 10 level definitions if we had a separate 'region_levels' metadata table, 
-- but requested requirement is just the regions table itself with level constraint.

-- 5. Trigger for Updated At
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON public.regions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
