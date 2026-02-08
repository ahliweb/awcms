drop trigger if exists "content_translations_updated_at" on "public"."content_translations";

drop policy if exists "audit_logs_insert" on "public"."audit_logs";

drop policy if exists "audit_logs_select" on "public"."audit_logs";

drop policy if exists "content_translations_anon_read" on "public"."content_translations";

drop policy if exists "content_translations_tenant_isolation" on "public"."content_translations";

drop policy if exists "page_files_anon_read" on "public"."page_files";

drop policy if exists "page_files_tenant_isolation" on "public"."page_files";

drop policy if exists "page_tags_anon_read" on "public"."page_tags";

drop policy if exists "page_tags_select_public" on "public"."page_tags";

drop policy if exists "page_tags_tenant_isolation" on "public"."page_tags";

drop policy if exists "role_permissions_delete_admin" on "public"."role_permissions";

drop policy if exists "role_permissions_insert_admin" on "public"."role_permissions";

drop policy if exists "role_permissions_update_admin" on "public"."role_permissions";

drop policy if exists "roles_select_abac" on "public"."roles";

drop policy if exists "sso_providers_select_abac" on "public"."sso_providers";

-- drop policy if exists "articles_delete_unified" on "public"."articles";

-- drop policy if exists "articles_insert_unified" on "public"."articles";

-- drop policy if exists "articles_select_unified" on "public"."articles";

-- drop policy if exists "articles_update_unified" on "public"."articles";

-- drop policy if exists "portfolio_delete_unified" on "public"."portfolio";

-- drop policy if exists "portfolio_insert_unified" on "public"."portfolio";

-- drop policy if exists "portfolio_select_unified" on "public"."portfolio";

-- drop policy if exists "portfolio_update_unified" on "public"."portfolio";

drop policy if exists "Regions tenant isolation" on "public"."regions";

-- drop policy if exists "testimonies_delete_unified" on "public"."testimonies";

-- drop policy if exists "testimonies_insert_unified" on "public"."testimonies";

-- drop policy if exists "testimonies_select_unified" on "public"."testimonies";

-- drop policy if exists "testimonies_update_unified" on "public"."testimonies";

drop function if exists "public"."auth_is_admin"();

drop function if exists "public"."cleanup_old_login_audit_logs"();

drop function if exists "public"."current_auth_user_id"();

drop function if exists "public"."current_user_tenant_id"();

drop function if exists "public"."get_current_user_id"();


/*  create table "public"."modules" (
    "id" uuid not null default gen_random_uuid(),
    "tenant_id" uuid not null,
    "name" text not null,
    "slug" text not null,
    "description" text,
    "status" text default 'active'::text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      ); */


/* alter table "public"."modules" enable row level security;

CREATE UNIQUE INDEX modules_pkey ON public.modules USING btree (id);

CREATE UNIQUE INDEX modules_tenant_id_slug_key ON public.modules USING btree (tenant_id, slug);

alter table "public"."modules" add constraint "modules_pkey" PRIMARY KEY using index "modules_pkey";

alter table "public"."modules" add constraint "modules_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'maintenance'::text]))) not valid;

alter table "public"."modules" validate constraint "modules_status_check";

alter table "public"."modules" add constraint "modules_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."modules" validate constraint "modules_tenant_id_fkey";

alter table "public"."modules" add constraint "modules_tenant_id_slug_key" UNIQUE using index "modules_tenant_id_slug_key"; */

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(p_name text, p_slug text, p_domain text DEFAULT NULL::text, p_tier text DEFAULT 'free'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id uuid;
BEGIN
    -- 1. Create Tenant
    INSERT INTO public.tenants (name, slug, domain, subscription_tier, status)
    VALUES (p_name, p_slug, p_domain, p_tier, 'active')
    RETURNING id INTO v_tenant_id;

    -- 2. Create Default Roles (Scoped to Tenant)
    -- Admin
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true);

    -- Editor
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('editor', 'Content Editor', v_tenant_id, true);

    -- Author
    INSERT INTO public.roles (name, description, tenant_id, is_system)
    VALUES ('author', 'Content Author', v_tenant_id, true);

    -- 3. Create Default Pages (Home, About, Contact)
    -- Homepage
    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id, 
        'Home', 
        'home', 
        '{"root":{"props":{"title":"Home"},"children":[]}}', 
        'published', 
        true, 
        'homepage', 
        (SELECT auth.uid()) -- Safe auth.uid() usage
    );

    -- About
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

    -- 4. Create Default Menu Items (Header)
    -- Fixed to match schema: label, url, group_label, is_public, order
    
    -- Home Link
    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'Home', '/', 'header', true, true, 1);

    -- About Link
    INSERT INTO public.menus (tenant_id, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'About', '/about', 'header', true, true, 2);

    RETURN jsonb_build_object(
        'tenant_id', v_tenant_id,
        'message', 'Tenant created with default data.'
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (NULLIF(current_setting('app.current_tenant_id', true), '')::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.update_content_translations_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

/* grant delete on table "public"."modules" to "anon";

grant insert on table "public"."modules" to "anon";

grant references on table "public"."modules" to "anon";

grant select on table "public"."modules" to "anon";

grant trigger on table "public"."modules" to "anon";

grant truncate on table "public"."modules" to "anon";

grant update on table "public"."modules" to "anon";

grant delete on table "public"."modules" to "authenticated";

grant insert on table "public"."modules" to "authenticated";

grant references on table "public"."modules" to "authenticated";

grant select on table "public"."modules" to "authenticated";

grant trigger on table "public"."modules" to "authenticated";

grant truncate on table "public"."modules" to "authenticated";

grant update on table "public"."modules" to "authenticated";

grant delete on table "public"."modules" to "service_role";

grant insert on table "public"."modules" to "service_role";

grant references on table "public"."modules" to "service_role";

grant select on table "public"."modules" to "service_role";

grant trigger on table "public"."modules" to "service_role";

grant truncate on table "public"."modules" to "service_role";

grant update on table "public"."modules" to "service_role"; */


drop policy if exists "audit_logs_insert_unified" on "public"."audit_logs";

  create policy "audit_logs_insert_unified"
  on "public"."audit_logs"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR ((tenant_id IS NULL) AND (( SELECT auth.uid() AS uid) IS NOT NULL))));



