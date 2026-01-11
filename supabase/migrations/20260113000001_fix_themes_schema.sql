-- Fix Themes Schema

-- Add deleted_at if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'themes' AND column_name = 'deleted_at') THEN
        ALTER TABLE "public"."themes" ADD COLUMN "deleted_at" timestamp with time zone;
        CREATE INDEX idx_themes_deleted_at ON "public"."themes" ("deleted_at");
    END IF;
END $$;

-- Seed Default Theme (AwTemplate 01)
INSERT INTO "public"."themes" (
    name,
    slug,
    is_active,
    config,
    description,
    tenant_id -- Assuming multi-tenancy, usually seed data might need a specific tenant or be global (null). 
              -- Themes often have tenant_id. If RLS enforces tenant_id, we need to be careful.
              -- However, for a default system theme, it might be shared or need to be inserted for the context tenant.
              -- Since this is a migration, we can't easily guess the tenant_id unless we fetch it.
              -- Let's assume global themes are null or we insert for a known seed tenant if exists.
              -- Or better: Insert without tenant_id if allowed, or check if table allows nulls.
              -- Checking the table def: "tenant_id" uuid. No "not null" constraint seen in create table snippet?
              -- Line 1170: "tenant_id" uuid.
              -- So NULL is allowed.
)
SELECT
    'AwTemplate 01',
    'awtemplate01',
    true,
    '{}'::jsonb,
    'Default system theme',
    NULL
WHERE NOT EXISTS (
    SELECT 1 FROM "public"."themes" WHERE slug = 'awtemplate01'
);
