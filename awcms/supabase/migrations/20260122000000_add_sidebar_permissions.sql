-- Create permissions if they don't exist
INSERT INTO permissions (name, description, module, resource, action, created_at, updated_at)
SELECT 'platform.sidebar.read', 'Can view sidebar manager', 'platform', 'sidebar', 'read', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'platform.sidebar.read');

INSERT INTO permissions (name, description, module, resource, action, created_at, updated_at)
SELECT 'platform.sidebar.update', 'Can update sidebar configuration', 'platform', 'sidebar', 'update', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'platform.sidebar.update');

-- Assign permissions to roles
DO $$
DECLARE
  v_perm_read_id UUID;
  v_perm_update_id UUID;
  v_role_super_admin_id UUID;
  v_role_owner_id UUID;
  v_role_admin_id UUID;
BEGIN
  -- Get Permission IDs
  SELECT id INTO v_perm_read_id FROM permissions WHERE name = 'platform.sidebar.read';
  SELECT id INTO v_perm_update_id FROM permissions WHERE name = 'platform.sidebar.update';

  -- Get Role IDs
  SELECT id INTO v_role_super_admin_id FROM roles WHERE name = 'super_admin';
  SELECT id INTO v_role_owner_id FROM roles WHERE name = 'owner';
  SELECT id INTO v_role_admin_id FROM roles WHERE name = 'admin';

  -- Assign READ to Super Admin
  IF v_role_super_admin_id IS NOT NULL AND v_perm_read_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_super_admin_id, v_perm_read_id
    WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = v_role_super_admin_id AND permission_id = v_perm_read_id);
  END IF;

  -- Assign UPDATE to Super Admin
  IF v_role_super_admin_id IS NOT NULL AND v_perm_update_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_super_admin_id, v_perm_update_id
    WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = v_role_super_admin_id AND permission_id = v_perm_update_id);
  END IF;

  -- Assign READ to Owner
  IF v_role_owner_id IS NOT NULL AND v_perm_read_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_owner_id, v_perm_read_id
    WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = v_role_owner_id AND permission_id = v_perm_read_id);
  END IF;

  -- Assign UPDATE to Owner
  IF v_role_owner_id IS NOT NULL AND v_perm_update_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_owner_id, v_perm_update_id
    WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = v_role_owner_id AND permission_id = v_perm_update_id);
  END IF;

   -- Assign READ to Admin
  IF v_role_admin_id IS NOT NULL AND v_perm_read_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_admin_id, v_perm_read_id
    WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = v_role_admin_id AND permission_id = v_perm_read_id);
  END IF;

  -- Assign UPDATE to Admin
  IF v_role_admin_id IS NOT NULL AND v_perm_update_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_admin_id, v_perm_update_id
    WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = v_role_admin_id AND permission_id = v_perm_update_id);
  END IF;

END $$;
