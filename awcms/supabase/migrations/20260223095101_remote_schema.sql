drop policy "analytics_events_public_insert" on "public"."analytics_events";

revoke insert on table "public"."sso_audit_logs" from "anon";

revoke insert on table "public"."sso_audit_logs" from "authenticated";

revoke insert on table "public"."two_factor_audit_logs" from "anon";

revoke insert on table "public"."two_factor_audit_logs" from "authenticated";


  create policy "analytics_events_public_insert"
  on "public"."analytics_events"
  as permissive
  for insert
  to anon, authenticated
with check ((tenant_id = public.current_tenant_id()));



