-- Migration: Fix RLS with Security Definer
-- Date: 2026-01-20
-- Description: Introduces a security definer function to safely check admin status for RLS policies, avoiding recursion or access issues.

-- 1. Create a secure function to check if the current user is an admin/owner
-- SECURITY DEFINER: Runs with the privileges of the creator (postgres/admin), bypassing RLS on underlying tables.
CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public -- Secure search path
AS $$
DECLARE
  current_role_name text;
BEGIN
  -- Get the role name of the current user
  SELECT r.name INTO current_role_name
  FROM public.users u
  JOIN public.roles r ON u.role_id = r.id
  WHERE u.id = auth.uid();

  -- Return true if role is owner, super_admin, or admin
  RETURN current_role_name IN ('owner', 'super_admin', 'admin');
END;
$$;

-- 2. Drop the previous problematic policies
DROP POLICY IF EXISTS "Allow full access for high-level roles" ON public.role_permissions;
DROP POLICY IF EXISTS "Allow read access for all authenticated users" ON public.role_permissions;

-- 3. Re-create policies using the new function

-- Read Access: All authenticated users (needed for UI)
CREATE POLICY "Allow read access for all authenticated users"
ON public.role_permissions FOR SELECT
TO authenticated
USING (true);

-- Write Access: Only Admins/Owners
CREATE POLICY "Allow write access for admins"
ON public.role_permissions FOR INSERT
TO authenticated
WITH CHECK (auth_is_admin());

CREATE POLICY "Allow update access for admins"
ON public.role_permissions FOR UPDATE
TO authenticated
USING (auth_is_admin())
WITH CHECK (auth_is_admin());

CREATE POLICY "Allow delete access for admins"
ON public.role_permissions FOR DELETE
TO authenticated
USING (auth_is_admin());

-- 4. Ensure Roles table is readable (just in case)
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access for all authenticated users" ON public.roles;

CREATE POLICY "Allow read access for all authenticated users"
ON public.roles FOR SELECT
TO authenticated
USING (true);
