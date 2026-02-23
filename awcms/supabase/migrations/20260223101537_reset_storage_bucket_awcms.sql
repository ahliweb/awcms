-- Reset and fix AWCMS storage bucket + policies for tenant-safe media uploads.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  avif_autodetection,
  updated_at
) VALUES (
  'cms-uploads',
  'cms-uploads',
  true,
  52428800,
  NULL,
  false,
  now()
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  avif_autodetection = EXCLUDED.avif_autodetection,
  updated_at = now();

DROP POLICY IF EXISTS public_read_files ON storage.objects;
DROP POLICY IF EXISTS tenant_select_isolation ON storage.objects;
DROP POLICY IF EXISTS tenant_upload_isolation ON storage.objects;
DROP POLICY IF EXISTS tenant_update_isolation ON storage.objects;
DROP POLICY IF EXISTS tenant_delete_isolation ON storage.objects;

CREATE POLICY public_read_files
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'cms-uploads');

CREATE POLICY tenant_select_isolation
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'cms-uploads'
  AND (
    name LIKE public.current_tenant_id()::text || '/%'
    OR public.is_platform_admin()
  )
);

CREATE POLICY tenant_upload_isolation
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cms-uploads'
  AND (
    name LIKE public.current_tenant_id()::text || '/%'
    OR public.is_platform_admin()
  )
);

CREATE POLICY tenant_update_isolation
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'cms-uploads'
  AND (
    name LIKE public.current_tenant_id()::text || '/%'
    OR public.is_platform_admin()
  )
)
WITH CHECK (
  bucket_id = 'cms-uploads'
  AND (
    name LIKE public.current_tenant_id()::text || '/%'
    OR public.is_platform_admin()
  )
);

CREATE POLICY tenant_delete_isolation
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'cms-uploads'
  AND (
    name LIKE public.current_tenant_id()::text || '/%'
    OR public.is_platform_admin()
  )
);

DROP POLICY IF EXISTS anon_read_cms_bucket ON storage.buckets;
DROP POLICY IF EXISTS authenticated_read_cms_bucket ON storage.buckets;
DROP POLICY IF EXISTS platform_admin_manage_cms_bucket ON storage.buckets;

CREATE POLICY anon_read_cms_bucket
ON storage.buckets
FOR SELECT
TO anon
USING (id = 'cms-uploads' AND public = true);

CREATE POLICY authenticated_read_cms_bucket
ON storage.buckets
FOR SELECT
TO authenticated
USING (id = 'cms-uploads');

CREATE POLICY platform_admin_manage_cms_bucket
ON storage.buckets
FOR ALL
TO authenticated
USING (id = 'cms-uploads' AND public.is_platform_admin())
WITH CHECK (id = 'cms-uploads' AND public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.handle_storage_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_object storage.objects%ROWTYPE;
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_object := OLD;
  ELSE
    v_object := NEW;
  END IF;

  IF v_object.bucket_id IS DISTINCT FROM 'cms-uploads' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  BEGIN
    v_tenant_id := split_part(v_object.name, '/', 1)::uuid;
  EXCEPTION WHEN OTHERS THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.files
    SET deleted_at = now(), updated_at = now()
    WHERE id = OLD.id;
    RETURN OLD;
  END IF;

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
    updated_at,
    deleted_at
  ) VALUES (
    v_object.id,
    substring(v_object.name from '[^/]+$'),
    v_object.name,
    NULLIF(v_object.metadata->>'size', '')::bigint,
    COALESCE(v_object.metadata->>'mimetype', 'application/octet-stream'),
    v_object.bucket_id,
    v_object.owner,
    v_tenant_id,
    COALESCE(v_object.created_at, now()),
    COALESCE(v_object.updated_at, now()),
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name = EXCLUDED.name,
    file_path = EXCLUDED.file_path,
    file_size = EXCLUDED.file_size,
    file_type = EXCLUDED.file_type,
    bucket_name = EXCLUDED.bucket_name,
    uploaded_by = EXCLUDED.uploaded_by,
    tenant_id = EXCLUDED.tenant_id,
    updated_at = COALESCE(v_object.updated_at, now()),
    deleted_at = NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_storage_to_files ON storage.objects;
CREATE TRIGGER tr_sync_storage_to_files
AFTER INSERT OR UPDATE OR DELETE ON storage.objects
FOR EACH ROW
EXECUTE FUNCTION public.handle_storage_sync();
