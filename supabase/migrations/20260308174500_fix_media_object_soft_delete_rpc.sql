BEGIN;

CREATE OR REPLACE FUNCTION public.soft_delete_media_object(p_media_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_media public.media_objects%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_media
  FROM public.media_objects
  WHERE id = p_media_id;

  IF NOT FOUND OR v_media.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Media object not found';
  END IF;

  v_allowed := public.is_platform_admin()
    OR (
      v_media.tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.delete')
        OR public.has_permission('tenant.files.manage')
        OR public.has_permission('tenant.files.update')
        OR public.is_admin_or_above()
      )
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.media_objects
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_media_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_soft_delete_media_objects(p_media_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_media_id uuid;
  v_count integer := 0;
BEGIN
  IF p_media_ids IS NULL OR array_length(p_media_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_media_id IN ARRAY p_media_ids LOOP
    IF public.soft_delete_media_object(v_media_id) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_media_object(p_media_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_media public.media_objects%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_media
  FROM public.media_objects
  WHERE id = p_media_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Media object not found';
  END IF;

  v_allowed := public.is_platform_admin()
    OR (
      v_media.tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.files.restore')
        OR public.has_permission('tenant.files.manage')
        OR public.has_permission('tenant.files.update')
        OR public.is_admin_or_above()
      )
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.media_objects
  SET deleted_at = NULL,
      updated_at = now()
  WHERE id = p_media_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_media_object(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_soft_delete_media_objects(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_media_object(uuid) TO authenticated;

COMMIT;
