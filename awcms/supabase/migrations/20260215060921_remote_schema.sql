drop policy "admin_menus_select_unified" on "public"."admin_menus";

drop policy "Enable read access for all users" on "public"."blogs";

drop policy "blogs_select_hierarchy" on "public"."blogs";

drop policy "categories_select_tenant" on "public"."categories";

drop policy "Public Read Published Funfacts" on "public"."funfacts";

drop policy "Tenant Select Funfacts" on "public"."funfacts";

drop policy "Enable insert for authenticated users with permission" on "public"."orders";

drop policy "orders_insert_own" on "public"."orders";

drop policy "orders_select_own" on "public"."orders";

drop policy "orders_select_tenant_staff" on "public"."orders";

drop policy "Public Read Published Partners" on "public"."partners";

drop policy "Tenant Select Partners" on "public"."partners";

drop policy "Public Read Published Services" on "public"."services";

drop policy "services_select_hierarchy" on "public"."services";

drop policy "Public Read Published Teams" on "public"."teams";

drop policy "Tenant Select Teams" on "public"."teams";

drop policy "tenant_resource_registry_select" on "public"."tenant_resource_registry";

drop policy "seo_metadata_select_public" on "public"."seo_metadata";

alter table "public"."admin_menus" drop constraint "admin_menus_tenant_id_fkey";

drop index if exists "public"."idx_admin_menus_tenant_id";

drop index if exists "public"."roles_created_at_idx";

alter table "public"."admin_menus" drop column "tenant_id";

CREATE UNIQUE INDEX extensions_tenant_slug_unique ON public.extensions USING btree (tenant_id, slug);

alter table "public"."extensions" add constraint "extensions_tenant_slug_unique" UNIQUE using index "extensions_tenant_slug_unique";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.sync_resource_tags(p_resource_id uuid, p_resource_type text, p_tags text[], p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id uuid;
  v_tag_name text;
  v_slug text;
  target_table regclass;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant ID is required for tag synchronization';
  END IF;

  IF p_resource_type NOT IN ('blogs', 'articles') THEN
    RETURN;
  END IF;

  target_table := to_regclass('public.blog_tags');
  IF target_table IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.blog_tags
  WHERE blog_id = p_resource_id
    AND tenant_id = p_tenant_id;

  IF p_tags IS NOT NULL THEN
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
      v_slug := trim(both '-' from lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g')));

      INSERT INTO public.tags (name, slug, tenant_id)
      VALUES (v_tag_name, v_slug, p_tenant_id)
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = v_tag_name
      RETURNING id INTO v_tag_id;

      INSERT INTO public.blog_tags (blog_id, tag_id, tenant_id)
      VALUES (p_resource_id, v_tag_id, p_tenant_id)
      ON CONFLICT (blog_id, tag_id) DO NOTHING;
    END LOOP;
  END IF;
END;
$function$
;


  create policy "blogs_select_unified"
  on "public"."blogs"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin())));



  create policy "funfacts_select_unified"
  on "public"."funfacts"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.is_platform_admin()));



  create policy "orders_insert_auth"
  on "public"."orders"
  as permissive
  for insert
  to authenticated
with check ((( SELECT auth.uid() AS uid) = user_id));



  create policy "orders_select_auth"
  on "public"."orders"
  as permissive
  for select
  to authenticated
using (((( SELECT auth.uid() AS uid) = user_id) OR ((tenant_id = ( SELECT users.tenant_id
   FROM public.users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (( SELECT public.get_my_role_name() AS get_my_role_name) = ANY (ARRAY['admin'::text, 'editor'::text]))) OR (( SELECT public.get_my_role_name() AS get_my_role_name) = 'super_admin'::text)));



  create policy "partners_select_unified"
  on "public"."partners"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.is_platform_admin()));



  create policy "services_select_unified"
  on "public"."services"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin())));



  create policy "teams_select_unified"
  on "public"."teams"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.is_platform_admin()));



  create policy "seo_metadata_select_public"
  on "public"."seo_metadata"
  as permissive
  for select
  to public
using (true);


CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


