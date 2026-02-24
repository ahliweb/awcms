-- Add locale column to menus table
ALTER TABLE "public"."menus" 
ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'en' NOT NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_menus_locale ON "public"."menus" ("locale");

-- Update unique constraint checks if needed (optional for now)
-- We might want to allow same label in different locales
