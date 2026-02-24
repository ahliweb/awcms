-- Migration: Rename Dynamic UI Tables
-- Description: Renames dynamic UI tables, enforces ABAC scopes, and backfills permission prefixes.

-- 1. Rename tables (safe for existing installs)
ALTER TABLE IF EXISTS public.system_resources RENAME TO resources_registry;
ALTER TABLE IF EXISTS public.ui_schemas RENAME TO ui_configs;
ALTER TABLE IF EXISTS public.editor_configurations RENAME TO component_registry;

-- 2. Normalize scope values before enforcing constraint
UPDATE public.resources_registry
SET scope = CASE
  WHEN key IN ('extensions', 'modules', 'sidebar_manager', 'tenants') THEN 'platform'
  ELSE 'tenant'
END
WHERE scope = 'system';

-- 3. Add permission prefix for ABAC mapping
ALTER TABLE public.resources_registry
  ADD COLUMN IF NOT EXISTS permission_prefix text;

-- 4. Tighten scope constraint to ABAC scopes only
ALTER TABLE public.resources_registry
  DROP CONSTRAINT IF EXISTS system_resources_scope_check;
ALTER TABLE public.resources_registry
  DROP CONSTRAINT IF EXISTS resources_registry_scope_check;

ALTER TABLE public.resources_registry
  ADD CONSTRAINT resources_registry_scope_check CHECK (scope IN ('platform', 'tenant', 'content', 'module'));

-- 5. Backfill permission prefixes for existing resources
UPDATE public.resources_registry
SET permission_prefix = CASE key
  WHEN 'blogs' THEN 'tenant.blog'
  WHEN 'pages' THEN 'tenant.page'
  WHEN 'visual_builder' THEN 'tenant.visual_pages'
  WHEN 'themes' THEN 'tenant.theme'
  WHEN 'widgets' THEN 'tenant.widgets'
  WHEN 'portfolio' THEN 'tenant.portfolio'
  WHEN 'testimonials' THEN 'tenant.testimonies'
  WHEN 'announcements' THEN 'tenant.announcements'
  WHEN 'promotions' THEN 'tenant.promotions'
  WHEN 'school_pages' THEN 'tenant.school_pages'
  WHEN 'site_images' THEN 'tenant.school_pages'
  WHEN 'contact_messages' THEN 'tenant.contact_messages'
  WHEN 'contacts' THEN 'tenant.contacts'
  WHEN 'files' THEN 'tenant.files'
  WHEN 'photo_gallery' THEN 'tenant.photo_gallery'
  WHEN 'video_gallery' THEN 'tenant.video_gallery'
  WHEN 'products' THEN 'tenant.products'
  WHEN 'product_types' THEN 'tenant.product_types'
  WHEN 'orders' THEN 'tenant.orders'
  WHEN 'menus' THEN 'tenant.menu'
  WHEN 'categories' THEN 'tenant.categories'
  WHEN 'tags' THEN 'tenant.tag'
  WHEN 'users' THEN 'tenant.user'
  WHEN 'roles' THEN 'tenant.role'
  WHEN 'policies' THEN 'tenant.policy'
  WHEN 'seo_manager' THEN 'tenant.seo'
  WHEN 'languages' THEN 'tenant.languages'
  WHEN 'extensions' THEN 'platform.extensions'
  WHEN 'modules' THEN 'platform.module'
  WHEN 'sidebar_manager' THEN 'platform.sidebar'
  WHEN 'notifications' THEN 'tenant.notification'
  WHEN 'audit_logs' THEN 'tenant.audit'
  WHEN 'settings_general' THEN 'tenant.setting'
  WHEN 'settings_branding' THEN 'tenant.setting'
  WHEN 'sso' THEN 'tenant.sso'
  WHEN 'email_settings' THEN 'tenant.setting'
  WHEN 'email_logs' THEN 'tenant.setting'
  WHEN 'iot_devices' THEN 'tenant.iot'
  WHEN 'mobile_users' THEN 'tenant.mobile_users'
  WHEN 'push_notifications' THEN 'tenant.push_notifications'
  WHEN 'mobile_config' THEN 'tenant.mobile'
  WHEN 'tenants' THEN 'platform.tenant'
  WHEN 'test_dynamic' THEN 'tenant.setting'
  ELSE permission_prefix
END
WHERE permission_prefix IS NULL OR permission_prefix = '';
