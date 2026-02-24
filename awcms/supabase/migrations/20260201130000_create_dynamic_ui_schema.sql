-- Migration: Create Dynamic UI/UX Schema
-- Description: Establishes the foundation for database-driven frontend (Registry, UI Schemas, Editors).

--------------------------------------------------------------------------------
-- 1. resources_registry
-- Registry of all available system modules/resources.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resources_registry (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE, -- e.g. 'blogs', 'school_pages'
  label text NOT NULL, -- e.g. 'Blogs', 'School Website'
  scope text NOT NULL CHECK (scope IN ('platform', 'tenant', 'content', 'module')),
  type text NOT NULL DEFAULT 'entity', -- 'entity' (table), 'settings', 'media', 'system'
  db_table text, -- The underlying physical table (e.g., 'posts')
  icon text, -- Lucide icon name
  permission_prefix text, -- ABAC prefix (e.g., 'tenant.blog')
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: Platform admins manage, Tenants read active
ALTER TABLE public.resources_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage resources" ON public.resources_registry
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Everyone read active resources" ON public.resources_registry
  FOR SELECT USING (active = true);


--------------------------------------------------------------------------------
-- 2. ui_configs
-- Stores JSON configuration for how to render Lists (tables) and Forms.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ui_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_key text REFERENCES public.resources_registry(key) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE, -- Optional: Tenant-specific override
  type text NOT NULL CHECK (type IN ('form', 'table', 'view', 'dashboard')),
  name text NOT NULL, -- e.g. 'default_list', 'edit_form'
  schema jsonb NOT NULL DEFAULT '{}'::jsonb, -- The layout/field config
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(resource_key, type, tenant_id, name)
);

-- RLS
ALTER TABLE public.ui_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage configs" ON public.ui_configs
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Tenants read configs" ON public.ui_configs
  FOR SELECT
  USING (
    tenant_id IS NULL OR 
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );


