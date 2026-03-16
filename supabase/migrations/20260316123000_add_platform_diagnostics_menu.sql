SET client_min_messages TO warning;

INSERT INTO public.admin_menus (
  key,
  label,
  icon,
  path,
  permission,
  "order",
  is_visible,
  is_core,
  group_label,
  group_order,
  scope,
  created_at,
  updated_at
)
SELECT
  'platform_diagnostics',
  'Platform Diagnostics',
  'CloudCog',
  'platform/diagnostics',
  'platform.tenant.read',
  25,
  true,
  true,
  'Platform',
  5,
  'platform',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_menus WHERE key = 'platform_diagnostics'
);
