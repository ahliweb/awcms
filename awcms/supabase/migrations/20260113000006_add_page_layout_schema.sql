-- Add layout_key and content_type to pages table
ALTER TABLE "public"."pages" 
ADD COLUMN IF NOT EXISTS "layout_key" text DEFAULT 'pongo.standard',
ADD COLUMN IF NOT EXISTS "content_type" text DEFAULT 'richtext';

-- Add comment
COMMENT ON COLUMN "public"."pages"."layout_key" IS 'Layout template key (e.g. pone.standard, pongo.landing)';
COMMENT ON COLUMN "public"."pages"."content_type" IS 'Content renderer type: richtext, markdown, or visual_builder';

-- Safe update for existing rows
UPDATE "public"."pages" SET "layout_key" = 'pongo.standard' WHERE "layout_key" IS NULL;
UPDATE "public"."pages" SET "content_type" = 'richtext' WHERE "content_type" IS NULL;
