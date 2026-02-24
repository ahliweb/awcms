-- Fix multi-tenant unique index for system page types
DROP INDEX IF EXISTS "public"."idx_pages_unique_system_type";
CREATE UNIQUE INDEX "idx_pages_unique_system_type" ON "public"."pages" USING "btree" (
    "tenant_id", 
    "page_type"
) 
WHERE (
    ("page_type" = ANY (ARRAY['homepage'::"text", 'header'::"text", 'footer'::"text", '404'::"text"])) 
    AND ("status" = 'published'::"text") 
    AND ("deleted_at" IS NULL)
);

-- Fix multi-tenant unique index for main page SEO metadata
DROP INDEX IF EXISTS "public"."idx_seo_main_pages";
CREATE UNIQUE INDEX "idx_seo_main_pages" ON "public"."seo_metadata" USING "btree" (
    "tenant_id",
    "resource_type"
) 
WHERE ("resource_id" IS NULL);
