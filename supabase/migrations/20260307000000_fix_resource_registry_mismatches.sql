-- Update resource_registry db_table definitions to match the actual database tables
-- Based on the audit from docs/RESOURCE_MAP.md

BEGIN;

-- 1. blogs/posts
-- Migration 20260201130000 set db_table to 'posts', but the actual table is 'blogs'
UPDATE public.resources_registry
SET db_table = 'blogs'
WHERE key = 'blogs';

-- 2. users/profiles
-- Migration 20260201130000 set db_table to 'profiles', but the actual table is 'users'
UPDATE public.resources_registry
SET db_table = 'users'
WHERE key = 'users';

-- 3. seo_manager/seo_settings
-- Migration 20260201130000 set db_table to 'seo_settings', but the actual table is 'seo_metadata'
UPDATE public.resources_registry
SET db_table = 'seo_metadata'
WHERE key = 'seo_manager';

-- 4. iot_devices
-- Migration 20260201130000 set db_table to 'iot_devices', but the actual table is 'devices'
UPDATE public.resources_registry
SET db_table = 'devices'
WHERE key = 'iot_devices';

-- 5. photo_gallery/galleries
-- Migration 20260201130000 set db_table to 'galleries', but the actual table is 'photo_gallery'
UPDATE public.resources_registry
SET db_table = 'photo_gallery'
WHERE key = 'photo_gallery';

-- 6. video_gallery/galleries
-- Migration 20260201130000 set db_table to 'galleries', but the actual table is 'video_gallery'
UPDATE public.resources_registry
SET db_table = 'video_gallery'
WHERE key = 'video_gallery';

-- 7. sso/sso_config
-- Migration 20260201130000 set db_table to 'sso_config', but the actual table is 'sso_providers'
UPDATE public.resources_registry
SET db_table = 'sso_providers'
WHERE key = 'sso';

COMMIT;
