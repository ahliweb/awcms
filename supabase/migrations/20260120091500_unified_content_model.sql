SET client_min_messages TO warning;

-- Migration: Unified Content Model
-- Description: Add category_id, SEO fields, page_tags, page_files, content_translations tables

-- =============================================================================
-- 1. Extend pages table with category and SEO fields
-- =============================================================================
ALTER TABLE public.pages 
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meta_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_keywords TEXT,
  ADD COLUMN IF NOT EXISTS og_image TEXT,
  ADD COLUMN IF NOT EXISTS canonical_url TEXT;

-- Index for category lookups
CREATE INDEX IF NOT EXISTS idx_pages_category_id ON public.pages(category_id);

-- =============================================================================
-- 2. Create page_tags junction table (mirrors blog_tags)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.page_tags (
  page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (page_id, tag_id)
);

-- Indexes for page_tags
CREATE INDEX IF NOT EXISTS idx_page_tags_page_id ON public.page_tags(page_id);
CREATE INDEX IF NOT EXISTS idx_page_tags_tag_id ON public.page_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_page_tags_tenant_id ON public.page_tags(tenant_id);

-- =============================================================================
-- 3. Create page_files junction table for file attachments
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.page_files (
  page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (page_id, file_id)
);

-- Indexes for page_files
CREATE INDEX IF NOT EXISTS idx_page_files_page_id ON public.page_files(page_id);
CREATE INDEX IF NOT EXISTS idx_page_files_file_id ON public.page_files(file_id);
CREATE INDEX IF NOT EXISTS idx_page_files_tenant_id ON public.page_files(tenant_id);

-- =============================================================================
-- 4. Create content_translations table for i18n support
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.content_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL CHECK (content_type IN ('page', 'blog')),
  content_id UUID NOT NULL,
  locale TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  content TEXT,
  excerpt TEXT,
  meta_description TEXT,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_type, content_id, locale, tenant_id)
);

-- Indexes for content_translations
CREATE INDEX IF NOT EXISTS idx_content_translations_content ON public.content_translations(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_content_translations_locale ON public.content_translations(locale);
CREATE INDEX IF NOT EXISTS idx_content_translations_tenant_id ON public.content_translations(tenant_id);

-- =============================================================================
-- 5. Add sync_source_id for cross-tenant synchronization
-- =============================================================================
ALTER TABLE public.pages 
  ADD COLUMN IF NOT EXISTS sync_source_id UUID;

ALTER TABLE IF EXISTS public.blogs 
  ADD COLUMN IF NOT EXISTS sync_source_id UUID;

ALTER TABLE public.categories 
  ADD COLUMN IF NOT EXISTS sync_source_id UUID;

ALTER TABLE public.tags 
  ADD COLUMN IF NOT EXISTS sync_source_id UUID;

ALTER TABLE public.menus 
  ADD COLUMN IF NOT EXISTS sync_source_id UUID;

-- =============================================================================
-- 6. RLS Policies for new tables
-- =============================================================================

-- page_tags RLS
ALTER TABLE public.page_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "page_tags_tenant_isolation" ON public.page_tags;
DROP POLICY IF EXISTS "page_tags_select_public" ON public.page_tags;
DROP POLICY IF EXISTS "page_tags_anon_read" ON public.page_tags;

CREATE POLICY "page_tags_read_all" ON public.page_tags
  FOR SELECT USING (true);

CREATE POLICY "page_tags_insert_tenant" ON public.page_tags
  FOR INSERT WITH CHECK (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

CREATE POLICY "page_tags_update_tenant" ON public.page_tags
  FOR UPDATE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

CREATE POLICY "page_tags_delete_tenant" ON public.page_tags
  FOR DELETE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

-- page_files RLS
ALTER TABLE public.page_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "page_files_tenant_isolation" ON public.page_files;
DROP POLICY IF EXISTS "page_files_select_public" ON public.page_files;
DROP POLICY IF EXISTS "page_files_anon_read" ON public.page_files;

CREATE POLICY "page_files_read_all" ON public.page_files
  FOR SELECT USING (true);

CREATE POLICY "page_files_insert_tenant" ON public.page_files
  FOR INSERT WITH CHECK (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

CREATE POLICY "page_files_update_tenant" ON public.page_files
  FOR UPDATE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

CREATE POLICY "page_files_delete_tenant" ON public.page_files
  FOR DELETE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

-- content_translations RLS
ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_translations_tenant_isolation" ON public.content_translations;
DROP POLICY IF EXISTS "content_translations_select_public" ON public.content_translations;
DROP POLICY IF EXISTS "content_translations_anon_read" ON public.content_translations;

CREATE POLICY "content_translations_read_all" ON public.content_translations
  FOR SELECT USING (true);

CREATE POLICY "content_translations_insert_tenant" ON public.content_translations
  FOR INSERT WITH CHECK (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

CREATE POLICY "content_translations_update_tenant" ON public.content_translations
  FOR UPDATE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

CREATE POLICY "content_translations_delete_tenant" ON public.content_translations
  FOR DELETE USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::uuid,
      (SELECT tenant_id FROM public.users WHERE id = (SELECT auth.uid()))
    )
  );

-- =============================================================================
-- 7. Update trigger for content_translations
-- =============================================================================
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

DROP TRIGGER IF EXISTS content_translations_updated_at ON public.content_translations;
CREATE TRIGGER content_translations_updated_at
  BEFORE UPDATE ON public.content_translations
  FOR EACH ROW EXECUTE FUNCTION public.update_content_translations_updated_at();
