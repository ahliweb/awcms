BEGIN;

CREATE OR REPLACE FUNCTION public.soft_delete_category(p_category_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_category public.categories%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_category
  FROM public.categories
  WHERE id = p_category_id;

  IF NOT FOUND OR v_category.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Category not found';
  END IF;

  v_allowed := public.is_platform_admin()
    OR (
      v_category.tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.categories.delete')
        OR public.has_permission('tenant.categories.update')
        OR public.is_admin_or_above()
      )
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.categories
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_category_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_category(p_category_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_category public.categories%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_category
  FROM public.categories
  WHERE id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found';
  END IF;

  v_allowed := public.is_platform_admin()
    OR (
      v_category.tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.categories.restore')
        OR public.has_permission('tenant.categories.update')
        OR public.has_permission('tenant.categories.delete')
        OR public.is_admin_or_above()
      )
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.categories
  SET deleted_at = NULL,
      updated_at = now()
  WHERE id = p_category_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_tag(p_tag_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_tag public.tags%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_tag
  FROM public.tags
  WHERE id = p_tag_id;

  IF NOT FOUND OR v_tag.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Tag not found';
  END IF;

  v_allowed := public.is_platform_admin()
    OR (
      v_tag.tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.tag.delete')
        OR public.has_permission('tenant.tag.update')
        OR public.is_admin_or_above()
      )
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.tags
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_tag_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_tag(p_tag_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_tag public.tags%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_tag
  FROM public.tags
  WHERE id = p_tag_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tag not found';
  END IF;

  v_allowed := public.is_platform_admin()
    OR (
      v_tag.tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.tag.restore')
        OR public.has_permission('tenant.tag.update')
        OR public.has_permission('tenant.tag.delete')
        OR public.is_admin_or_above()
      )
    );

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.tags
  SET deleted_at = NULL,
      updated_at = now()
  WHERE id = p_tag_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_tag(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_tag(uuid) TO authenticated;

COMMIT;
