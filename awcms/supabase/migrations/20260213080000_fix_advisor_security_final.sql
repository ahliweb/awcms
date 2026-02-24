-- Fix Supabase Advisor Security Issues (2026-02-13)
-- 1. ERROR: published_blogs_view uses SECURITY_DEFINER → switch to SECURITY_INVOKER
-- 2. WARNING: orders anonymous INSERT has WITH CHECK(true) → scope to tenant

-- Fix 1: published_blogs_view — use querying user's permissions, not view creator's
ALTER VIEW public.published_blogs_view SET (security_invoker = true);

-- Fix 2: orders — replace overly permissive anonymous INSERT policy
DROP POLICY IF EXISTS "Enable insert for anonymous users" ON public.orders;
CREATE POLICY "Enable insert for anonymous users" ON public.orders
  FOR INSERT TO anon
  WITH CHECK (tenant_id = public.current_tenant_id());
