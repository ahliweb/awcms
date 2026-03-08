-- Move Tenants to PLATFORM > SYSTEM
UPDATE public.admin_menus
SET group_label = 'SYSTEM',
    scope = 'platform'
WHERE key = 'tenants';

-- Move Themes to TENANT > SYSTEM
UPDATE public.admin_menus
SET group_label = 'SYSTEM',
    scope = 'tenant'
WHERE key = 'themes';

-- Move Widgets to TENANT > SYSTEM
UPDATE public.admin_menus
SET group_label = 'SYSTEM',
    scope = 'tenant'
WHERE key = 'widgets';
