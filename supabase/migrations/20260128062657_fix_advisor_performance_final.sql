SET client_min_messages TO warning;

-- Fix Supabase Advisor Performance Issues
-- 1. Drop unused indexes flagged by advisor
-- 2. Drop redundant 'unified' policies on blogs table that conflict with 'hierarchy' policies

-- Drop unused indexes
DROP INDEX IF EXISTS public.idx_services_display_order;
DROP INDEX IF EXISTS public.idx_teams_display_order;
DROP INDEX IF EXISTS public.idx_partners_display_order;
DROP INDEX IF EXISTS public.idx_funfacts_display_order;

-- Drop redundant policies on public.blogs (articles_*)
-- These are covered by blogs_*_hierarchy policies
DROP POLICY IF EXISTS articles_delete_unified ON public.blogs;
DROP POLICY IF EXISTS articles_insert_unified ON public.blogs;
DROP POLICY IF EXISTS articles_select_unified ON public.blogs;
DROP POLICY IF EXISTS articles_update_unified ON public.blogs;
