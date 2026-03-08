BEGIN;

CREATE OR REPLACE FUNCTION public.update_menu_order(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $function$
DECLARE
  item jsonb;
  v_menu public.menus%ROWTYPE;
  v_parent public.menus%ROWTYPE;
  v_parent_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    SELECT *
    INTO v_menu
    FROM public.menus
    WHERE id = (item->>'id')::uuid
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Menu not found';
    END IF;

    IF NOT (
      public.is_platform_admin()
      OR (
        v_menu.tenant_id = public.current_tenant_id()
        AND (
          public.has_permission('tenant.menu.update')
          OR public.has_permission('tenant.menu.create')
          OR public.is_admin_or_above()
        )
      )
    ) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;

    v_parent_id := NULLIF(item->>'parent_id', '')::uuid;

    IF v_parent_id IS NOT NULL THEN
      SELECT *
      INTO v_parent
      FROM public.menus
      WHERE id = v_parent_id
        AND deleted_at IS NULL;

      IF NOT FOUND OR v_parent.tenant_id IS DISTINCT FROM v_menu.tenant_id THEN
        RAISE EXCEPTION 'Invalid parent menu';
      END IF;
    END IF;

    UPDATE public.menus
    SET "order" = COALESCE((item->>'order')::int, "order"),
        parent_id = v_parent_id,
        updated_at = NOW()
    WHERE id = v_menu.id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.soft_delete_menu(p_menu_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_menu public.menus%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_menu
  FROM public.menus
  WHERE id = p_menu_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu not found';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR (
      v_menu.tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.menu.delete')
        OR public.has_permission('tenant.menu.update')
        OR public.is_admin_or_above()
      )
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.menus
  SET deleted_at = NOW(),
      updated_at = NOW()
  WHERE id = p_menu_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_menu_permissions(p_menu_id uuid, p_permissions jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $$
DECLARE
  v_menu public.menus%ROWTYPE;
  item jsonb;
  v_role_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
  INTO v_menu
  FROM public.menus
  WHERE id = p_menu_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu not found';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR (
      v_menu.tenant_id = public.current_tenant_id()
      AND (
        public.has_permission('tenant.menu.update')
        OR public.has_permission('tenant.menu.create')
        OR public.is_admin_or_above()
      )
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  DELETE FROM public.menu_permissions
  WHERE menu_id = p_menu_id;

  FOR item IN SELECT * FROM jsonb_array_elements(p_permissions)
  LOOP
    IF COALESCE((item->>'can_view')::boolean, false) IS NOT TRUE THEN
      CONTINUE;
    END IF;

    v_role_id := (item->>'role_id')::uuid;

    IF NOT EXISTS (
      SELECT 1
      FROM public.roles
      WHERE id = v_role_id
        AND deleted_at IS NULL
        AND (tenant_id = v_menu.tenant_id OR public.is_platform_admin())
    ) THEN
      RAISE EXCEPTION 'Invalid role for menu permissions';
    END IF;

    INSERT INTO public.menu_permissions (menu_id, role_id, can_view, tenant_id, created_by, created_at, updated_at)
    VALUES (p_menu_id, v_role_id, true, v_menu.tenant_id, auth.uid(), NOW(), NOW())
    ON CONFLICT (menu_id, role_id)
    DO UPDATE SET can_view = EXCLUDED.can_view, updated_at = NOW();
  END LOOP;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_menu_order(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_menu_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_menu_order(jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public.soft_delete_menu(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_menu(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.save_menu_permissions(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_menu_permissions(uuid, jsonb) TO service_role;

COMMIT;
