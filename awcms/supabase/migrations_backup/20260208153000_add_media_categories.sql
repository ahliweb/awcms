-- Add category_id to files table
ALTER TABLE "public"."files" 
ADD COLUMN IF NOT EXISTS "category_id" uuid REFERENCES "public"."categories"("id") ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS "files_category_id_idx" ON "public"."files"("category_id");
