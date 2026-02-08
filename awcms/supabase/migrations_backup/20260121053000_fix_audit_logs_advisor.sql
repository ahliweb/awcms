-- Fix RLS policy for audit_logs (Advisor: auth_rls_initplan)
DROP POLICY IF EXISTS "audit_logs_insert_unified" ON "public"."audit_logs";
CREATE POLICY "audit_logs_insert_unified" ON "public"."audit_logs"
AS PERMISSIVE FOR INSERT TO public
WITH CHECK (
  (tenant_id = public.current_tenant_id()) 
  OR 
  ((tenant_id IS NULL) AND ((SELECT auth.uid()) IS NOT NULL))
);
