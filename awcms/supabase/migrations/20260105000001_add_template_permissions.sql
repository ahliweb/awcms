-- Migration: Add Template Management Permissions
-- Only owner and super_admin roles can manage admin templates (awadmintemplate01)

-- 1. Insert template management permissions
INSERT INTO permissions (id, name, description, resource, action, module, created_at, updated_at)
VALUES 
  (gen_random_uuid(), 'platform.template.read', 'View admin templates and configurations', 'template', 'read', 'platform', now(), now()),
  (gen_random_uuid(), 'platform.template.update', 'Edit admin template settings', 'template', 'update', 'platform', now(), now()),
  (gen_random_uuid(), 'platform.template.manage', 'Full template management including create/delete', 'template', 'manage', 'platform', now(), now())
ON CONFLICT (name) DO NOTHING;

-- 2. Assign template permissions to 'owner' role
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT 
  gen_random_uuid(),
  r.id,
  p.id,
  now()
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'owner'
  AND p.name LIKE 'platform.template.%'
ON CONFLICT DO NOTHING;

-- 3. Assign template permissions to 'super_admin' role
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT 
  gen_random_uuid(),
  r.id,
  p.id,
  now()
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin'
  AND p.name LIKE 'platform.template.%'
ON CONFLICT DO NOTHING;
