-- Fix RLS policy for admin_menus to allow viewing platform-wide menus
-- The previous policy didn't allow viewing menus where tenant_id IS NULL

DROP POLICY IF EXISTS admin_menus_select_unified ON admin_menus;

CREATE POLICY admin_menus_select_unified ON admin_menus
FOR SELECT TO authenticated
USING (
    tenant_id IS NULL 
    OR tenant_id = current_tenant_id() 
    OR is_platform_admin()
);
