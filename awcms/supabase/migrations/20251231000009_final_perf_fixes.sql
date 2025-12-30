-- Migration: Final Performance Fixes & Security Hardening
-- Date: 2025-12-31
-- Description: Optimizes auth calls (using subqueries), restores strict user privacy for notifications, and adds missing Foreign Key indexes.

-- 1. FIX NOTIFICATIONS SECURITY (Privacy Regression Fix)
-- Previous migration 08 accidentally made notifications visible to entire tenant.
-- We must restrict to Own User OR Admin.
DROP POLICY IF EXISTS "notifications_select_unified" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_unified" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_unified" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_unified" ON public.notifications;

CREATE POLICY "notifications_select_unified" ON public.notifications FOR SELECT USING (
    (user_id = (SELECT auth.uid())) 
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);
-- Write: System usually inserts. But if users can dismiss/delete?
-- Assuming users can DELETE/UPDATE their own.
CREATE POLICY "notifications_modify_unified" ON public.notifications FOR ALL USING (
     (user_id = (SELECT auth.uid())) 
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);


-- 2. OPTIMIZE USERS (Avoid auth.uid() volatile warning)
-- Wrap auth.uid() in (SELECT ...)
DROP POLICY IF EXISTS "users_select_unified" ON public.users;

CREATE POLICY "users_select_unified" ON public.users FOR SELECT USING (
    id = (SELECT auth.uid())
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
    OR public.is_platform_admin()
);

-- 3. ADD MISSING INDEXES (Performance)
-- sso_role_mappings
CREATE INDEX IF NOT EXISTS idx_sso_role_mappings_provider ON public.sso_role_mappings(provider_id);
-- CREATE INDEX IF NOT EXISTS idx_sso_role_mappings_role ON public.sso_role_mappings(role_id); -- Column name unknown
-- CREATE INDEX IF NOT EXISTS idx_sso_role_mappings_tenant ON public.sso_role_mappings(tenant_id); -- Column does not exist

-- role_policies
CREATE INDEX IF NOT EXISTS idx_role_policies_role ON public.role_policies(role_id);
CREATE INDEX IF NOT EXISTS idx_role_policies_policy ON public.role_policies(policy_id);

-- templates & widgets (Just to be safe, if missed)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'widgets') THEN
        CREATE INDEX IF NOT EXISTS idx_widgets_tenant_id ON public.widgets(tenant_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'template_assignments') THEN
        CREATE INDEX IF NOT EXISTS idx_template_assignments_tenant_id ON public.template_assignments(tenant_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'template_parts') THEN
        CREATE INDEX IF NOT EXISTS idx_template_parts_tenant_id ON public.template_parts(tenant_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'order_items') THEN
        CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON public.order_items(tenant_id);
    END IF;
END $$;
