-- Remove Stitch Import legacy surface from the maintained schema/runtime.

DELETE FROM public.settings
WHERE key = 'stitch_import';

DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.permission_id = p.id
  AND p.name LIKE 'tenant.stitch_import.%';

DELETE FROM public.permissions
WHERE name LIKE 'tenant.stitch_import.%'
   OR module = 'stitch_import'
   OR resource = 'stitch_import';

DELETE FROM public.resources_registry
WHERE key = 'stitch_import';

DROP TABLE IF EXISTS public.stitch_import_jobs CASCADE;
