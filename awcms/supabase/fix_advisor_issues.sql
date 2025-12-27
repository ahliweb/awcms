-- ============================================
-- SUPABASE ADVISOR FIX
-- Security + Performance Issues
-- ============================================
-- Run this SQL in Supabase SQL Editor

-- ============================================
-- FIX #1: Security Definer View
-- Issue: public.published_articles_view uses SECURITY DEFINER
-- Solution: Change to SECURITY INVOKER (default)
-- ============================================

-- Drop and recreate the view with SECURITY INVOKER
DROP VIEW IF EXISTS public.published_articles_view;

CREATE VIEW public.published_articles_view 
WITH (security_invoker = true)
AS
SELECT 
  id,
  tenant_id,
  title,
  content,
  excerpt,
  cover_image,
  status,
  owner_id,
  created_at,
  updated_at
FROM public.articles
WHERE status = 'published'
  AND deleted_at IS NULL;

-- Grant appropriate permissions
GRANT SELECT ON public.published_articles_view TO authenticated;
GRANT SELECT ON public.published_articles_view TO anon;

-- ============================================
-- FIX #2: RLS Performance - articles_select_policy
-- Issue: current_setting() and auth.<function>() re-evaluated per row
-- Solution: Use subquery to evaluate auth functions once
-- ============================================

-- Drop the problematic policy
DROP POLICY IF EXISTS "articles_select_policy" ON public.articles;

-- Create optimized policy using subquery pattern
-- This evaluates auth.uid() and current_setting() only ONCE
CREATE POLICY "articles_select_policy" ON public.articles
FOR SELECT
USING (
  -- Published articles are public
  (status = 'published' AND deleted_at IS NULL)
  OR
  -- Owner can see their own articles
  (owner_id = (SELECT auth.uid()))
  OR
  -- Same tenant can see tenant articles
  (tenant_id = (SELECT (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid))
);

-- ============================================
-- ALTERNATIVE: If the above doesn't work,
-- use a helper function approach
-- ============================================

-- Create helper function for getting current user
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid()
$$;

-- Create helper function for getting current tenant
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid
$$;

-- If subquery approach doesn't improve performance,
-- you can recreate the policy using these functions:
-- 
-- DROP POLICY IF EXISTS "articles_select_policy" ON public.articles;
-- 
-- CREATE POLICY "articles_select_policy" ON public.articles
-- FOR SELECT
-- USING (
--   (status = 'published' AND deleted_at IS NULL)
--   OR (owner_id = get_current_user_id())
--   OR (tenant_id = get_current_tenant_id())
-- );

-- ============================================
-- Verification
-- ============================================
-- Check view security:
-- SELECT schemaname, viewname, definition 
-- FROM pg_views 
-- WHERE viewname = 'published_articles_view';

-- Check policies:
-- SELECT * FROM pg_policies WHERE tablename = 'articles';
