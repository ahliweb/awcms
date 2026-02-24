SET client_min_messages TO warning;

-- Ensure a non-partial unique constraint exists for tenant-scoped extension slugs.
-- This supports upsert operations that target (tenant_id, slug).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'extensions'
      AND c.conname = 'extensions_tenant_slug_unique'
  ) THEN
    ALTER TABLE public.extensions
      ADD CONSTRAINT extensions_tenant_slug_unique UNIQUE (tenant_id, slug);
  END IF;
END $$;
