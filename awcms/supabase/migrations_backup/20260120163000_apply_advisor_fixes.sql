-- Migration: Apply Supabase Advisor Fixes
-- Description: Split RLS policies for optimization and fix function search_path

-- 1. Fix Function Search Path
CREATE OR REPLACE FUNCTION public.update_content_translations_updated_at()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Optimize page_tags RLS (Split policies)
DROP POLICY IF EXISTS "page_tags_tenant_isolation" ON public.page_tags;
DROP POLICY IF EXISTS "page_tags_select_public" ON public.page_tags;
DROP POLICY IF EXISTS "page_tags_anon_read" ON public.page_tags;

DROP POLICY IF EXISTS "page_tags_read_all" ON public.page_tags;
CREATE POLICY "page_tags_read_all" ON public.page_tags
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "page_tags_insert_tenant" ON public.page_tags;
CREATE POLICY "page_tags_insert_tenant" ON public.page_tags
  FOR INSERT WITH CHECK (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "page_tags_update_tenant" ON public.page_tags;
CREATE POLICY "page_tags_update_tenant" ON public.page_tags
  FOR UPDATE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "page_tags_delete_tenant" ON public.page_tags;
CREATE POLICY "page_tags_delete_tenant" ON public.page_tags
  FOR DELETE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

-- 3. Optimize page_files RLS (Split policies)
DROP POLICY IF EXISTS "page_files_tenant_isolation" ON public.page_files;
DROP POLICY IF EXISTS "page_files_select_public" ON public.page_files;
DROP POLICY IF EXISTS "page_files_anon_read" ON public.page_files;

DROP POLICY IF EXISTS "page_files_read_all" ON public.page_files;
CREATE POLICY "page_files_read_all" ON public.page_files
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "page_files_insert_tenant" ON public.page_files;
CREATE POLICY "page_files_insert_tenant" ON public.page_files
  FOR INSERT WITH CHECK (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "page_files_update_tenant" ON public.page_files;
CREATE POLICY "page_files_update_tenant" ON public.page_files
  FOR UPDATE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "page_files_delete_tenant" ON public.page_files;
CREATE POLICY "page_files_delete_tenant" ON public.page_files
  FOR DELETE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

-- 4. Optimize content_translations RLS (Split policies)
DROP POLICY IF EXISTS "content_translations_tenant_isolation" ON public.content_translations;
DROP POLICY IF EXISTS "content_translations_select_public" ON public.content_translations;
DROP POLICY IF EXISTS "content_translations_anon_read" ON public.content_translations;

DROP POLICY IF EXISTS "content_translations_read_all" ON public.content_translations;
CREATE POLICY "content_translations_read_all" ON public.content_translations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "content_translations_insert_tenant" ON public.content_translations;
CREATE POLICY "content_translations_insert_tenant" ON public.content_translations
  FOR INSERT WITH CHECK (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "content_translations_update_tenant" ON public.content_translations;
CREATE POLICY "content_translations_update_tenant" ON public.content_translations
  FOR UPDATE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "content_translations_delete_tenant" ON public.content_translations;
CREATE POLICY "content_translations_delete_tenant" ON public.content_translations
  FOR DELETE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );
