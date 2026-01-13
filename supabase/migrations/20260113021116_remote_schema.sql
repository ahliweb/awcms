drop policy "audit_logs_insert_unified" on "public"."audit_logs";

drop policy "Regions tenant isolation" on "public"."regions";

CREATE UNIQUE INDEX regions_code_key ON public.regions USING btree (code);

alter table "public"."regions" add constraint "regions_code_key" UNIQUE using index "regions_code_key";


  create policy "Regions tenant isolation"
  on "public"."regions"
  as permissive
  for all
  to authenticated
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR (tenant_id IS NULL)))
with check ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



