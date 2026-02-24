-- Fix published_articles_view to use security_invoker (Advisor: security_definer_view)
ALTER VIEW public.published_articles_view SET (security_invoker = true);

-- Fix RLS policies for page_tags (Advisor: auth_rls_initplan)
DROP POLICY IF EXISTS "page_tags_insert_tenant" ON "public"."page_tags";
CREATE POLICY "page_tags_insert_tenant" ON "public"."page_tags"
AS PERMISSIVE FOR INSERT TO public
WITH CHECK (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "page_tags_update_tenant" ON "public"."page_tags";
CREATE POLICY "page_tags_update_tenant" ON "public"."page_tags"
AS PERMISSIVE FOR UPDATE TO public
USING (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
)
WITH CHECK (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "page_tags_delete_tenant" ON "public"."page_tags";
CREATE POLICY "page_tags_delete_tenant" ON "public"."page_tags"
AS PERMISSIVE FOR DELETE TO public
USING (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);

-- Fix RLS policies for page_files (Advisor: auth_rls_initplan)
DROP POLICY IF EXISTS "page_files_insert_tenant" ON "public"."page_files";
CREATE POLICY "page_files_insert_tenant" ON "public"."page_files"
AS PERMISSIVE FOR INSERT TO public
WITH CHECK (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "page_files_update_tenant" ON "public"."page_files";
CREATE POLICY "page_files_update_tenant" ON "public"."page_files"
AS PERMISSIVE FOR UPDATE TO public
USING (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
)
WITH CHECK (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "page_files_delete_tenant" ON "public"."page_files";
CREATE POLICY "page_files_delete_tenant" ON "public"."page_files"
AS PERMISSIVE FOR DELETE TO public
USING (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);

-- Fix RLS policies for content_translations (Advisor: auth_rls_initplan)
DROP POLICY IF EXISTS "content_translations_insert_tenant" ON "public"."content_translations";
CREATE POLICY "content_translations_insert_tenant" ON "public"."content_translations"
AS PERMISSIVE FOR INSERT TO public
WITH CHECK (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "content_translations_update_tenant" ON "public"."content_translations";
CREATE POLICY "content_translations_update_tenant" ON "public"."content_translations"
AS PERMISSIVE FOR UPDATE TO public
USING (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
)
WITH CHECK (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "content_translations_delete_tenant" ON "public"."content_translations";
CREATE POLICY "content_translations_delete_tenant" ON "public"."content_translations"
AS PERMISSIVE FOR DELETE TO public
USING (
  tenant_id = COALESCE(
    (SELECT current_setting('app.current_tenant_id', true)::uuid),
    (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
);
