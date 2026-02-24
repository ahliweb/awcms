-- Migration Skeleton: Register Stitch import as tenant resource

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
)
VALUES (
  'stitch_import',
  'Stitch Import',
  'tenant',
  'settings',
  'stitch_import_jobs',
  'WandSparkles',
  'tenant.stitch_import',
  false,
  now(),
  now()
)
ON CONFLICT (key) DO UPDATE
SET
  label = EXCLUDED.label,
  scope = EXCLUDED.scope,
  type = EXCLUDED.type,
  db_table = EXCLUDED.db_table,
  icon = EXCLUDED.icon,
  permission_prefix = EXCLUDED.permission_prefix,
  updated_at = now();

-- Permission skeleton for ABAC wiring.
-- Assign to roles in a dedicated RBAC seed migration after product sign-off.
INSERT INTO public.permissions (name, description, resource, action, module)
VALUES
  ('tenant.stitch_import.read', 'Read Stitch import configuration and logs', 'stitch_import', 'read', 'stitch_import'),
  ('tenant.stitch_import.create', 'Create Stitch imports', 'stitch_import', 'create', 'stitch_import'),
  ('tenant.stitch_import.update', 'Update Stitch import configuration', 'stitch_import', 'update', 'stitch_import'),
  ('tenant.stitch_import.delete', 'Delete Stitch import records', 'stitch_import', 'delete', 'stitch_import')
ON CONFLICT (name) DO NOTHING;
