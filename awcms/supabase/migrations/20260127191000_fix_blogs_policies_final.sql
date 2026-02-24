-- Fix Blogs Policies (Legacy Articles)
-- Advisor flagged `blogs` table as having multiple permissive policies.
-- Identified policies named `articles_..._unified` that persist from a table rename.
-- These are redundant with `blogs_..._hierarchy`.

DROP POLICY IF EXISTS articles_delete_unified ON public.blogs;
DROP POLICY IF EXISTS articles_insert_unified ON public.blogs;
DROP POLICY IF EXISTS articles_select_unified ON public.blogs;
DROP POLICY IF EXISTS articles_update_unified ON public.blogs;
