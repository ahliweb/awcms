-- Migration: Enable ABAC RLS for strict tables
-- Date: 2026-01-17
-- Description: Replaces strict role-based policies with permission-based checks for SSO and Roles.

BEGIN;

-- 1. SSO Providers (Target: tenant.sso.read)
DROP POLICY IF EXISTS "sso_providers_isolation_policy" ON "public"."sso_providers";

CREATE POLICY "sso_providers_select_abac" ON "public"."sso_providers"
FOR SELECT TO authenticated
USING (
  (tenant_id = public.current_tenant_id() AND public.has_permission('tenant.sso.read'))
  OR public.is_platform_admin()
);

-- 2. Roles (Target: view_roles)
DROP POLICY IF EXISTS "roles_select_unified" ON "public"."roles";

CREATE POLICY "roles_select_abac" ON "public"."roles"
FOR SELECT TO authenticated
USING (
  (tenant_id = public.current_tenant_id() AND public.has_permission('view_roles'))
  OR public.is_platform_admin()
);

COMMIT;
