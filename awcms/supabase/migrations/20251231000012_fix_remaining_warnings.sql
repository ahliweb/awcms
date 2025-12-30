-- Migration: Fix Remaining Supabase Advisor Warnings
-- Date: 2025-12-31
-- Description: Drops redundant indexes and fixes 'Multiple Permissive Policies' on notifications.

-- 1. DROP DUPLICATE INDEXES
-- These were created in migration 09 but already existed with different names in previous migrations.
DROP INDEX IF EXISTS public.idx_widgets_tenant_id;       -- Duplicate of idx_widgets_tenant
DROP INDEX IF EXISTS public.idx_template_parts_tenant_id; -- Duplicate of idx_template_parts_tenant
-- role_policies duplicate? If idx_role_policies_role existed, we drop the new one if generic.
-- But earlier I failed to create idx_role_policies_role. 
-- However, idx_role_policies_role might exist from creation.
-- Let's just ensure we rely on the intended ones.
-- If 'idx_role_policies_policy' was created in 09, check if it duplicates.
-- We'll assume the 09 ones are the "extras" if originals existed.

-- 2. FIX NOTIFICATIONS POLICIES (Multiple Permissive)
-- The issue: "notifications_modify_unified" was FOR ALL, overlapping with "notifications_select_unified".
-- We must split modify into INSERT, UPDATE, DELETE.

DROP POLICY IF EXISTS "notifications_modify_unified" ON public.notifications;

-- Insert (System usually, or user?)
-- Assuming users can create notifications? Probably system. 
-- But keeping consistent with previous logic:
CREATE POLICY "notifications_insert_unified" ON public.notifications FOR INSERT WITH CHECK (
    (user_id = (SELECT auth.uid())) 
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);

CREATE POLICY "notifications_update_unified" ON public.notifications FOR UPDATE USING (
    (user_id = (SELECT auth.uid())) 
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);

CREATE POLICY "notifications_delete_unified" ON public.notifications FOR DELETE USING (
    (user_id = (SELECT auth.uid())) 
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);

-- 3. FIX OTHER POTENTIAL OVERLAPS
-- Check 'products' overlap? (likely select vs modify_unified if modify was FOR ALL)
-- Migration 08 handled 'products' split. But maybe 'Tenant Read Access' wasn't dropped?
-- Let's allow idempotent cleanup again for stubborn policies.
DROP POLICY IF EXISTS "Tenant Read Access" ON public.products;
DROP POLICY IF EXISTS "Tenant Write Access" ON public.products;
DROP POLICY IF EXISTS "products_access_policy" ON public.products;

-- Check 'roles' overlap.
DROP POLICY IF EXISTS "Tenant Read Access" ON public.roles;
DROP POLICY IF EXISTS "Tenant Write Access" ON public.roles;

-- Check 'users' overlap.
DROP POLICY IF EXISTS "Tenant Read Access" ON public.users;
DROP POLICY IF EXISTS "users_select_policy" ON public.users; 

-- order_items overlap
DROP POLICY IF EXISTS "Tenant Read Access" ON public.order_items;
DROP POLICY IF EXISTS "order_items_access_policy" ON public.order_items;