drop policy if exists "audit_logs_select_unified" on "public"."audit_logs";

  create policy "audit_logs_select_unified"
  on "public"."audit_logs"
  as permissive
  for select
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR ((tenant_id IS NULL) AND public.is_platform_admin()) OR public.is_platform_admin()));



drop policy if exists "content_translations_delete_tenant" on "public"."content_translations";

  create policy "content_translations_delete_tenant"
  on "public"."content_translations"
  as permissive
  for delete
  to public
using ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "content_translations_insert_tenant" on "public"."content_translations";

  create policy "content_translations_insert_tenant"
  on "public"."content_translations"
  as permissive
  for insert
  to public
with check ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "content_translations_read_all" on "public"."content_translations";

  create policy "content_translations_read_all"
  on "public"."content_translations"
  as permissive
  for select
  to public
using (true);



drop policy if exists "content_translations_update_tenant" on "public"."content_translations";

  create policy "content_translations_update_tenant"
  on "public"."content_translations"
  as permissive
  for update
  to public
using ((tenant_id = public.get_current_tenant_id()))
with check ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "modules_read_policy" on "public"."modules";

  create policy "modules_read_policy"
  on "public"."modules"
  as permissive
  for select
  to public
using ((public.is_platform_admin() OR ((tenant_id = public.get_current_tenant_id()) AND public.is_admin_or_above())));



drop policy if exists "page_files_delete_tenant" on "public"."page_files";

  create policy "page_files_delete_tenant"
  on "public"."page_files"
  as permissive
  for delete
  to public
using ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "page_files_insert_tenant" on "public"."page_files";

  create policy "page_files_insert_tenant"
  on "public"."page_files"
  as permissive
  for insert
  to public
with check ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "page_files_read_all" on "public"."page_files";

  create policy "page_files_read_all"
  on "public"."page_files"
  as permissive
  for select
  to public
using (true);



drop policy if exists "page_files_update_tenant" on "public"."page_files";

  create policy "page_files_update_tenant"
  on "public"."page_files"
  as permissive
  for update
  to public
using ((tenant_id = public.get_current_tenant_id()))
with check ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "page_tags_delete_tenant" on "public"."page_tags";

  create policy "page_tags_delete_tenant"
  on "public"."page_tags"
  as permissive
  for delete
  to public
using ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "page_tags_insert_tenant" on "public"."page_tags";

  create policy "page_tags_insert_tenant"
  on "public"."page_tags"
  as permissive
  for insert
  to public
with check ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "page_tags_read_all" on "public"."page_tags";

  create policy "page_tags_read_all"
  on "public"."page_tags"
  as permissive
  for select
  to public
using (true);



drop policy if exists "page_tags_update_tenant" on "public"."page_tags";

  create policy "page_tags_update_tenant"
  on "public"."page_tags"
  as permissive
  for update
  to public
using ((tenant_id = public.get_current_tenant_id()))
with check ((tenant_id = public.get_current_tenant_id()));



drop policy if exists "role_permissions_insert_policy" on "public"."role_permissions";

  create policy "role_permissions_insert_policy"
  on "public"."role_permissions"
  as permissive
  for insert
  to authenticated
with check ((public.is_super_admin() AND (deleted_at IS NULL)));



drop policy if exists "role_permissions_update_policy" on "public"."role_permissions";

  create policy "role_permissions_update_policy"
  on "public"."role_permissions"
  as permissive
  for update
  to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());



drop policy if exists "roles_select_unified" on "public"."roles";

  create policy "roles_select_unified"
  on "public"."roles"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()));



drop policy if exists "sso_providers_isolation_policy" on "public"."sso_providers";

  create policy "sso_providers_isolation_policy"
  on "public"."sso_providers"
  as permissive
  for all
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



/*   create policy "articles_delete_unified"
  on "public"."articles"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "articles_insert_unified"
  on "public"."articles"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "articles_select_unified"
  on "public"."articles"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "articles_update_unified"
  on "public"."articles"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "portfolio_delete_unified"
  on "public"."portfolio"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "portfolio_insert_unified"
  on "public"."portfolio"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "portfolio_select_unified"
  on "public"."portfolio"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "portfolio_update_unified"
  on "public"."portfolio"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin())); */



  create policy "Regions tenant isolation"
  on "public"."regions"
  as permissive
  for all
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



/*   create policy "testimonies_delete_unified"
  on "public"."testimonies"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "testimonies_insert_unified"
  on "public"."testimonies"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "testimonies_select_unified"
  on "public"."testimonies"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "testimonies_update_unified"
  on "public"."testimonies"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin())); */



