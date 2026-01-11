-- Fix Template Strings Schema

-- Add deleted_at if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'template_strings' AND column_name = 'deleted_at') THEN
        ALTER TABLE "public"."template_strings" ADD COLUMN "deleted_at" timestamp with time zone;
        CREATE INDEX idx_template_strings_deleted_at ON "public"."template_strings" ("deleted_at");
    END IF;
END $$;
