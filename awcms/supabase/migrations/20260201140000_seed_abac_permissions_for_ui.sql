-- Migration: Seed ABAC Permissions for UI Access
-- Description: Adds missing ABAC permission keys and assigns to default roles.

DO $$
DECLARE
  perm record;
  action text;
  permission_name text;
  v_perm_id uuid;
  v_owner_role_id uuid;
  v_super_admin_role_id uuid;
  v_admin_role_id uuid;
BEGIN
  SELECT id INTO v_owner_role_id FROM public.roles WHERE name = 'owner' LIMIT 1;
  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO v_admin_role_id FROM public.roles WHERE name = 'admin' LIMIT 1;

  FOR perm IN
    SELECT * FROM (VALUES
      ('platform.extensions', 'extensions', 'extensions', ARRAY['read', 'create', 'update', 'delete']),
      ('platform.sidebar', 'sidebar', 'sidebar', ARRAY['read', 'update']),
      ('tenant.setting', 'setting', 'setting', ARRAY['read', 'update']),
      ('tenant.role', 'role', 'role', ARRAY['read', 'create', 'update', 'delete']),
      ('tenant.policy', 'policy', 'policy', ARRAY['read', 'create', 'update', 'delete']),
      ('tenant.mobile_users', 'mobile_users', 'mobile_users', ARRAY['read', 'create', 'update', 'delete']),
      ('tenant.push_notifications', 'push_notifications', 'push_notifications', ARRAY['read', 'create', 'update', 'delete']),
      ('tenant.iot', 'iot', 'iot', ARRAY['read', 'create', 'update', 'delete'])
    ) AS t(prefix, resource, module, actions)
  LOOP
    FOREACH action IN ARRAY perm.actions LOOP
      permission_name := perm.prefix || '.' || action;

      INSERT INTO public.permissions (name, description, resource, action, module)
      VALUES (
        permission_name,
        'ABAC permission: ' || permission_name,
        perm.resource,
        action,
        perm.module
      )
      ON CONFLICT (name) DO UPDATE SET
        resource = EXCLUDED.resource,
        action = EXCLUDED.action,
        module = EXCLUDED.module
      RETURNING id INTO v_perm_id;

      IF v_perm_id IS NOT NULL THEN
        IF permission_name LIKE 'platform.%' THEN
          IF v_owner_role_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.role_permissions WHERE role_id = v_owner_role_id AND permission_id = v_perm_id
          ) THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_owner_role_id, v_perm_id);
          END IF;

          IF v_super_admin_role_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.role_permissions WHERE role_id = v_super_admin_role_id AND permission_id = v_perm_id
          ) THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_super_admin_role_id, v_perm_id);
          END IF;
        ELSE
          IF v_owner_role_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.role_permissions WHERE role_id = v_owner_role_id AND permission_id = v_perm_id
          ) THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_owner_role_id, v_perm_id);
          END IF;

          IF v_super_admin_role_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.role_permissions WHERE role_id = v_super_admin_role_id AND permission_id = v_perm_id
          ) THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_super_admin_role_id, v_perm_id);
          END IF;

          IF v_admin_role_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.role_permissions WHERE role_id = v_admin_role_id AND permission_id = v_perm_id
          ) THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_admin_role_id, v_perm_id);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
