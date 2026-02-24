SET client_min_messages TO warning;

-- Ensure page slugs are unique per tenant (not global)

ALTER TABLE public.pages
  DROP CONSTRAINT IF EXISTS pages_slug_key;

DROP INDEX IF EXISTS public.pages_slug_key;
DROP INDEX IF EXISTS public.idx_pages_tenant_slug;

CREATE UNIQUE INDEX IF NOT EXISTS pages_tenant_slug_key
  ON public.pages (tenant_id, slug)
  WHERE deleted_at IS NULL;
