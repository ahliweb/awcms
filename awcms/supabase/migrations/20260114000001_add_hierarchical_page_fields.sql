-- Add hierarchical fields to pages table
ALTER TABLE "public"."pages"
ADD COLUMN IF NOT EXISTS "parent_id" uuid REFERENCES "public"."pages"("id"),
ADD COLUMN IF NOT EXISTS "template_key" text DEFAULT 'awtemplate01',
ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS "nav_visibility" boolean DEFAULT true;

-- Add comments
COMMENT ON COLUMN "public"."pages"."parent_id" IS 'Parent page ID for hierarchy';
COMMENT ON COLUMN "public"."pages"."template_key" IS 'Template key (e.g. awtemplate01)';
COMMENT ON COLUMN "public"."pages"."sort_order" IS 'Order for menu/listing';
COMMENT ON COLUMN "public"."pages"."nav_visibility" IS 'Whether to show in auto-generated menus';

-- Create index for parent_id for faster lookups
CREATE INDEX IF NOT EXISTS "pages_parent_id_idx" ON "public"."pages" ("parent_id");

-- Update existing pages to have default template_key
UPDATE "public"."pages" SET "template_key" = 'awtemplate01' WHERE "template_key" IS NULL;
