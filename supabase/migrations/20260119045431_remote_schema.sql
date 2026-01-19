drop policy "Allow delete access for admins" on "public"."role_permissions";

drop policy "Allow read access for all authenticated users" on "public"."role_permissions";

drop policy "Allow update access for admins" on "public"."role_permissions";

drop policy "Allow write access for admins" on "public"."role_permissions";

drop policy "role_permissions_insert_policy" on "public"."role_permissions";

drop policy "role_permissions_update_policy" on "public"."role_permissions";

drop policy "Allow read access for all authenticated users" on "public"."roles";


  create policy "role_permissions_delete_admin"
  on "public"."role_permissions"
  as permissive
  for delete
  to authenticated
using (public.auth_is_admin());



  create policy "role_permissions_insert_admin"
  on "public"."role_permissions"
  as permissive
  for insert
  to authenticated
with check (public.auth_is_admin());



  create policy "role_permissions_update_admin"
  on "public"."role_permissions"
  as permissive
  for update
  to authenticated
using (public.auth_is_admin())
with check (public.auth_is_admin());



