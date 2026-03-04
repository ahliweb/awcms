-- Migration to harden settings RLS: Only platform admins can modify 'platform' scoped settings
-- Regular tenant admins can only modify 'tenant' and 'shared' scoped settings

-- Update the existing can_manage_settings() function if needed, or add specific RLS policies
-- Since RLS policies apply on top of existing ones, we can just add a restrictive policy or update the existing one.

-- The settings table has tenant_hierarchy_resource_sharing policies, let's look at how they protect the rows.
-- Wait, the simplest way to prevent non-platform admins from updating/deleting/inserting platform settings is to use a TRIGGER or a restrictive policy.
-- A BEFORE trigger might be safer and universally applied.

-- Let's create a trigger to prevent non-platform admins from modifying platform settings.
CREATE OR REPLACE FUNCTION public.harden_platform_settings_rls()
RETURNS TRIGGER AS $$
BEGIN
  -- If the setting scope is 'platform'
  IF (TG_OP = 'INSERT' AND NEW.scope = 'platform') OR 
     (TG_OP = 'UPDATE' AND (NEW.scope = 'platform' OR OLD.scope = 'platform')) OR 
     (TG_OP = 'DELETE' AND OLD.scope = 'platform') THEN
    
    -- Check if the user is a platform admin
    IF NOT public.auth_is_platform_admin() THEN
      RAISE EXCEPTION 'Only Platform Admins can modify platform-scoped settings.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS harden_platform_settings_trigger ON public.settings;

-- Create trigger
CREATE TRIGGER harden_platform_settings_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.harden_platform_settings_rls();
