-- 1. Create the sync function in public schema
CREATE OR REPLACE FUNCTION public.handle_storage_sync()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach the trigger to storage.objects
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_sync_storage_to_files') THEN
        CREATE TRIGGER tr_sync_storage_to_files
        AFTER INSERT OR UPDATE OR DELETE ON storage.objects
        FOR EACH ROW EXECUTE FUNCTION public.handle_storage_sync();
    END IF;
END $$;
