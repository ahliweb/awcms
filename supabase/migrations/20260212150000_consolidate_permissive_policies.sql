-- Migration: Consolidate Multiple Permissive Policies
-- Date: 2026-02-12
-- Purpose: Fix Supabase Advisor warnings about multiple permissive policies
--          on the same table for the same command. Each case is consolidated
--          into a single policy that covers all access patterns.

BEGIN;

-- ============================================================================
-- 1. BLOGS — SELECT
-- Current: "Enable read access for all users" (public, status='published')
--        + "blogs_select_hierarchy" (public, tenant/hierarchy/admin)
-- Fix: Drop the generic public read policy. Recreate blogs_select_hierarchy
--      to also allow anon access to published blogs.
-- ============================================================================
DROP POLICY IF EXISTS "Enable read access for all users" ON public.blogs;
DROP POLICY IF EXISTS "blogs_select_hierarchy" ON public.blogs;

CREATE POLICY blogs_select_unified
  ON public.blogs
  FOR SELECT
  TO public
  USING (
    -- Anon/public: can read published blogs
    (status = 'published')
    OR
    -- Authenticated: tenant hierarchy access
    (
      tenant_id = (SELECT public.current_tenant_id())
      OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
      OR public.is_platform_admin()
    )
  );


-- ============================================================================
-- 2. CATEGORIES — SELECT
-- Current: "Enable read access for all users" (public, USING(true))
--        + "categories_select_unified" (public, tenant/admin)
-- Fix: Drop both and create single policy. Categories need public read
--      (for blog category joins) plus tenant/admin access.
-- ============================================================================
DROP POLICY IF EXISTS "Enable read access for all users" ON public.categories;
DROP POLICY IF EXISTS "categories_select_unified" ON public.categories;

CREATE POLICY categories_select_unified
  ON public.categories
  FOR SELECT
  TO public
  USING (
    -- Public can read all categories (needed for blog/page category joins)
    true
  );


-- ============================================================================
-- 3. FUNFACTS — SELECT
-- Current: "Public Read Published Funfacts" (anon, status='published')
--        + "Tenant Select Funfacts" (authenticated, tenant match)
-- Fix: Merge into single policy for all roles.
-- ============================================================================
DROP POLICY IF EXISTS "Public Read Published Funfacts" ON public.funfacts;
DROP POLICY IF EXISTS "Tenant Select Funfacts" ON public.funfacts;

CREATE POLICY funfacts_select_unified
  ON public.funfacts
  FOR SELECT
  TO public
  USING (
    -- Anon/public: can read published funfacts
    (status = 'published')
    OR
    -- Authenticated tenant members: can read all within their tenant
    (tenant_id = (SELECT public.current_tenant_id()))
    OR
    public.is_platform_admin()
  );


-- ============================================================================
-- 4. PARTNERS — SELECT
-- Current: "Public Read Published Partners" (anon, status='published')
--        + "Tenant Select Partners" (authenticated, tenant match)
-- Fix: Merge into single policy for all roles.
-- ============================================================================
DROP POLICY IF EXISTS "Public Read Published Partners" ON public.partners;
DROP POLICY IF EXISTS "Tenant Select Partners" ON public.partners;

CREATE POLICY partners_select_unified
  ON public.partners
  FOR SELECT
  TO public
  USING (
    -- Anon/public: can read published partners
    (status = 'published')
    OR
    -- Authenticated tenant members: can read all within their tenant
    (tenant_id = (SELECT public.current_tenant_id()))
    OR
    public.is_platform_admin()
  );


-- ============================================================================
-- 5. SERVICES — SELECT
-- Current: "Public Read Published Services" (anon, status='published')
--        + "services_select_hierarchy" (authenticated, tenant/hierarchy/admin)
-- Fix: Merge into single policy. Keep hierarchy logic for authenticated,
--      add published check for anon.
-- ============================================================================
DROP POLICY IF EXISTS "Public Read Published Services" ON public.services;
DROP POLICY IF EXISTS "services_select_hierarchy" ON public.services;

CREATE POLICY services_select_unified
  ON public.services
  FOR SELECT
  TO public
  USING (
    -- Anon/public: can read published services
    (status = 'published')
    OR
    -- Authenticated: tenant hierarchy access
    (
      tenant_id = (SELECT public.current_tenant_id())
      OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
      OR public.is_platform_admin()
    )
  );


-- ============================================================================
-- 6. TEAMS — SELECT
-- Current: "Public Read Published Teams" (anon, status='published')
--        + "Tenant Select Teams" (authenticated, tenant match)
-- Fix: Merge into single policy for all roles.
-- ============================================================================
DROP POLICY IF EXISTS "Public Read Published Teams" ON public.teams;
DROP POLICY IF EXISTS "Tenant Select Teams" ON public.teams;

CREATE POLICY teams_select_unified
  ON public.teams
  FOR SELECT
  TO public
  USING (
    -- Anon/public: can read published teams
    (status = 'published')
    OR
    -- Authenticated tenant members: can read all within their tenant
    (tenant_id = (SELECT public.current_tenant_id()))
    OR
    public.is_platform_admin()
  );


-- ============================================================================
-- 7. ORDERS — INSERT (3 permissive policies)
-- Current: "Enable insert for anonymous users" (anon, WITH CHECK(true))
--        + "Enable insert for authenticated users with permission" (authenticated)
--        + "orders_insert_own" (authenticated, uid=user_id)
-- Fix: Keep anon insert as-is (different role target).
--      Merge the two authenticated INSERT policies into one.
-- ============================================================================
DROP POLICY IF EXISTS "Enable insert for authenticated users with permission" ON public.orders;
DROP POLICY IF EXISTS "orders_insert_own" ON public.orders;

CREATE POLICY orders_insert_auth
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Users can create orders where they are the user
    (SELECT auth.uid()) = user_id
  );


-- ============================================================================
-- 8. ORDERS — SELECT (2 permissive policies)
-- Current: "orders_select_own" (authenticated, uid=user_id)
--        + "orders_select_tenant_staff" (authenticated, tenant staff/admin)
-- Fix: Merge into single authenticated SELECT policy.
-- ============================================================================
DROP POLICY IF EXISTS "orders_select_own" ON public.orders;
DROP POLICY IF EXISTS "orders_select_tenant_staff" ON public.orders;

CREATE POLICY orders_select_auth
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    -- Users can view their own orders
    (SELECT auth.uid()) = user_id
    OR
    -- Tenant staff (admin/editor) can view all tenant orders
    (
      tenant_id = (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
      AND (SELECT public.get_my_role_name()) IN ('admin', 'editor')
    )
    OR
    -- Super admins can view all orders
    (SELECT public.get_my_role_name()) = 'super_admin'
  );

COMMIT;
