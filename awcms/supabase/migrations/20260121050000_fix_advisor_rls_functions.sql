-- Create helper function to consolidate tenant check and improve RLS performance
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (NULLIF(current_setting('app.current_tenant_id', true), '')::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  );
$$;

-- Fix RLS policies for page_tags
DROP POLICY IF EXISTS "page_tags_insert_tenant" ON "public"."page_tags";
CREATE POLICY "page_tags_insert_tenant" ON "public"."page_tags"
AS PERMISSIVE FOR INSERT TO public
WITH CHECK (tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS "page_tags_update_tenant" ON "public"."page_tags";
CREATE POLICY "page_tags_update_tenant" ON "public"."page_tags"
AS PERMISSIVE FOR UPDATE TO public
USING (tenant_id = public.get_current_tenant_id())
WITH CHECK (tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS "page_tags_delete_tenant" ON "public"."page_tags";
CREATE POLICY "page_tags_delete_tenant" ON "public"."page_tags"
AS PERMISSIVE FOR DELETE TO public
USING (tenant_id = public.get_current_tenant_id());

-- Fix RLS policies for page_files
DROP POLICY IF EXISTS "page_files_insert_tenant" ON "public"."page_files";
CREATE POLICY "page_files_insert_tenant" ON "public"."page_files"
AS PERMISSIVE FOR INSERT TO public
WITH CHECK (tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS "page_files_update_tenant" ON "public"."page_files";
CREATE POLICY "page_files_update_tenant" ON "public"."page_files"
AS PERMISSIVE FOR UPDATE TO public
USING (tenant_id = public.get_current_tenant_id())
WITH CHECK (tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS "page_files_delete_tenant" ON "public"."page_files";
CREATE POLICY "page_files_delete_tenant" ON "public"."page_files"
AS PERMISSIVE FOR DELETE TO public
USING (tenant_id = public.get_current_tenant_id());

-- Fix RLS policies for content_translations
DROP POLICY IF EXISTS "content_translations_insert_tenant" ON "public"."content_translations";
CREATE POLICY "content_translations_insert_tenant" ON "public"."content_translations"
AS PERMISSIVE FOR INSERT TO public
WITH CHECK (tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS "content_translations_update_tenant" ON "public"."content_translations";
CREATE POLICY "content_translations_update_tenant" ON "public"."content_translations"
AS PERMISSIVE FOR UPDATE TO public
USING (tenant_id = public.get_current_tenant_id())
WITH CHECK (tenant_id = public.get_current_tenant_id());

DROP POLICY IF EXISTS "content_translations_delete_tenant" ON "public"."content_translations";
CREATE POLICY "content_translations_delete_tenant" ON "public"."content_translations"
AS PERMISSIVE FOR DELETE TO public
USING (tenant_id = public.get_current_tenant_id());
