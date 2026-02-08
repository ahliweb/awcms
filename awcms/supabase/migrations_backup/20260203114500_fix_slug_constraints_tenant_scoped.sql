SET client_min_messages TO warning;

-- Make slug uniqueness tenant-scoped for tenant-owned content

-- Blogs
ALTER TABLE public.blogs
  DROP CONSTRAINT IF EXISTS articles_slug_key;
DROP INDEX IF EXISTS public.articles_slug_key;
DROP INDEX IF EXISTS public.idx_articles_tenant_slug;
CREATE UNIQUE INDEX IF NOT EXISTS blogs_tenant_slug_key
  ON public.blogs (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Categories
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_slug_key;
DROP INDEX IF EXISTS public.categories_slug_key;
DROP INDEX IF EXISTS public.idx_categories_tenant_slug;
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_slug_key
  ON public.categories (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Extensions
ALTER TABLE public.extensions
  DROP CONSTRAINT IF EXISTS extensions_slug_key;
DROP INDEX IF EXISTS public.extensions_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS extensions_tenant_slug_key
  ON public.extensions (tenant_id, slug)
  WHERE deleted_at IS NULL AND tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS extensions_system_slug_key
  ON public.extensions (slug)
  WHERE deleted_at IS NULL AND tenant_id IS NULL;

-- Photo Gallery
ALTER TABLE public.photo_gallery
  DROP CONSTRAINT IF EXISTS photo_gallery_slug_key;
DROP INDEX IF EXISTS public.photo_gallery_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS photo_gallery_tenant_slug_key
  ON public.photo_gallery (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Portfolio
ALTER TABLE public.portfolio
  DROP CONSTRAINT IF EXISTS portfolio_slug_key;
DROP INDEX IF EXISTS public.portfolio_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_tenant_slug_key
  ON public.portfolio (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Product Types
ALTER TABLE public.product_types
  DROP CONSTRAINT IF EXISTS product_types_slug_key;
DROP INDEX IF EXISTS public.product_types_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS product_types_tenant_slug_key
  ON public.product_types (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Products
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_slug_key;
DROP INDEX IF EXISTS public.products_slug_key;
DROP INDEX IF EXISTS public.idx_products_tenant_slug;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_slug_key
  ON public.products (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Templates
ALTER TABLE public.templates
  DROP CONSTRAINT IF EXISTS templates_slug_key;
DROP INDEX IF EXISTS public.templates_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS templates_tenant_slug_key
  ON public.templates (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Testimonies
ALTER TABLE public.testimonies
  DROP CONSTRAINT IF EXISTS testimonies_slug_key;
DROP INDEX IF EXISTS public.testimonies_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS testimonies_tenant_slug_key
  ON public.testimonies (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Themes
ALTER TABLE public.themes
  DROP CONSTRAINT IF EXISTS themes_slug_key;
DROP INDEX IF EXISTS public.themes_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS themes_tenant_slug_key
  ON public.themes (tenant_id, slug)
  WHERE deleted_at IS NULL;

-- Video Gallery
ALTER TABLE public.video_gallery
  DROP CONSTRAINT IF EXISTS video_gallery_slug_key;
DROP INDEX IF EXISTS public.video_gallery_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS video_gallery_tenant_slug_key
  ON public.video_gallery (tenant_id, slug)
  WHERE deleted_at IS NULL;