--------------------------------------------------------------------------------
-- 3. component_registry
-- Stores config for TipTap (prose) and Puck (visual) editors.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.component_registry (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_key text REFERENCES public.resources_registry(key) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  editor_type text NOT NULL CHECK (editor_type IN ('tiptap', 'puck', 'monaco')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb, -- Toolbars, plugins, allowed components
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.component_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage components" ON public.component_registry
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Tenants read components" ON public.component_registry
  FOR SELECT
  USING (
    tenant_id IS NULL OR 
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );


--------------------------------------------------------------------------------
-- 4. Initial Seed of Resources Registry
--------------------------------------------------------------------------------
INSERT INTO public.resources_registry (key, label, scope, type, db_table, icon, permission_prefix) VALUES
('blogs', 'Blogs', 'tenant', 'entity', 'posts', 'FileText', 'tenant.blog'),
('pages', 'Pages', 'tenant', 'entity', 'pages', 'FileEdit', 'tenant.page'),
('visual_builder', 'Visual Builder', 'tenant', 'settings', 'visual_pages', 'Layout', 'tenant.visual_pages'),
('themes', 'Themes', 'tenant', 'settings', 'themes', 'Palette', 'tenant.theme'),
('widgets', 'Widgets', 'tenant', 'settings', 'widgets', 'Layers', 'tenant.widgets'),
('portfolio', 'Portfolio', 'tenant', 'entity', 'portfolio', 'Briefcase', 'tenant.portfolio'),
('testimonials', 'Testimonials', 'tenant', 'entity', 'testimonials', 'MessageSquareQuote', 'tenant.testimonies'),
('announcements', 'Announcements', 'tenant', 'entity', 'announcements', 'Megaphone', 'tenant.announcements'),
('promotions', 'Promotions', 'tenant', 'entity', 'promotions', 'Tag', 'tenant.promotions'),
('school_pages', 'School Website', 'tenant', 'settings', 'settings', 'School', 'tenant.school_pages'),
('site_images', 'Site Images', 'tenant', 'settings', 'settings', 'Image', 'tenant.school_pages'),
('contact_messages', 'Contact Messages', 'tenant', 'entity', 'contact_messages', 'Inbox', 'tenant.contact_messages'),
('contacts', 'Contacts CRM', 'tenant', 'entity', 'contacts', 'Contact', 'tenant.contacts'),
('files', 'Media Library', 'tenant', 'media', 'storage', 'FolderOpen', 'tenant.files'),
('photo_gallery', 'Photo Gallery', 'tenant', 'media', 'galleries', 'Image', 'tenant.photo_gallery'),
('video_gallery', 'Video Gallery', 'tenant', 'media', 'galleries', 'Video', 'tenant.video_gallery'),
('products', 'Products', 'tenant', 'entity', 'products', 'Package', 'tenant.products'),
('product_types', 'Product Types', 'tenant', 'entity', 'product_types', 'Box', 'tenant.product_types'),
('orders', 'Orders', 'tenant', 'entity', 'orders', 'ShoppingCart', 'tenant.orders'),
('menus', 'Menu Manager', 'tenant', 'system', 'menus', 'Menu', 'tenant.menu'),
('categories', 'Categories', 'tenant', 'system', 'categories', 'FolderTree', 'tenant.categories'),
('tags', 'Tags', 'tenant', 'system', 'tags', 'Hash', 'tenant.tag'),
('users', 'Users', 'tenant', 'system', 'profiles', 'Users', 'tenant.user'),
('roles', 'Roles & Permissions', 'tenant', 'system', 'roles', 'Shield', 'tenant.role'),
('policies', 'Policies', 'tenant', 'entity', 'policies', 'ShieldCheck', 'tenant.policy'),
('seo_manager', 'SEO Manager', 'tenant', 'settings', 'seo_settings', 'Search', 'tenant.seo'),
('languages', 'Languages', 'tenant', 'settings', 'languages', 'Languages', 'tenant.languages'),
('extensions', 'Extensions', 'platform', 'system', 'extensions', 'Puzzle', 'platform.extensions'),
('modules', 'Modules', 'platform', 'system', 'modules', 'Box', 'platform.module'),
('sidebar_manager', 'Sidebar Manager', 'platform', 'system', 'admin_menus', 'List', 'platform.sidebar'),
('notifications', 'Notifications', 'tenant', 'entity', 'notifications', 'MessageSquareQuote', 'tenant.notification'),
('audit_logs', 'Audit Logs', 'tenant', 'entity', 'audit_logs', 'FileClock', 'tenant.audit'),
('settings_general', 'General Settings', 'tenant', 'settings', 'settings', 'Settings', 'tenant.setting'),
('settings_branding', 'Branding', 'tenant', 'settings', 'settings', 'Palette', 'tenant.setting'),
('sso', 'SSO & Security', 'tenant', 'settings', 'sso_config', 'Lock', 'tenant.sso'),
('email_settings', 'Email Settings', 'tenant', 'settings', 'settings', 'Mail', 'tenant.setting'),
('email_logs', 'Email Logs', 'tenant', 'entity', 'email_logs', 'MailOpen', 'tenant.setting'),
('iot_devices', 'IoT Devices', 'tenant', 'entity', 'iot_devices', 'Cpu', 'tenant.iot'),
('mobile_users', 'Mobile Users', 'tenant', 'entity', 'mobile_users', 'Smartphone', 'tenant.mobile_users'),
('push_notifications', 'Push Notifications', 'tenant', 'entity', 'push_notifications', 'Bell', 'tenant.push_notifications'),
('mobile_config', 'App Config', 'tenant', 'settings', 'settings', 'Settings', 'tenant.mobile'),
('tenants', 'Tenant Management', 'platform', 'system', 'tenants', 'Building', 'platform.tenant')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  scope = EXCLUDED.scope,
  type = EXCLUDED.type,
  db_table = EXCLUDED.db_table,
  icon = EXCLUDED.icon,
  permission_prefix = EXCLUDED.permission_prefix;
