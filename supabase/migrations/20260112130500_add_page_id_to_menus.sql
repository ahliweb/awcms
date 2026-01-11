ALTER TABLE "public"."menus" ADD COLUMN "page_id" uuid;

ALTER TABLE "public"."menus" 
    ADD CONSTRAINT "menus_page_id_fkey" 
    FOREIGN KEY ("page_id") 
    REFERENCES "public"."pages"("id") 
    ON DELETE SET NULL;

CREATE INDEX "menus_page_id_idx" ON "public"."menus" ("page_id");
