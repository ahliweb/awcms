SET client_min_messages TO warning;

UPDATE public.roles
SET description = 'Platform owner with full access across all tenants and system resources',
    scope = 'platform',
    tenant_id = NULL,
    is_system = true,
    is_platform_admin = true,
    is_full_access = true,
    is_tenant_admin = true,
    deleted_at = NULL,
    updated_at = now()
WHERE name = 'owner'
  AND tenant_id IS NULL;

INSERT INTO public.roles (
  name,
  description,
  scope,
  tenant_id,
  is_system,
  is_platform_admin,
  is_full_access,
  is_tenant_admin,
  updated_at,
  deleted_at
)
SELECT
  'owner',
  'Platform owner with full access across all tenants and system resources',
  'platform',
  NULL,
  true,
  true,
  true,
  true,
  now(),
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles WHERE name = 'owner' AND tenant_id IS NULL AND deleted_at IS NULL
);

WITH owner_role AS (
  SELECT id FROM public.roles WHERE name = 'owner' AND tenant_id IS NULL AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1
)
UPDATE public.users
SET role_id = (SELECT id FROM owner_role),
    tenant_id = NULL,
    updated_at = now(),
    deleted_at = NULL
WHERE email = 'cms@ahliweb.com';
