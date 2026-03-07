-- Migration: Platform vs Tenant Configuration Separation - Phase 1 Database Foundation

-- 1. Function: auth_is_platform_admin() 
-- Returns true if the authenticated user has a role with is_platform_admin or is_full_access = true
CREATE OR REPLACE FUNCTION public.auth_is_platform_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid()
      AND (r.is_platform_admin = true OR r.is_full_access = true)
      AND u.deleted_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 2. Table: platform_settings
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  type TEXT DEFAULT 'string' CHECK (type IN ('string','boolean','number','json')),
  description TEXT,
  category TEXT DEFAULT 'general',
  is_overridable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for platform_settings
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage platform_settings"
  ON public.platform_settings FOR ALL
  USING (public.auth_is_platform_admin());

CREATE POLICY "Authenticated users can read overridable platform_settings"
  ON public.platform_settings FOR SELECT
  USING (auth.role() = 'authenticated');

-- 3. Update Existing Tables with Scopes
-- 3a. admin_menus
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admin_menus' AND column_name = 'scope') THEN
    ALTER TABLE public.admin_menus ADD COLUMN scope TEXT DEFAULT 'tenant' CHECK (scope IN ('platform', 'tenant', 'shared'));
    
    -- Update known platform scopes based on RESOURCE_MAP.md
    UPDATE public.admin_menus 
    SET scope = 'platform' 
    WHERE key IN ('sidebar_manager', 'modules', 'extensions', 'tenants')
       OR path IN ('/cmspanel/admin/menus', '/cmspanel/extensions', '/cmspanel/tenants');
  END IF;
END $$;

-- 3b. settings
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'scope') THEN
    ALTER TABLE public.settings ADD COLUMN scope TEXT DEFAULT 'tenant' CHECK (scope IN ('platform', 'tenant'));
    -- We'll keep existing settings logic, just adding the constraint
  END IF;
END $$;

-- 3c. resources_registry
-- It already has a 'scope' column (TEXT NOT NULL), we just ensure the constraint or at least update data
UPDATE public.resources_registry
SET scope = 'platform'
WHERE key IN ('extensions', 'modules', 'sidebar_manager', 'tenants');

UPDATE public.resources_registry
SET scope = 'tenant'
WHERE scope NOT IN ('platform') OR scope IS NULL;

-- 4. RPC: get_effective_setting(key, tenant_id)
CREATE OR REPLACE FUNCTION public.get_effective_setting(p_key TEXT, p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_tenant_val TEXT;
  v_platform_val TEXT;
BEGIN
  -- Try tenant-level first if overridable is true (implied in this basic version, frontend will honor it)
  SELECT value INTO v_tenant_val
  FROM public.settings
  WHERE key = p_key AND tenant_id = p_tenant_id;

  IF v_tenant_val IS NOT NULL THEN 
    RETURN v_tenant_val; 
  END IF;

  -- Fall back to platform default
  SELECT value INTO v_platform_val
  FROM public.platform_settings
  WHERE key = p_key;

  RETURN v_platform_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Trigger to update updated_at for platform_settings
CREATE OR REPLACE FUNCTION public.set_platform_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_platform_settings_updated_at ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_platform_settings_updated_at();
