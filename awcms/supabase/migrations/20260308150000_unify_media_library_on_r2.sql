BEGIN;

ALTER TABLE public.media_objects
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS alt_text text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS media_kind text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE public.media_upload_sessions
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS access_control text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.media_upload_sessions
  DROP CONSTRAINT IF EXISTS media_upload_sessions_access_control_check;

ALTER TABLE public.media_upload_sessions
  ADD CONSTRAINT media_upload_sessions_access_control_check
  CHECK (access_control IN ('public', 'private', 'tenant_only'));

ALTER TABLE public.media_objects
  DROP CONSTRAINT IF EXISTS media_objects_media_kind_check;

ALTER TABLE public.media_objects
  ADD CONSTRAINT media_objects_media_kind_check
  CHECK (media_kind IN ('image', 'video', 'audio', 'document', 'other'));

ALTER TABLE public.media_objects
  DROP CONSTRAINT IF EXISTS media_objects_uploader_id_fkey;

ALTER TABLE public.media_objects
  ADD CONSTRAINT media_objects_uploader_id_fkey
  FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.media_upload_sessions
  DROP CONSTRAINT IF EXISTS media_upload_sessions_uploader_id_fkey;

ALTER TABLE public.media_upload_sessions
  ADD CONSTRAINT media_upload_sessions_uploader_id_fkey
  FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE CASCADE;

UPDATE public.media_objects
SET
  title = COALESCE(NULLIF(title, ''), regexp_replace(COALESCE(original_name, file_name), '\.[^.]+$', '')),
  description = COALESCE(description, NULL),
  alt_text = COALESCE(NULLIF(alt_text, ''), regexp_replace(COALESCE(original_name, file_name), '\.[^.]+$', '')),
  media_kind = CASE
    WHEN mime_type LIKE 'image/%' THEN 'image'
    WHEN mime_type LIKE 'video/%' THEN 'video'
    WHEN mime_type LIKE 'audio/%' THEN 'audio'
    WHEN mime_type ILIKE '%pdf%' OR mime_type ILIKE '%document%' OR mime_type ILIKE '%text%' OR mime_type ILIKE '%sheet%' OR mime_type ILIKE '%presentation%' THEN 'document'
    ELSE 'other'
  END,
  slug = COALESCE(
    NULLIF(slug, ''),
    trim(both '-' from regexp_replace(lower(regexp_replace(COALESCE(original_name, file_name), '\.[^.]+$', '')), '[^a-z0-9]+', '-', 'g'))
    || '-' || substring(id::text, 1, 8)
  )
WHERE title IS NULL
   OR alt_text IS NULL
   OR slug IS NULL
   OR media_kind = 'other';

CREATE INDEX IF NOT EXISTS idx_media_objects_category_id ON public.media_objects(category_id);
CREATE INDEX IF NOT EXISTS idx_media_objects_media_kind ON public.media_objects(media_kind);
CREATE UNIQUE INDEX IF NOT EXISTS media_objects_tenant_slug_key
  ON public.media_objects(tenant_id, slug)
  WHERE deleted_at IS NULL AND slug IS NOT NULL;

DROP POLICY IF EXISTS media_objects_select_unified ON public.media_objects;
DROP POLICY IF EXISTS media_objects_insert_auth ON public.media_objects;
DROP POLICY IF EXISTS media_objects_update_auth ON public.media_objects;

CREATE POLICY media_objects_select_unified
  ON public.media_objects
  FOR SELECT
  TO public
  USING (
    ((access_control = 'public' AND deleted_at IS NULL AND status = 'uploaded'))
    OR (
      deleted_at IS NULL
      AND (
        public.is_platform_admin()
        OR (
          tenant_id = public.current_tenant_id()
          AND public.has_permission('tenant.files.read')
        )
      )
    )
  );

CREATE POLICY media_objects_insert_auth
  ON public.media_objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.create')
        OR public.has_permission('tenant.files.manage')
      )
    )
  );

CREATE POLICY media_objects_update_auth
  ON public.media_objects
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.update')
        OR public.has_permission('tenant.files.delete')
        OR public.has_permission('tenant.files.manage')
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.update')
        OR public.has_permission('tenant.files.delete')
        OR public.has_permission('tenant.files.manage')
      )
    )
  );

DROP POLICY IF EXISTS media_upload_sessions_select_auth ON public.media_upload_sessions;
DROP POLICY IF EXISTS media_upload_sessions_insert_auth ON public.media_upload_sessions;
DROP POLICY IF EXISTS media_upload_sessions_update_auth ON public.media_upload_sessions;

CREATE POLICY media_upload_sessions_select_auth
  ON public.media_upload_sessions
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.read')
        OR public.has_permission('tenant.files.create')
        OR public.has_permission('tenant.files.manage')
      )
    )
  );

CREATE POLICY media_upload_sessions_insert_auth
  ON public.media_upload_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.create')
        OR public.has_permission('tenant.files.manage')
      )
    )
  );

CREATE POLICY media_upload_sessions_update_auth
  ON public.media_upload_sessions
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.create')
        OR public.has_permission('tenant.files.update')
        OR public.has_permission('tenant.files.manage')
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.create')
        OR public.has_permission('tenant.files.update')
        OR public.has_permission('tenant.files.manage')
      )
    )
  );

INSERT INTO public.resources_registry (
  key,
  label,
  scope,
  type,
  db_table,
  icon,
  permission_prefix,
  active,
  created_at,
  updated_at
) VALUES (
  'files',
  'Media Library',
  'tenant',
  'media',
  'media_objects',
  'FolderOpen',
  'tenant.files',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    scope = EXCLUDED.scope,
    type = EXCLUDED.type,
    db_table = EXCLUDED.db_table,
    icon = EXCLUDED.icon,
    permission_prefix = EXCLUDED.permission_prefix,
    active = EXCLUDED.active,
    updated_at = NOW();

UPDATE public.resources_registry
SET active = false,
    updated_at = NOW()
WHERE key IN ('media_objects', 'photo_gallery', 'video_gallery');

DELETE FROM public.admin_menus
WHERE key IN ('photo_gallery', 'video_gallery');

UPDATE public.modules
SET status = 'inactive',
    updated_at = NOW()
WHERE slug IN ('photo_gallery', 'video_gallery');

CREATE OR REPLACE FUNCTION public.analyze_file_usage()
RETURNS TABLE(file_path text, usage_count bigint, modules text[])
LANGUAGE sql
STABLE
AS $$
  SELECT '/public/media/' || storage_key AS file_path,
         0::bigint AS usage_count,
         ARRAY[]::text[] AS modules
  FROM public.media_objects
  WHERE deleted_at IS NULL;
$$;

DROP TABLE IF EXISTS public.file_permissions CASCADE;
DROP TABLE IF EXISTS public.photo_gallery_tags CASCADE;
DROP TABLE IF EXISTS public.video_gallery_tags CASCADE;
DROP TABLE IF EXISTS public.photo_gallery CASCADE;
DROP TABLE IF EXISTS public.video_gallery CASCADE;
DROP TABLE IF EXISTS public.files CASCADE;

COMMIT;
