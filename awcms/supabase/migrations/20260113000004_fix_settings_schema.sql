
-- Fix settings schema by adding deleted_at column
ALTER TABLE settings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload config';
