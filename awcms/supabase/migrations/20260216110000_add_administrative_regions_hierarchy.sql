-- Migration: Add Administrative Region Hierarchy (Indonesian)
-- Objective: Implement Indonesian administrative hierarchy and allow users to be assigned to it.

SET client_min_messages TO warning;

-- 1. Create Administrative Regions Table (Indonesian: Wilayah)
CREATE TABLE IF NOT EXISTS public.administrative_regions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL, -- e.g., '32', '32.04', '32.04.05'
  name text NOT NULL, -- e.g., 'JAWA BARAT', 'BANDUNG'
  level text NOT NULL CHECK (level IN ('provinsi', 'kabupaten', 'kota', 'kecamatan', 'kelurahan', 'desa')),
  parent_id uuid REFERENCES public.administrative_regions(id) ON DELETE SET NULL,
  
  -- Metadata from cahyadsn/wilayah
  postal_code text,
  latitude numeric,
  longitude numeric,
  
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE (code)
);

-- Index for parent/hierarchy lookups and code lookups
CREATE INDEX IF NOT EXISTS idx_admin_regions_parent_id ON public.administrative_regions(parent_id);
CREATE INDEX IF NOT EXISTS idx_admin_regions_code ON public.administrative_regions(code);
CREATE INDEX IF NOT EXISTS idx_admin_regions_level ON public.administrative_regions(level);

-- 2. Add Administrative Region Assignment to Users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS administrative_region_id uuid REFERENCES public.administrative_regions(id) ON DELETE SET NULL;

-- Index for user admin region lookups
CREATE INDEX IF NOT EXISTS idx_users_admin_region_id ON public.users(administrative_region_id);

-- 3. RLS Policies for Administrative Regions
ALTER TABLE public.administrative_regions ENABLE ROW LEVEL SECURITY;

-- Everyone can read active regions
DROP POLICY IF EXISTS "admin_regions_select_all" ON public.administrative_regions;
CREATE POLICY "admin_regions_select_all" ON public.administrative_regions
  FOR SELECT
  USING (is_active = true OR public.is_platform_admin());

-- Only Platform Admins can manage regions (System data)
DROP POLICY IF EXISTS "admin_regions_insert_admin" ON public.administrative_regions;
CREATE POLICY "admin_regions_insert_admin" ON public.administrative_regions
  FOR INSERT
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "admin_regions_update_admin" ON public.administrative_regions;
CREATE POLICY "admin_regions_update_admin" ON public.administrative_regions
  FOR UPDATE
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "admin_regions_delete_admin" ON public.administrative_regions;
CREATE POLICY "admin_regions_delete_admin" ON public.administrative_regions
  FOR DELETE
  USING (public.is_platform_admin());

-- 4. Trigger for Updated At
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON public.administrative_regions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
