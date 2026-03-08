SET client_min_messages TO warning;

DO $$
DECLARE
    v_permission_id uuid;
    v_role_id uuid;
    v_permission_name text;
    v_role_name text;
BEGIN
    FOR v_permission_name IN SELECT unnest(ARRAY[
        'platform.module.read',
        'platform.sidebar.read'
    ])
    LOOP
        SELECT id INTO v_permission_id
        FROM public.permissions
        WHERE name = v_permission_name;

        IF v_permission_id IS NULL THEN
            INSERT INTO public.permissions (name, description, resource, action, module)
            VALUES (
                v_permission_name,
                CASE v_permission_name
                    WHEN 'platform.module.read' THEN 'Can view platform module management'
                    WHEN 'platform.sidebar.read' THEN 'Can view platform sidebar management'
                    ELSE v_permission_name
                END,
                CASE v_permission_name
                    WHEN 'platform.module.read' THEN 'modules'
                    WHEN 'platform.sidebar.read' THEN 'sidebar_manager'
                    ELSE split_part(v_permission_name, '.', 2)
                END,
                split_part(v_permission_name, '.', 3),
                'platform'
            )
            RETURNING id INTO v_permission_id;
        END IF;

        FOR v_role_name IN SELECT unnest(ARRAY['owner', 'super_admin'])
        LOOP
            SELECT id INTO v_role_id
            FROM public.roles
            WHERE name = v_role_name
            LIMIT 1;

            IF v_role_id IS NOT NULL AND NOT EXISTS (
                SELECT 1
                FROM public.role_permissions
                WHERE role_id = v_role_id
                  AND permission_id = v_permission_id
            ) THEN
                INSERT INTO public.role_permissions (role_id, permission_id)
                VALUES (v_role_id, v_permission_id);
            END IF;
        END LOOP;
    END LOOP;
END $$;

UPDATE public.admin_menus AS canonical
SET label = legacy.label,
    path = legacy.path,
    icon = legacy.icon,
    permission = 'platform.module.read',
    group_label = legacy.group_label,
    group_order = legacy.group_order,
    "order" = legacy."order",
    is_visible = legacy.is_visible,
    updated_at = NOW()
FROM public.admin_menus AS legacy
WHERE legacy.key = 'modules_management'
  AND canonical.key = 'modules'
  AND canonical.tenant_id IS NOT DISTINCT FROM legacy.tenant_id;

UPDATE public.admin_menus
SET key = 'modules',
    label = 'Modules',
    path = 'modules',
    icon = 'Box',
    permission = 'platform.module.read',
    group_label = 'SYSTEM',
    group_order = 60,
    "order" = 35,
    updated_at = NOW()
WHERE key = 'modules_management'
  AND NOT EXISTS (
    SELECT 1
    FROM public.admin_menus AS existing
    WHERE existing.key = 'modules'
      AND existing.tenant_id IS NOT DISTINCT FROM public.admin_menus.tenant_id
  );

DELETE FROM public.admin_menus AS legacy
WHERE legacy.key = 'modules_management'
  AND EXISTS (
    SELECT 1
    FROM public.admin_menus AS canonical
    WHERE canonical.key = 'modules'
      AND canonical.tenant_id IS NOT DISTINCT FROM legacy.tenant_id
  );

UPDATE public.admin_menus
SET label = 'Modules',
    path = 'modules',
    icon = 'Box',
    permission = 'platform.module.read',
    group_label = 'SYSTEM',
    group_order = 60,
    "order" = 35,
    updated_at = NOW()
WHERE key = 'modules'
   OR path = 'modules';

UPDATE public.admin_menus
SET label = 'Sidebar Manager',
    path = 'admin-navigation',
    icon = 'List',
    permission = 'platform.sidebar.read',
    group_label = 'SYSTEM',
    group_order = 60,
    "order" = 40,
    updated_at = NOW()
WHERE key = 'sidebar_manager'
   OR path = 'admin-navigation';
