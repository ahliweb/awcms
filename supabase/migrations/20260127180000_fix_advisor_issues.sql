SET client_min_messages TO warning;

-- Fix Unindexed Foreign Keys
CREATE INDEX IF NOT EXISTS idx_tenant_resource_rules_resource_key ON public.tenant_resource_rules(resource_key);
CREATE INDEX IF NOT EXISTS idx_tenant_role_links_parent_role_id ON public.tenant_role_links(parent_role_id);
CREATE INDEX IF NOT EXISTS idx_tenant_role_links_child_role_id ON public.tenant_role_links(child_role_id);

-- Drop Redundant Unified Policies (Core Tables)

-- widgets
DROP POLICY IF EXISTS widgets_select_unified ON public.widgets;
DROP POLICY IF EXISTS widgets_insert_unified ON public.widgets;
DROP POLICY IF EXISTS widgets_modify_unified ON public.widgets; 
DROP POLICY IF EXISTS widgets_update_unified ON public.widgets;
DROP POLICY IF EXISTS widgets_delete_unified ON public.widgets;

-- settings
DROP POLICY IF EXISTS settings_select_unified ON public.settings;
DROP POLICY IF EXISTS settings_insert_unified ON public.settings;
DROP POLICY IF EXISTS settings_update_unified ON public.settings;
DROP POLICY IF EXISTS settings_delete_unified ON public.settings;

-- themes
DROP POLICY IF EXISTS themes_select_unified ON public.themes;
DROP POLICY IF EXISTS themes_insert_unified ON public.themes;
DROP POLICY IF EXISTS themes_update_unified ON public.themes;
DROP POLICY IF EXISTS themes_delete_unified ON public.themes;

-- menus
DROP POLICY IF EXISTS menus_select_unified ON public.menus;
DROP POLICY IF EXISTS menus_insert_unified ON public.menus;
DROP POLICY IF EXISTS menus_update_unified ON public.menus;
DROP POLICY IF EXISTS menus_delete_unified ON public.menus;

-- pages
DROP POLICY IF EXISTS pages_select_unified ON public.pages;
DROP POLICY IF EXISTS pages_insert_unified ON public.pages;
DROP POLICY IF EXISTS pages_update_unified ON public.pages;
DROP POLICY IF EXISTS pages_delete_unified ON public.pages;

-- blogs
DROP POLICY IF EXISTS blogs_select_unified ON public.blogs;
DROP POLICY IF EXISTS blogs_insert_unified ON public.blogs;
DROP POLICY IF EXISTS blogs_update_unified ON public.blogs;
DROP POLICY IF EXISTS blogs_delete_unified ON public.blogs;

