drop policy "categories_select_unified" on "public"."categories";

drop policy "content_translations_read_all" on "public"."content_translations";

drop policy "menu_permissions_select_public" on "public"."menu_permissions";

drop policy "page_files_read_all" on "public"."page_files";

drop policy "seo_metadata_select_public" on "public"."seo_metadata";

drop policy "template_strings_select_unified" on "public"."template_strings";

drop policy "users_update_hierarchy" on "public"."users";

alter table "public"."extensions" drop constraint "extensions_tenant_slug_unique";

drop index if exists "public"."extensions_tenant_slug_unique";


  create table "public"."administrative_regions" (
    "id" uuid not null default gen_random_uuid(),
    "code" text not null,
    "name" text not null,
    "level" text not null,
    "parent_id" uuid,
    "postal_code" text,
    "latitude" numeric,
    "longitude" numeric,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."administrative_regions" enable row level security;

alter table "public"."admin_menus" add column "tenant_id" uuid;

alter table "public"."users" add column "administrative_region_id" uuid;

CREATE UNIQUE INDEX administrative_regions_code_key ON public.administrative_regions USING btree (code);

CREATE UNIQUE INDEX administrative_regions_pkey ON public.administrative_regions USING btree (id);

CREATE INDEX idx_admin_menus_tenant_id ON public.admin_menus USING btree (tenant_id);

CREATE INDEX idx_admin_regions_code ON public.administrative_regions USING btree (code);

CREATE INDEX idx_admin_regions_level ON public.administrative_regions USING btree (level);

CREATE INDEX idx_admin_regions_parent_id ON public.administrative_regions USING btree (parent_id);

CREATE INDEX idx_regions_parent_id ON public.regions USING btree (parent_id);

CREATE INDEX idx_users_admin_region_id ON public.users USING btree (administrative_region_id);

CREATE INDEX idx_users_region_id ON public.users USING btree (region_id);

CREATE INDEX roles_created_at_idx ON public.roles USING btree (created_at);

alter table "public"."administrative_regions" add constraint "administrative_regions_pkey" PRIMARY KEY using index "administrative_regions_pkey";

alter table "public"."admin_menus" add constraint "admin_menus_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."admin_menus" validate constraint "admin_menus_tenant_id_fkey";

alter table "public"."administrative_regions" add constraint "administrative_regions_code_key" UNIQUE using index "administrative_regions_code_key";

alter table "public"."administrative_regions" add constraint "administrative_regions_level_check" CHECK ((level = ANY (ARRAY['provinsi'::text, 'kabupaten'::text, 'kota'::text, 'kecamatan'::text, 'kelurahan'::text, 'desa'::text]))) not valid;

alter table "public"."administrative_regions" validate constraint "administrative_regions_level_check";

alter table "public"."administrative_regions" add constraint "administrative_regions_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.administrative_regions(id) ON DELETE SET NULL not valid;

alter table "public"."administrative_regions" validate constraint "administrative_regions_parent_id_fkey";

alter table "public"."users" add constraint "users_administrative_region_id_fkey" FOREIGN KEY (administrative_region_id) REFERENCES public.administrative_regions(id) ON DELETE SET NULL not valid;

alter table "public"."users" validate constraint "users_administrative_region_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(p_name text, p_slug text, p_domain text DEFAULT NULL::text, p_tier text DEFAULT 'free'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id uuid;
BEGIN
    INSERT INTO public.tenants (name, slug, domain, subscription_tier, status)
    VALUES (p_name, p_slug, p_domain, p_tier, 'active')
    RETURNING id INTO v_tenant_id;

    -- 1. Admin (Tenant Admin)
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_tenant_admin)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true, 'tenant', true);

    -- 2. Editor
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('editor', 'Content Editor', v_tenant_id, true, 'tenant');

    -- 3. Author
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('author', 'Content Author', v_tenant_id, true, 'tenant');

    -- 4. Auditor (Read-Only) - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('auditor', 'Auditor (Read-Only)', v_tenant_id, true, 'tenant');

    -- 5. Member - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('member', 'Standard Member', v_tenant_id, true, 'tenant');

    -- 6. Subscriber - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('subscriber', 'Premium Subscriber', v_tenant_id, true, 'tenant');

    -- 7. Public - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_public)
    VALUES ('public', 'Public Visitor', v_tenant_id, true, 'tenant', true);

    -- 8. No Access - NEW
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('no_access', 'Suspended / No Access', v_tenant_id, true, 'tenant');

    -- Seed Staff Roles
    PERFORM public.seed_staff_roles(v_tenant_id);

    -- Default Pages
    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id,
        'Home',
        'home',
        '{"root":{"props":{"title":"Home"},"children":[]}}',
        'published',
        true,
        'homepage',
        (SELECT auth.uid())
    );

    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id,
        'About Us',
        'about',
        '{"root":{"props":{"title":"About Us"},"children":[]}}',
        'published',
        true,
        'regular',
        (SELECT auth.uid())
    );

    -- Default Menus
    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'Home', '/', 'header', true, true, 1);

    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'About', '/about', 'header', true, true, 2);

    RETURN jsonb_build_object(
        'tenant_id', v_tenant_id,
        'message', 'Tenant created with default data (Standard Roles applied).'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_resource_tags(p_resource_id uuid, p_resource_type text, p_tags text[], p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id UUID;
  v_tag_name TEXT;
  v_slug TEXT;
  target_table regclass;
BEGIN
  -- Restrict tag usage to blogs only
  IF p_resource_type != 'blogs' AND p_resource_type != 'articles' THEN
    RETURN;
  END IF;

  target_table := to_regclass('public.blog_tags');
  
  IF target_table IS NULL THEN
    RETURN;
  END IF;

  -- Delete existing tags for this resource
  DELETE FROM "public"."blog_tags" WHERE blog_id = p_resource_id;

  IF p_tags IS NOT NULL THEN
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
      v_slug := trim(both '-' from lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g')));

      -- Ensure tag exists in public.tags (tenant-isolated)
      INSERT INTO public.tags (name, slug, tenant_id)
      VALUES (v_tag_name, v_slug, p_tenant_id)
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = v_tag_name
      RETURNING id INTO v_tag_id;

      -- Link tag to article
      INSERT INTO "public"."blog_tags" (blog_id, tag_id) VALUES (p_resource_id, v_tag_id);
    END LOOP;
  END IF;
END;
$function$
;

grant delete on table "public"."administrative_regions" to "anon";

grant insert on table "public"."administrative_regions" to "anon";

grant references on table "public"."administrative_regions" to "anon";

grant select on table "public"."administrative_regions" to "anon";

grant trigger on table "public"."administrative_regions" to "anon";

grant truncate on table "public"."administrative_regions" to "anon";

grant update on table "public"."administrative_regions" to "anon";

grant delete on table "public"."administrative_regions" to "authenticated";

grant insert on table "public"."administrative_regions" to "authenticated";

grant references on table "public"."administrative_regions" to "authenticated";

grant select on table "public"."administrative_regions" to "authenticated";

grant trigger on table "public"."administrative_regions" to "authenticated";

grant truncate on table "public"."administrative_regions" to "authenticated";

grant update on table "public"."administrative_regions" to "authenticated";

grant delete on table "public"."administrative_regions" to "service_role";

grant insert on table "public"."administrative_regions" to "service_role";

grant references on table "public"."administrative_regions" to "service_role";

grant select on table "public"."administrative_regions" to "service_role";

grant trigger on table "public"."administrative_regions" to "service_role";

grant truncate on table "public"."administrative_regions" to "service_role";

grant update on table "public"."administrative_regions" to "service_role";


  create policy "Enable read access for authenticated users"
  on "public"."admin_menus"
  as permissive
  for select
  to authenticated
using (((tenant_id IS NULL) OR (tenant_id = ((auth.jwt() ->> 'tenant_id'::text))::uuid)));



  create policy "admin_menus_select_unified"
  on "public"."admin_menus"
  as permissive
  for select
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "admin_regions_delete_admin"
  on "public"."administrative_regions"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "admin_regions_insert_admin"
  on "public"."administrative_regions"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "admin_regions_select_all"
  on "public"."administrative_regions"
  as permissive
  for select
  to public
using (((is_active = true) OR public.is_platform_admin()));



  create policy "admin_regions_update_admin"
  on "public"."administrative_regions"
  as permissive
  for update
  to public
using (public.is_platform_admin())
with check (public.is_platform_admin());



  create policy "categories_select_tenant"
  on "public"."categories"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "regions_delete_admin"
  on "public"."regions"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "regions_insert_admin"
  on "public"."regions"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "regions_select_all"
  on "public"."regions"
  as permissive
  for select
  to public
using (((is_active = true) OR public.is_platform_admin()));



  create policy "regions_update_admin"
  on "public"."regions"
  as permissive
  for update
  to public
using (public.is_platform_admin())
with check (public.is_platform_admin());



  create policy "tenant_resource_registry_select"
  on "public"."tenant_resource_registry"
  as permissive
  for select
  to authenticated
using (true);



  create policy "categories_select_unified"
  on "public"."categories"
  as permissive
  for select
  to public
using (true);



  create policy "content_translations_read_all"
  on "public"."content_translations"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "menu_permissions_select_public"
  on "public"."menu_permissions"
  as permissive
  for select
  to public
using (true);



  create policy "page_files_read_all"
  on "public"."page_files"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "seo_metadata_select_public"
  on "public"."seo_metadata"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "template_strings_select_unified"
  on "public"."template_strings"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "users_update_hierarchy"
  on "public"."users"
  as permissive
  for update
  to public
using ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND ((id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM ((public.role_permissions rp
     JOIN public.permissions p ON ((p.id = rp.permission_id)))
     JOIN public.users u ON ((u.role_id = rp.role_id)))
  WHERE ((u.id = auth.uid()) AND (u.tenant_id = public.current_tenant_id()) AND (p.name = 'tenant.user.update'::text)))))) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text)))
with check ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND ((id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM ((public.role_permissions rp
     JOIN public.permissions p ON ((p.id = rp.permission_id)))
     JOIN public.users u ON ((u.role_id = rp.role_id)))
  WHERE ((u.id = auth.uid()) AND (u.tenant_id = public.current_tenant_id()) AND (p.name = 'tenant.user.update'::text)))))) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text)));


CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.administrative_regions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.regions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


