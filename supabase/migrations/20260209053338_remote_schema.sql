DROP TABLE IF EXISTS "public"."announcement_tags" CASCADE;
DROP TABLE IF EXISTS "public"."contact_message_tags" CASCADE;
DROP TABLE IF EXISTS "public"."contact_tags" CASCADE;
DROP TABLE IF EXISTS "public"."page_tags" CASCADE;
DROP TABLE IF EXISTS "public"."photo_gallery_tags" CASCADE;
DROP TABLE IF EXISTS "public"."portfolio_tags" CASCADE;
DROP TABLE IF EXISTS "public"."product_tags" CASCADE;
DROP TABLE IF EXISTS "public"."product_type_tags" CASCADE;
DROP TABLE IF EXISTS "public"."promotion_tags" CASCADE;
DROP TABLE IF EXISTS "public"."testimony_tags" CASCADE;
DROP TABLE IF EXISTS "public"."video_gallery_tags" CASCADE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'category_id') THEN
        ALTER TABLE "public"."contacts" ADD COLUMN "category_id" uuid;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'category_id') THEN
        ALTER TABLE "public"."files" ADD COLUMN "category_id" uuid;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS files_category_id_idx ON public.files USING btree (category_id);

CREATE INDEX IF NOT EXISTS idx_contacts_category_id ON public.contacts USING btree (category_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND table_name = 'contacts' AND constraint_name = 'contacts_category_id_fkey') THEN
        alter table "public"."contacts" add constraint "contacts_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;
        alter table "public"."contacts" validate constraint "contacts_category_id_fkey";
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND table_name = 'files' AND constraint_name = 'files_category_id_fkey') THEN
        alter table "public"."files" add constraint "files_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;
        alter table "public"."files" validate constraint "files_category_id_fkey";
    END IF;
END $$;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_storage_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id UUID;
    v_public_url TEXT;
BEGIN
    -- Extract tenant_id from the first path token
    -- Pattern: bucket/tenant-id/path/to/file
    BEGIN
        v_tenant_id := (NEW.path_tokens[1])::UUID;
    EXCEPTION WHEN OTHERS THEN
        -- If the first token is not a valid UUID, skip synchronization
        -- This handles system files or non-tenant organized buckets
        RETURN NEW;
    END;

    -- Construct Public URL (using standard Supabase pattern)
    -- Format: https://[project-id].supabase.co/storage/v1/object/public/[bucket]/[path]
    -- Note: Project ID is stable per environment
    v_public_url := 'https://db.imveukxxtdwjgwsafwfl.supabase.co/storage/v1/object/public/' || NEW.bucket_id || '/' || NEW.name;

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.files (
            id,
            name,
            file_path,
            file_size,
            file_type,
            bucket_name,
            uploaded_by,
            tenant_id,
            created_at,
            updated_at
        ) VALUES (
            NEW.id,
            NEW.name,
            v_public_url,
            (NEW.metadata->>'size')::BIGINT,
            NEW.metadata->>'mimetype',
            NEW.bucket_id,
            NEW.owner,
            v_tenant_id,
            NEW.created_at,
            NEW.updated_at
        ) ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            file_path = EXCLUDED.file_path,
            file_size = EXCLUDED.file_size,
            file_type = EXCLUDED.file_type,
            updated_at = EXCLUDED.updated_at;

    ELSIF (TG_OP = 'UPDATE') THEN
        UPDATE public.files SET
            name = NEW.name,
            file_path = v_public_url,
            file_size = (NEW.metadata->>'size')::BIGINT,
            file_type = NEW.metadata->>'mimetype',
            updated_at = NEW.updated_at,
            tenant_id = v_tenant_id
        WHERE id = NEW.id;

    ELSIF (TG_OP = 'DELETE') THEN
        -- Mark as deleted in public.files
        -- Frontend can decide to purge or keep soft-deleted record
        UPDATE public.files SET
            deleted_at = now()
        WHERE id = OLD.id;
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_resource_tags(p_resource_id uuid, p_resource_type text, p_tags text[], p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;


DROP POLICY IF EXISTS "Enable insert for authenticated users with permission" ON "public"."orders";
  create policy "Enable insert for authenticated users with permission"
  on "public"."orders"
  as permissive
  for insert
  to authenticated
with check (((user_id = auth.uid()) OR public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('create_orders'::text) OR public.has_permission('tenant.orders.create'::text)))));


DROP TRIGGER IF EXISTS objects_delete_delete_prefix ON storage.objects;
CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();

DROP TRIGGER IF EXISTS objects_insert_create_prefix ON storage.objects;
CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();

DROP TRIGGER IF EXISTS objects_update_create_prefix ON storage.objects;
CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();

DROP TRIGGER IF EXISTS tr_sync_storage_to_files ON storage.objects;
CREATE TRIGGER tr_sync_storage_to_files AFTER INSERT OR DELETE OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.handle_storage_sync();

DROP TRIGGER IF EXISTS prefixes_create_hierarchy ON storage.prefixes;
CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();

DROP TRIGGER IF EXISTS prefixes_delete_hierarchy ON storage.prefixes;
CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