-- blog_categories (Optional)
DO $$
BEGIN
  IF to_regclass('public.blog_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS blog_categories_select_unified ON public.blog_categories;
    DROP POLICY IF EXISTS blog_categories_insert_unified ON public.blog_categories;
    DROP POLICY IF EXISTS blog_categories_update_unified ON public.blog_categories;
    DROP POLICY IF EXISTS blog_categories_delete_unified ON public.blog_categories;
  END IF;
END $$;

-- blog_tags (Optional)
DO $$
BEGIN
  IF to_regclass('public.blog_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS blog_tags_select_unified ON public.blog_tags;
    DROP POLICY IF EXISTS blog_tags_insert_unified ON public.blog_tags;
    DROP POLICY IF EXISTS blog_tags_update_unified ON public.blog_tags;
    DROP POLICY IF EXISTS blog_tags_delete_unified ON public.blog_tags;
  END IF;
END $$;

-- page_categories (Optional)
DO $$
BEGIN
  IF to_regclass('public.page_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS page_categories_select_unified ON public.page_categories;
    DROP POLICY IF EXISTS page_categories_insert_unified ON public.page_categories;
    DROP POLICY IF EXISTS page_categories_update_unified ON public.page_categories;
    DROP POLICY IF EXISTS page_categories_delete_unified ON public.page_categories;
  END IF;
END $$;

-- page_tags (Optional)
DO $$
BEGIN
  IF to_regclass('public.page_tags') IS NOT NULL THEN
    DROP POLICY IF EXISTS page_tags_select_unified ON public.page_tags;
    DROP POLICY IF EXISTS page_tags_insert_unified ON public.page_tags;
    DROP POLICY IF EXISTS page_tags_update_unified ON public.page_tags;
    DROP POLICY IF EXISTS page_tags_delete_unified ON public.page_tags;
  END IF;
END $$;

-- services (Optional)
DO $$
BEGIN
  IF to_regclass('public.services') IS NOT NULL THEN
    DROP POLICY IF EXISTS services_select_unified ON public.services;
    DROP POLICY IF EXISTS services_insert_unified ON public.services;
    DROP POLICY IF EXISTS services_update_unified ON public.services;
    DROP POLICY IF EXISTS services_delete_unified ON public.services;
  END IF;
END $$;

-- testimonies (Optional)
DO $$
BEGIN
  IF to_regclass('public.testimonies') IS NOT NULL THEN
    DROP POLICY IF EXISTS testimonies_select_unified ON public.testimonies;
    DROP POLICY IF EXISTS testimonies_insert_unified ON public.testimonies;
    DROP POLICY IF EXISTS testimonies_update_unified ON public.testimonies;
    DROP POLICY IF EXISTS testimonies_delete_unified ON public.testimonies;
  END IF;
END $$;

-- files
DROP POLICY IF EXISTS files_select_unified ON public.files;
DROP POLICY IF EXISTS files_insert_unified ON public.files;
DROP POLICY IF EXISTS files_update_unified ON public.files;
DROP POLICY IF EXISTS files_delete_unified ON public.files;

-- users
DROP POLICY IF EXISTS users_select_unified ON public.users;
DROP POLICY IF EXISTS users_insert_unified ON public.users;
DROP POLICY IF EXISTS users_update_unified ON public.users;
DROP POLICY IF EXISTS users_delete_unified ON public.users;

-- templates
DROP POLICY IF EXISTS templates_select_unified ON public.templates;
DROP POLICY IF EXISTS templates_modify_unified ON public.templates;
DROP POLICY IF EXISTS templates_insert_unified ON public.templates;
DROP POLICY IF EXISTS templates_update_unified ON public.templates;
DROP POLICY IF EXISTS templates_delete_unified ON public.templates;

-- extensions
DROP POLICY IF EXISTS extensions_select ON public.extensions;
DROP POLICY IF EXISTS extensions_insert ON public.extensions;
DROP POLICY IF EXISTS extensions_update ON public.extensions;
DROP POLICY IF EXISTS extensions_delete ON public.extensions;
DROP POLICY IF EXISTS extensions_select_unified ON public.extensions;
DROP POLICY IF EXISTS extensions_insert_unified ON public.extensions;
DROP POLICY IF EXISTS extensions_update_unified ON public.extensions;
DROP POLICY IF EXISTS extensions_delete_unified ON public.extensions;

-- extension_menu_items
DROP POLICY IF EXISTS extension_menu_items_select ON public.extension_menu_items;
DROP POLICY IF EXISTS extension_menu_items_insert ON public.extension_menu_items;
DROP POLICY IF EXISTS extension_menu_items_update ON public.extension_menu_items;
DROP POLICY IF EXISTS extension_menu_items_delete ON public.extension_menu_items;

-- extension_permissions
DROP POLICY IF EXISTS extension_permissions_select ON public.extension_permissions;
DROP POLICY IF EXISTS extension_permissions_insert ON public.extension_permissions;
DROP POLICY IF EXISTS extension_permissions_update ON public.extension_permissions;
DROP POLICY IF EXISTS extension_permissions_delete ON public.extension_permissions;

-- extension_routes_registry
DROP POLICY IF EXISTS extension_routes_registry_select ON public.extension_routes_registry;
DROP POLICY IF EXISTS extension_routes_registry_insert ON public.extension_routes_registry;
DROP POLICY IF EXISTS extension_routes_registry_update ON public.extension_routes_registry;
DROP POLICY IF EXISTS extension_routes_registry_delete ON public.extension_routes_registry;

-- extension_rbac_integration
DROP POLICY IF EXISTS extension_rbac_select_scoped ON public.extension_rbac_integration;
DROP POLICY IF EXISTS extension_rbac_insert_scoped ON public.extension_rbac_integration;
DROP POLICY IF EXISTS extension_rbac_update_scoped ON public.extension_rbac_integration;
DROP POLICY IF EXISTS extension_rbac_delete_scoped ON public.extension_rbac_integration;
DROP POLICY IF EXISTS extension_rbac_select ON public.extension_rbac_integration;
DROP POLICY IF EXISTS extension_rbac_insert ON public.extension_rbac_integration;
DROP POLICY IF EXISTS extension_rbac_update ON public.extension_rbac_integration;
DROP POLICY IF EXISTS extension_rbac_delete ON public.extension_rbac_integration;
