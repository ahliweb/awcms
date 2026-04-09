-- Seed canonical tenant.services.* permissions for service catalog management.

WITH permission_seed(name, resource, action, description) AS (
  VALUES
    ('tenant.services.read', 'services', 'read', 'Read services'),
    ('tenant.services.create', 'services', 'create', 'Create services'),
    ('tenant.services.update', 'services', 'update', 'Update services'),
    ('tenant.services.delete', 'services', 'delete', 'Delete services')
), inserted_permissions AS (
  INSERT INTO public.permissions (name, resource, action, description, deleted_at)
  SELECT name, resource, action, description, NULL
  FROM permission_seed
  ON CONFLICT (name) DO UPDATE SET
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    deleted_at = NULL
  RETURNING id, name
), effective_permissions AS (
  SELECT id, name FROM inserted_permissions
  UNION
  SELECT p.id, p.name
  FROM public.permissions p
  JOIN permission_seed ps ON ps.name = p.name
), tenant_roles AS (
  SELECT id, tenant_id, name, is_tenant_admin
  FROM public.roles
  WHERE deleted_at IS NULL
    AND tenant_id IS NOT NULL
), role_permission_seed AS (
  SELECT tr.id AS role_id, tr.tenant_id, ep.id AS permission_id
  FROM tenant_roles tr
  JOIN effective_permissions ep ON (
    tr.is_tenant_admin = true
    OR (
      tr.name IN ('editor', 'manager', 'senior_manager', 'super_manager', 'supervisor', 'senior_supervisor')
      AND ep.name IN (
        'tenant.services.read',
        'tenant.services.create',
        'tenant.services.update',
        'tenant.services.delete'
      )
    )
    OR (
      tr.name IN ('author', 'assistant', 'associate', 'specialist', 'senior_specialist')
      AND ep.name IN (
        'tenant.services.read',
        'tenant.services.create',
        'tenant.services.update'
      )
    )
    OR (
      tr.name = 'internship'
      AND ep.name IN ('tenant.services.read')
    )
  )
)
INSERT INTO public.role_permissions (role_id, permission_id, tenant_id, deleted_at)
SELECT role_id, permission_id, tenant_id, NULL
FROM role_permission_seed
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  deleted_at = NULL,
  tenant_id = EXCLUDED.tenant_id;
