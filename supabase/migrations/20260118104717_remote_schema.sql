drop policy "roles_select_unified" on "public"."roles";

drop policy "sso_providers_isolation_policy" on "public"."sso_providers";


  create policy "roles_select_abac"
  on "public"."roles"
  as permissive
  for select
  to authenticated
using ((((tenant_id = public.current_tenant_id()) AND public.has_permission('view_roles'::text)) OR public.is_platform_admin()));



  create policy "sso_providers_select_abac"
  on "public"."sso_providers"
  as permissive
  for select
  to authenticated
using ((((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.sso.read'::text)) OR public.is_platform_admin()));



