-- Add missing indexes on foreign key columns (created_by)
-- Identified by the Supabase Performance Advisor
-- These indexes improve JOIN and DELETE CASCADE performance

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'created_by'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_profiles_created_by ON public.user_profiles (created_by)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profile_admin'
      AND column_name = 'created_by'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_profile_admin_created_by ON public.user_profile_admin (created_by)';
  END IF;

END;
$$ LANGUAGE plpgsql;
