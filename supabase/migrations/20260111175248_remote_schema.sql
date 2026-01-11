drop policy "audit_logs_insert_unified" on "public"."audit_logs";

drop policy "audit_logs_insert" on "public"."audit_logs";

drop policy "audit_logs_select" on "public"."audit_logs";

alter table "public"."email_logs" add column "deleted_at" timestamp with time zone;

alter table "public"."email_logs" add column "ip_address" text;

alter table "public"."email_logs" add column "user_id" uuid;

CREATE INDEX idx_email_logs_user_id ON public.email_logs USING btree (user_id);

alter table "public"."email_logs" add constraint "email_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."email_logs" validate constraint "email_logs_user_id_fkey";


  create policy "audit_logs_insert"
  on "public"."audit_logs"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ((tenant_id IS NULL) AND (( SELECT auth.uid() AS uid) IS NOT NULL))));



  create policy "audit_logs_select"
  on "public"."audit_logs"
  as permissive
  for select
  to authenticated
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR (tenant_id IS NULL)));



