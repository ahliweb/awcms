SET client_min_messages TO warning;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'content_translations') THEN
        DROP TRIGGER IF EXISTS "content_translations_updated_at" ON "public"."content_translations";
    END IF;
END $$;

drop policy "audit_logs_insert" on "public"."audit_logs";

drop policy "audit_logs_select" on "public"."audit_logs";

-- REMOVED: drops for content_translations, funfacts, page_files, page_tags, partners, provinces


drop policy "role_permissions_delete_admin" on "public"."role_permissions";

drop policy "role_permissions_insert_admin" on "public"."role_permissions";

drop policy "role_permissions_update_admin" on "public"."role_permissions";

drop policy "roles_select_abac" on "public"."roles";

-- REMOVED: drops for services

drop policy "sso_providers_select_abac" on "public"."sso_providers";

-- REMOVED: drops for teams

drop policy "articles_delete_unified" on "public"."articles";

drop policy "articles_insert_unified" on "public"."articles";

drop policy "articles_select_unified" on "public"."articles";

drop policy "articles_update_unified" on "public"."articles";

drop policy "portfolio_delete_unified" on "public"."portfolio";

drop policy "portfolio_insert_unified" on "public"."portfolio";

drop policy "portfolio_select_unified" on "public"."portfolio";

drop policy "portfolio_update_unified" on "public"."portfolio";

drop policy "Regions tenant isolation" on "public"."regions";

drop policy "testimonies_delete_unified" on "public"."testimonies";

drop policy "testimonies_insert_unified" on "public"."testimonies";

drop policy "testimonies_select_unified" on "public"."testimonies";

drop policy "testimonies_update_unified" on "public"."testimonies";

-- REMOVED: revokes and constraint drops for new tables

drop function if exists "public"."auth_is_admin"();

drop function if exists "public"."cleanup_old_login_audit_logs"();

drop function if exists "public"."current_auth_user_id"();

drop function if exists "public"."current_user_tenant_id"();

drop function if exists "public"."get_current_tenant_id"();

drop function if exists "public"."get_current_user_id"();

drop function if exists "public"."update_content_translations_updated_at"();

drop view if exists "public"."published_articles_view";

-- REMOVED: drops for tables/indexes/columns for new tables

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

create or replace view "public"."published_articles_view" as  SELECT id,
    tenant_id,
    title,
    content,
    excerpt,
    featured_image,
    status,
    author_id,
    created_at,
    updated_at
   FROM public.articles
  WHERE ((status = 'published'::text) AND (deleted_at IS NULL));



  create policy "audit_logs_insert_unified"
  on "public"."audit_logs"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR ((tenant_id IS NULL) AND (auth.uid() IS NOT NULL))));



  create policy "audit_logs_select_unified"
  on "public"."audit_logs"
  as permissive
  for select
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR ((tenant_id IS NULL) AND public.is_platform_admin()) OR public.is_platform_admin()));



  create policy "role_permissions_insert_policy"
  on "public"."role_permissions"
  as permissive
  for insert
  to authenticated
with check ((public.is_super_admin() AND (deleted_at IS NULL)));



  create policy "role_permissions_update_policy"
  on "public"."role_permissions"
  as permissive
  for update
  to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());



  create policy "roles_select_unified"
  on "public"."roles"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()));



  create policy "sso_providers_isolation_policy"
  on "public"."sso_providers"
  as permissive
  for all
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "articles_delete_unified"
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
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "Regions tenant isolation"
  on "public"."regions"
  as permissive
  for all
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "testimonies_delete_unified"
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
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));


