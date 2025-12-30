-- Migration: Absolute Cleanup of Policies and Indexes
-- Date: 2025-12-31
-- Description: Dynamically drops ALL policies for backups/order_items and ALL non-PK indexes for role_policies, then recreates strict unified versions.

DO $$
DECLARE
    r RECORD;
BEGIN
    -- 1. DROP ALL POLICIES on backups and order_items
    -- This iterates through actual existing policies, avoiding "does not exist" errors and missed names.
    FOR r IN SELECT policyname, tablename FROM pg_policies WHERE tablename IN ('backups', 'order_items') LOOP
        EXECUTE format('DROP POLICY IF EXISTS "%s" ON public.%I', r.policyname, r.tablename);
        RAISE NOTICE 'Dropped policy: % on %', r.policyname, r.tablename;
    END LOOP;

    -- 2. DROP ALL INDEXES on role_policies (except PK)
    -- This clears any duplicate or misnamed indexes.
    FOR r IN SELECT indexname FROM pg_indexes WHERE tablename = 'role_policies' AND indexname NOT LIKE '%pkey' LOOP
        EXECUTE format('DROP INDEX IF EXISTS public."%s"', r.indexname);
        RAISE NOTICE 'Dropped index: %', r.indexname;
    END LOOP;
END $$;

-- 3. RECREATE POLICIES: Backups
-- Ensuring table exists (it must, per warning) and RLS is enabled.
ALTER TABLE IF EXISTS public.backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backups_select_unified" ON public.backups FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());
CREATE POLICY "backups_insert_unified" ON public.backups FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_platform_admin());
CREATE POLICY "backups_update_unified" ON public.backups FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());
CREATE POLICY "backups_delete_unified" ON public.backups FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());

-- 4. RECREATE POLICIES: Order Items
ALTER TABLE IF EXISTS public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_items_select_unified" ON public.order_items FOR SELECT USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());
CREATE POLICY "order_items_insert_unified" ON public.order_items FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_platform_admin());
CREATE POLICY "order_items_update_unified" ON public.order_items FOR UPDATE USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());
CREATE POLICY "order_items_delete_unified" ON public.order_items FOR DELETE USING (tenant_id = public.current_tenant_id() OR public.is_platform_admin());

-- 5. RECREATE INDEXES: Role Policies
-- Rebuilds the necessary indexes cleanly.
CREATE INDEX IF NOT EXISTS idx_role_policies_role_id ON public.role_policies(role_id);
CREATE INDEX IF NOT EXISTS idx_role_policies_policy_id ON public.role_policies(policy_id);
