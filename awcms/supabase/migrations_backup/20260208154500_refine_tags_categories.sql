-- Migration: Refine Tags and Categories Usage
-- 1. Drop unused tag join tables (except article_tags for Blog)
DROP TABLE IF EXISTS "public"."page_tags";
DROP TABLE IF EXISTS "public"."product_tags";
DROP TABLE IF EXISTS "public"."product_type_tags";
DROP TABLE IF EXISTS "public"."portfolio_tags";
DROP TABLE IF EXISTS "public"."announcement_tags";
DROP TABLE IF EXISTS "public"."promotion_tags";
DROP TABLE IF EXISTS "public"."testimony_tags";
DROP TABLE IF EXISTS "public"."photo_gallery_tags";
DROP TABLE IF EXISTS "public"."video_gallery_tags";
DROP TABLE IF EXISTS "public"."contact_tags";
DROP TABLE IF EXISTS "public"."contact_message_tags";

-- 2. Update sync_resource_tags to restrict to Blog (articles/posts)
CREATE OR REPLACE FUNCTION "public"."sync_resource_tags"("p_resource_id" "uuid", "p_resource_type" "text", "p_tags" "text"[], "p_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_tag_id UUID;
  v_tag_name TEXT;
  v_slug TEXT;
  target_table regclass;
BEGIN
  -- Restrict tag usage to articles only
  IF p_resource_type != 'articles' THEN
    RETURN;
  END IF;

  target_table := to_regclass('public.article_tags');
  
  IF target_table IS NULL THEN
    RETURN;
  END IF;

  -- Delete existing tags for this resource
  DELETE FROM "public"."article_tags" WHERE article_id = p_resource_id;

  IF p_tags IS NOT NULL THEN
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
      v_slug := trim(both '-' from lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g')));

      -- Ensure tag exists in public.tags (tenant-isolated)
      INSERT INTO public.tags (name, slug, tenant_id)
      VALUES (v_tag_name, v_slug, p_tenant_id)
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = v_tag_name
      RETURNING id INTO v_tag_id;

      -- Link tag to article
      INSERT INTO "public"."article_tags" (article_id, tag_id) VALUES (p_resource_id, v_tag_id);
    END LOOP;
  END IF;
END;
$_$;

ALTER FUNCTION "public"."sync_resource_tags"("p_resource_id" "uuid", "p_resource_type" "text", "p_tags" "text"[], "p_tenant_id" "uuid") OWNER TO "postgres";

-- 3. Add category_id to contacts table (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'category_id') THEN
        ALTER TABLE "public"."contacts" ADD COLUMN "category_id" uuid;
        ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;
        CREATE INDEX "idx_contacts_category_id" ON "public"."contacts" ("category_id");
    END IF;
END
$$;
