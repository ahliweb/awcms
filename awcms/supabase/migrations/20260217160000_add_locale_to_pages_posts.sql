-- Migration: Add locale to pages and posts
-- Timestamp: 20260217160000

-- Pages Table
ALTER TABLE public.pages 
ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';

-- Drop existing constraints/indexes if they exist to allow re-creation
DROP INDEX IF EXISTS idx_pages_slug_tenant;
ALTER TABLE public.pages DROP CONSTRAINT IF EXISTS pages_slug_tenant_id_key;

-- Add new unique constraint
ALTER TABLE public.pages
ADD CONSTRAINT pages_slug_tenant_locale_key UNIQUE (slug, tenant_id, locale);

-- Posts Table
ALTER TABLE public.posts 
ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';

-- Drop existing constraints/indexes
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_slug_tenant_id_key;

-- Add new unique constraint
ALTER TABLE public.posts
ADD CONSTRAINT posts_slug_tenant_locale_key UNIQUE (slug, tenant_id, locale);

-- Update RLS Policies (Optional but good practice to ensure they cover locale if needed)
-- Assuming existing policies filter by tenant_id, they will automatically include all locales.
