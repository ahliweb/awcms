drop policy "admin_menus_select_unified" on "public"."admin_menus";

drop policy "content_translations_read_all" on "public"."content_translations";

drop policy "page_files_read_all" on "public"."page_files";

drop policy "seo_metadata_select_public" on "public"."seo_metadata";

drop policy "template_strings_select_unified" on "public"."template_strings";

alter table "public"."extensions" drop constraint "extensions_tenant_slug_unique";

drop index if exists "public"."extensions_tenant_slug_unique";

alter table "public"."admin_menus" add column "tenant_id" uuid;

CREATE INDEX idx_admin_menus_tenant_id ON public.admin_menus USING btree (tenant_id);

CREATE INDEX idx_analytics_daily_tenant_id ON public.analytics_daily USING btree (tenant_id);

CREATE INDEX idx_analytics_events_tenant_id ON public.analytics_events USING btree (tenant_id);

CREATE INDEX idx_mobile_app_config_tenant_id ON public.mobile_app_config USING btree (tenant_id);

CREATE INDEX idx_modules_tenant_id ON public.modules USING btree (tenant_id);

CREATE INDEX idx_tenant_channels_tenant_id ON public.tenant_channels USING btree (tenant_id);

CREATE INDEX idx_tenant_resource_rules_tenant_id ON public.tenant_resource_rules USING btree (tenant_id);

CREATE INDEX idx_tenant_role_links_tenant_id ON public.tenant_role_links USING btree (tenant_id);

CREATE INDEX roles_created_at_idx ON public.roles USING btree (created_at);

alter table "public"."admin_menus" add constraint "admin_menus_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."admin_menus" validate constraint "admin_menus_tenant_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(p_name text, p_slug text, p_domain text DEFAULT NULL::text, p_tier text DEFAULT 'free'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.create_tenant_with_defaults(
    p_name,
    p_slug,
    p_domain,
    p_tier,
    NULL,
    'auto'
  );
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
  -- Restrict tag usage to articles only
  IF p_resource_type != 'articles' THEN
    RETURN;
  END IF;

  target_table := to_regclass('public.article_tags');
  
  IF target_table IS NULL THEN
    RETURN;
  END IF;

  -- Delete existing tags for this resource
  DELETE FROM "public"."article_tags" WHERE article_id = p_resource_id;

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
      INSERT INTO "public"."article_tags" (article_id, tag_id) VALUES (p_resource_id, v_tag_id);
    END LOOP;
  END IF;
END;
$function$
;


  create policy "categories_select_tenant"
  on "public"."categories"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "admin_menus_select_unified"
  on "public"."admin_menus"
  as permissive
  for select
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "content_translations_read_all"
  on "public"."content_translations"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



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



