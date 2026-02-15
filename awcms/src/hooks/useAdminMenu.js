import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { hooks } from '@/lib/hooks';
import { normalizeMenuPath, resolveGroupMeta } from '@/lib/adminMenuUtils';

// Default menu configuration - used as fallback when admin_menus table is empty
// Default menu configuration - used as fallback when admin_menus table is empty
const DEFAULT_MENU_CONFIG = [
  // CONTENT Group
  { id: 'home', key: 'home', label: 'Dashboard', path: 'home', icon: 'LayoutDashboard', permission: null, group_label: 'CONTENT', group_order: 10, order: 10, is_visible: true },
  { id: 'blogs', key: 'blogs', label: 'Blogs', path: 'blogs', icon: 'FileText', permission: 'tenant.blog.read', group_label: 'CONTENT', group_order: 10, order: 20, is_visible: true },
  { id: 'pages', key: 'pages', label: 'Pages', path: 'pages', icon: 'FileEdit', permission: 'tenant.page.read', group_label: 'CONTENT', group_order: 10, order: 30, is_visible: true },
  { id: 'visual_builder', key: 'visual_builder', label: 'Visual Builder', path: 'visual-pages', icon: 'Layout', permission: 'tenant.visual_pages.read', group_label: 'CONTENT', group_order: 10, order: 35, is_visible: true },
  { id: 'themes', key: 'themes', label: 'Themes', path: 'themes', icon: 'Palette', permission: 'tenant.theme.read', group_label: 'CONTENT', group_order: 10, order: 40, is_visible: true },
  { id: 'widgets', key: 'widgets', label: 'Widgets', path: 'widgets', icon: 'Layers', permission: 'tenant.widgets.read', group_label: 'CONTENT', group_order: 10, order: 45, is_visible: true },
  { id: 'portfolio', key: 'portfolio', label: 'Portfolio', path: 'portfolio', icon: 'Briefcase', permission: 'tenant.portfolio.read', group_label: 'CONTENT', group_order: 10, order: 50, is_visible: true },
  { id: 'testimonials', key: 'testimonials', label: 'Testimonials', path: 'testimonies', icon: 'MessageSquareQuote', permission: 'tenant.testimonies.read', group_label: 'CONTENT', group_order: 10, order: 60, is_visible: true },
  { id: 'announcements', key: 'announcements', label: 'Announcements', path: 'announcements', icon: 'Megaphone', permission: 'tenant.announcements.read', group_label: 'CONTENT', group_order: 10, order: 70, is_visible: true },
  { id: 'promotions', key: 'promotions', label: 'Promotions', path: 'promotions', icon: 'Tag', permission: 'tenant.promotions.read', group_label: 'CONTENT', group_order: 10, order: 80, is_visible: true },
  { id: 'school_pages', key: 'school_pages', label: 'School Website', path: 'school-pages', icon: 'School', permission: ['tenant.school_pages.read', 'platform.school_pages.read'], group_label: 'CONTENT', group_order: 10, order: 85, is_visible: true },
  { id: 'site_images', key: 'site_images', label: 'Site Images', path: 'site-images', icon: 'Image', permission: ['tenant.school_pages.read', 'platform.school_pages.read'], group_label: 'CONTENT', group_order: 10, order: 86, is_visible: true },

  { id: 'contact_messages', key: 'contact_messages', label: 'Contact Messages', path: 'messages', icon: 'Inbox', permission: 'tenant.contact_messages.read', group_label: 'CONTENT', group_order: 10, order: 90, is_visible: true },
  { id: 'contacts', key: 'contacts', label: 'Contacts CRM', path: 'contacts', icon: 'Contact', permission: 'tenant.contacts.read', group_label: 'CONTENT', group_order: 10, order: 95, is_visible: true },

  // MEDIA Group
  { id: 'files', key: 'files', label: 'Media Library', path: 'files', icon: 'FolderOpen', permission: 'tenant.files.read', group_label: 'MEDIA', group_order: 20, order: 10, is_visible: true },
  { id: 'photo_gallery', key: 'photo_gallery', label: 'Photo Gallery', path: 'photo-gallery', icon: 'Image', permission: 'tenant.photo_gallery.read', group_label: 'MEDIA', group_order: 20, order: 20, is_visible: true },
  { id: 'video_gallery', key: 'video_gallery', label: 'Video Gallery', path: 'video-gallery', icon: 'Video', permission: 'tenant.video_gallery.read', group_label: 'MEDIA', group_order: 20, order: 30, is_visible: true },

  // COMMERCE Group
  { id: 'products', key: 'products', label: 'Products', path: 'products', icon: 'Package', permission: 'tenant.products.read', group_label: 'COMMERCE', group_order: 30, order: 10, is_visible: true },
  { id: 'product_types', key: 'product_types', label: 'Product Types', path: 'product-types', icon: 'Box', permission: 'tenant.product_types.read', group_label: 'COMMERCE', group_order: 30, order: 20, is_visible: true },
  { id: 'orders', key: 'orders', label: 'Orders', path: 'orders', icon: 'ShoppingCart', permission: 'tenant.orders.read', group_label: 'COMMERCE', group_order: 30, order: 30, is_visible: true },

  // NAVIGATION Group
  { id: 'menus', key: 'menus', label: 'Menu Manager', path: 'menus', icon: 'Menu', permission: 'tenant.menu.read', group_label: 'NAVIGATION', group_order: 40, order: 10, is_visible: true },
  { id: 'categories', key: 'categories', label: 'Categories', path: 'categories', icon: 'FolderTree', permission: 'tenant.categories.read', group_label: 'NAVIGATION', group_order: 40, order: 20, is_visible: true },
  { id: 'tags', key: 'tags', label: 'Tags', path: 'tags', icon: 'Hash', permission: 'tenant.tag.read', group_label: 'NAVIGATION', group_order: 40, order: 30, is_visible: true },

  // USERS Group
  { id: 'users', key: 'users', label: 'Users', path: 'users', icon: 'Users', permission: 'tenant.user.read', group_label: 'USERS', group_order: 50, order: 10, is_visible: true },
  { id: 'roles', key: 'roles', label: 'Roles & Permissions', path: 'roles', icon: 'Shield', permission: 'tenant.role.read', group_label: 'USERS', group_order: 50, order: 20, is_visible: true },
  { id: 'policies', key: 'policies', label: 'Policies', path: 'policies', icon: 'ShieldCheck', permission: 'tenant.policy.read', group_label: 'USERS', group_order: 50, order: 30, is_visible: true },

  // SYSTEM Group
  { id: 'seo_manager', key: 'seo_manager', label: 'SEO Manager', path: 'seo', icon: 'Search', permission: 'tenant.seo.read', group_label: 'SYSTEM', group_order: 60, order: 10, is_visible: true },
  { id: 'languages', key: 'languages', label: 'Languages', path: 'languages', icon: 'Languages', permission: 'tenant.languages.read', group_label: 'SYSTEM', group_order: 60, order: 20, is_visible: true },
  { id: 'extensions', key: 'extensions', label: 'Extensions', path: 'extensions', icon: 'Puzzle', permission: 'platform.extensions.read', group_label: 'SYSTEM', group_order: 60, order: 30, is_visible: true },
  { id: 'modules', key: 'modules', label: 'Modules', path: 'modules', icon: 'Box', permission: 'platform.module.read', group_label: 'SYSTEM', group_order: 60, order: 35, is_visible: true },
  { id: 'sidebar_manager', key: 'sidebar_manager', label: 'Sidebar Manager', path: 'admin-navigation', icon: 'List', permission: 'platform.sidebar.read', group_label: 'SYSTEM', group_order: 60, order: 40, is_visible: true },
  { id: 'notifications', key: 'notifications', label: 'Notifications', path: 'notifications', icon: 'MessageSquareQuote', permission: 'tenant.notification.read', group_label: 'SYSTEM', group_order: 60, order: 50, is_visible: true },
  { id: 'audit_logs', key: 'audit_logs', label: 'Audit Logs', path: 'audit-logs', icon: 'FileClock', permission: 'tenant.audit.read', group_label: 'SYSTEM', group_order: 60, order: 60, is_visible: true },
  { id: 'visitor_stats', key: 'visitor_stats', label: 'Visitor Statistics', path: 'visitor-stats', icon: 'LineChart', permission: 'tenant.analytics.read', group_label: 'SYSTEM', group_order: 60, order: 65, is_visible: true },

  // CONFIGURATION Group
  { id: 'settings_general', key: 'settings_general', label: 'General Settings', path: 'settings/general', icon: 'Settings', permission: 'tenant.setting.read', group_label: 'CONFIGURATION', group_order: 70, order: 5, is_visible: true },
  { id: 'settings_branding', key: 'branding', label: 'Branding', path: 'settings/branding', icon: 'Palette', permission: 'tenant.setting.update', group_label: 'CONFIGURATION', group_order: 70, order: 10, is_visible: true },
  { id: 'sso', key: 'sso', label: 'SSO & Security', path: 'sso', icon: 'Lock', permission: 'tenant.sso.read', group_label: 'CONFIGURATION', group_order: 70, order: 20, is_visible: true },
  { id: 'email_settings', key: 'email_settings', label: 'Email Settings', path: 'email-settings', icon: 'Mail', permission: 'tenant.setting.update', group_label: 'CONFIGURATION', group_order: 70, order: 30, is_visible: true },
  { id: 'email_logs', key: 'email_logs', label: 'Email Logs', path: 'email-logs', icon: 'MailOpen', permission: 'tenant.setting.read', group_label: 'CONFIGURATION', group_order: 70, order: 40, is_visible: true },


  // IoT Group
  { id: 'iot_devices', key: 'iot_devices', label: 'IoT Devices', path: 'devices', icon: 'Cpu', permission: 'tenant.iot.read', group_label: 'IoT', group_order: 80, order: 10, is_visible: true },

  // MOBILE Group
  { id: 'mobile_users', key: 'mobile_users', label: 'Mobile Users', path: 'mobile/users', icon: 'Smartphone', permission: 'tenant.mobile_users.read', group_label: 'MOBILE', group_order: 85, order: 10, is_visible: true },
  { id: 'push_notifications', key: 'push_notifications', label: 'Push Notifications', path: 'mobile/push', icon: 'Bell', permission: 'tenant.push_notifications.read', group_label: 'MOBILE', group_order: 85, order: 20, is_visible: true },
  { id: 'mobile_config', key: 'mobile_config', label: 'App Config', path: 'mobile/config', icon: 'Settings', permission: 'tenant.mobile.update', group_label: 'MOBILE', group_order: 85, order: 30, is_visible: true },

  // PLATFORM Group
  { id: 'tenants', key: 'tenants', label: 'Tenant Management', path: 'tenants', icon: 'Building', permission: 'platform.tenant.read', group_label: 'PLATFORM', group_order: 100, order: 10, is_visible: true },
];


export function useAdminMenu() {
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMenu = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Core Admin Menus
      const { data: coreMenus, error: coreError } = await supabase
        .from('admin_menus')
        .select('*')
        .order('group_order', { ascending: true })
        .order('order', { ascending: true });

      if (coreError) throw coreError;

      // 2. Fetch System Resources (New Source of Truth)
      const { data: resources, error: resError } = await supabase
        .from('resources_registry')
        .select('*')
        .eq('active', true);

      if (resError) console.warn('Error fetching system resources:', resError);

      // 3. Fetch Extension Menus (if any)
      // We join with extensions to get the group label (extension name)
      const { data: extMenus, error: extError } = await supabase
        .from('extension_menu_items')
        .select('*, extension:extensions(name, slug, is_active, deleted_at)')
        .is('deleted_at', null);

      if (extError) {
        console.warn('Error fetching extension menus:', extError);
        // Don't fail completely if extensions table issue
      }

      // 4. Merge and Normalize
      const normalizedExtMenus = (extMenus || [])
        .filter(item => item.extension?.is_active && !item.extension?.deleted_at) // Double check extension is active
        .map(item => {
          const { label: groupLabel, order: groupOrder } = resolveGroupMeta(
            item.extension?.name || 'Extensions',
            900
          );
          const extensionKey = item.extension?.slug || `ext-${item.id}`;
          return {
            id: `ext-${item.id}`, // specific ID format
            original_id: item.id,
            label: item.label,
            key: extensionKey,
            feature_key: 'extensions',
            icon: item.icon,
            path: normalizeMenuPath(item.path),
            group_label: groupLabel,
            group_order: groupOrder,
            order: item.order,
            is_visible: item.is_active,
            permission: null, // Extensions handle their own route perms usually, or we can add map
            source: 'extension'
          };
        });

      // Combine
      // If coreMenus is empty, use default config. Extensions still merge.
      let baseMenus = (coreMenus && coreMenus.length > 0) ? coreMenus : DEFAULT_MENU_CONFIG;

      // ENRICH baseMenus with Resource details
      if (resources && resources.length > 0) {
        const resourceMap = new Map(resources.map(r => [r.key, r]));
        baseMenus = baseMenus.map(menu => {
          // Find matching resource by direct ID link or Key match
          const matchedRes = resources.find(r => r.id === menu.resource_id) || resourceMap.get(menu.key);
          if (matchedRes) {
            const resolvedPermission = menu.permission || (matchedRes.permission_prefix ? `${matchedRes.permission_prefix}.read` : null);
            const { label: groupLabel, order: groupOrder } = resolveGroupMeta(
              menu.group_label,
              menu.group_order
            );
            return {
              ...menu,
              // If menu label/icon is null (strict DB mode), fallback to Resource
              label: menu.label || matchedRes.label,
              icon: menu.icon || matchedRes.icon,
              resource_id: matchedRes.id,
              resource_type: matchedRes.type, // passed for UI to know if it's a Table or Form
              permission: resolvedPermission,
              permission_prefix: matchedRes.permission_prefix,
              group_label: groupLabel,
              group_order: groupOrder
            };
          }
          const { label: groupLabel, order: groupOrder } = resolveGroupMeta(
            menu.group_label,
            menu.group_order
          );
          return {
            ...menu,
            group_label: groupLabel,
            group_order: groupOrder
          };
        });
      }

      let combined = [...baseMenus, ...normalizedExtMenus];

      // Sort again by group_order then order to ensure merged list is correct
      combined.sort((a, b) => {
        if ((a.group_order || 0) !== (b.group_order || 0)) {
          return (a.group_order || 0) - (b.group_order || 0);
        }
        return (a.order || 0) - (b.order || 0);
      });

      // 5. Merge Plugin-registered menu items (via filters)
      try {
        const pluginMenuItems = hooks.applyFilters('admin_menu_items', []);
        const existingMenuKeys = new Set(
          combined.map(item => item.key || item.id).filter(Boolean)
        );
        const existingMenuPaths = new Set(
          combined.map(item => normalizeMenuPath(item.path)).filter(Boolean)
        );
        const normalizedPluginMenus = (pluginMenuItems || [])
          .map(item => {
            const normalizedKey = item.key || item.id;
            const { label: groupLabel, order: groupOrder } = resolveGroupMeta(
              item.group || item.parent || 'PLUGINS',
              item.groupOrder
            );
            return {
              id: `plugin-${normalizedKey}`,
              original_id: item.id,
              label: item.label,
              key: normalizedKey,
              feature_key: item.feature_key || normalizedKey,
              icon: item.icon || 'Puzzle',
              path: normalizeMenuPath(item.path),
              group_label: groupLabel,
              group_order: groupOrder,
              order: item.order || 10,
              is_visible: true,
              permission: item.permission || null,
              source: 'plugin',
              plugin_type: item.plugin_type || 'extension' // Default to extension if not specified
            };
          })
          .filter(item => {
            const key = item.key || item.id;
            const pathKey = item.path;
            if (key && existingMenuKeys.has(key)) return false;
            if (pathKey && existingMenuPaths.has(pathKey)) return false;
            if (key) existingMenuKeys.add(key);
            if (pathKey) existingMenuPaths.add(pathKey);
            return true;
          });
        combined = [...combined, ...normalizedPluginMenus];
      } catch (pluginErr) {
        console.warn('Error loading plugin menu items:', pluginErr);
      }

      // Re-sort after adding plugin items
      combined.sort((a, b) => {
        if ((a.group_order || 0) !== (b.group_order || 0)) {
          return (a.group_order || 0) - (b.group_order || 0);
        }
        return (a.order || 0) - (b.order || 0);
      });

      setMenuItems(combined);
    } catch (err) {
      console.error('Error fetching admin menu:', err);
      setError(err);
      // Even on error, fallback to default config so UI isn't broken
      setMenuItems(DEFAULT_MENU_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  const updateMenuOrder = async (newOrderItems) => {
    try {
      const coreUpdates = [];
      const extUpdates = [];
      const newInserts = []; // For items from DEFAULT_MENU_CONFIG that don't exist in DB

      newOrderItems.forEach((item, index) => {
        const newOrder = (index + 1) * 10;

        if (item.source === 'extension') {
          extUpdates.push({
            id: item.original_id,
            order: newOrder,
            updated_at: new Date().toISOString()
          });
        } else {
          // Check if this is a fallback item (string ID) vs database item (UUID)
          const isUUID = typeof item.id === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id);

          if (isUUID) {
            // Existing database row - just update order
            coreUpdates.push({
              id: item.id,
              order: newOrder,
              updated_at: new Date().toISOString()
            });
          } else {
            // Fallback item - needs full insert 
            newInserts.push({
              key: item.key || item.id,
              label: item.label,
              path: item.path || '',
              icon: item.icon || 'FolderOpen',
              permission: item.permission,
              group_label: item.group_label || 'General',
              group_order: item.group_order || 100,
              order: newOrder,
              is_visible: item.is_visible !== false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          }
        }
      });

      // Insert new items from fallback config
      if (newInserts.length > 0) {
        // Try to insert - if key constraint exists, use upsert; otherwise insert
        try {
          const { error: insertError } = await supabase
            .from('admin_menus')
            .insert(newInserts)
            .select();

          if (insertError) {
            // If insert failed due to constraint, try one by one
            console.warn('Batch insert failed, trying individually:', insertError);
            for (const item of newInserts) {
              await supabase.from('admin_menus').insert(item);
            }
          }
        } catch (e) {
          console.error('Error inserting new items:', e);
        }

        // After inserting, we need to refresh to get proper UUIDs
        await fetchMenu();
        return true;
      }

      // Update Core Menus - use individual updates instead of upsert to avoid NOT NULL constraint issues
      if (coreUpdates.length > 0) {
        const updatePromises = coreUpdates.map(update =>
          supabase
            .from('admin_menus')
            .update({ order: update.order, updated_at: update.updated_at })
            .eq('id', update.id)
        );

        const results = await Promise.all(updatePromises);
        const errors = results.filter(r => r.error);
        if (errors.length > 0) {
          console.error('Some updates failed:', errors);
          throw errors[0].error;
        }
      }

      // Update Extension Menus - same approach
      if (extUpdates.length > 0) {
        const updatePromises = extUpdates.map(update =>
          supabase
            .from('extension_menu_items')
            .update({ order: update.order, updated_at: update.updated_at })
            .eq('id', update.id)
        );

        const results = await Promise.all(updatePromises);
        const errors = results.filter(r => r.error);
        if (errors.length > 0) {
          console.error('Some extension updates failed:', errors);
          throw errors[0].error;
        }
      }


      setMenuItems(prev => {
        const itemsMap = new Map(prev.map(i => [i.id, i]));
        return newOrderItems.map(item => ({ ...itemsMap.get(item.id), ...item }));
      });

      return true;
    } catch (err) {
      console.error('Error updating menu order:', err);
      throw err;
    }
  };


  const toggleVisibility = async (id, currentVisibility) => {
    try {
      // Check if it's an extension item
      const isExtension = id.toString().startsWith('ext-');

      // Check if this is a fallback item (not a UUID)
      const isUUID = typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

      if (isExtension) {
        const realId = id.replace('ext-', '');
        const { error } = await supabase
          .from('extension_menu_items')
          .update({ is_active: !currentVisibility })
          .eq('id', realId);
        if (error) throw error;
      } else if (isUUID) {
        const { error } = await supabase
          .from('admin_menus')
          .update({ is_visible: !currentVisibility })
          .eq('id', id);
        if (error) throw error;
      } else {
        // Fallback item - find it and insert first, then update
        const item = menuItems.find(i => i.id === id);
        if (item) {
          const { error } = await supabase
            .from('admin_menus')
            .upsert({
              key: item.key || item.id,
              label: item.label,
              path: item.path || '',
              icon: item.icon || 'FolderOpen',
              permission: item.permission,
              group_label: item.group_label || 'General',
              group_order: item.group_order || 100,
              order: item.order || 0,
              is_visible: !currentVisibility,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, { onConflict: 'key' })
            .select()
            .single();

          if (error) throw error;

          // Refresh to get proper UUIDs
          await fetchMenu();
          return true;
        }
      }

      setMenuItems(prev => prev.map(item =>
        item.id === id ? { ...item, is_visible: !currentVisibility } : item
      ));
      return true;
    } catch (err) {
      console.error('Error toggling visibility:', err);
      throw err;
    }
  };

  const updateMenuItem = async (id, updates) => {
    try {
      // Check if this is a fallback item
      const isUUID = typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

      if (isUUID) {
        const { error } = await supabase
          .from('admin_menus')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
      } else {
        // Fallback item - find it and insert with updates
        const item = menuItems.find(i => i.id === id);
        if (item) {
          const { error } = await supabase
            .from('admin_menus')
            .upsert({
              key: item.key || item.id,
              label: updates.label || item.label,
              path: item.path || '',
              icon: item.icon || 'FolderOpen',
              permission: item.permission,
              group_label: updates.group_label || item.group_label || 'General',
              group_order: updates.group_order || item.group_order || 100,
              order: item.order || 0,
              is_visible: item.is_visible !== false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

          if (error) throw error;

          await fetchMenu();
          return true;
        }
      }

      setMenuItems(prev => prev.map(item =>
        item.id === id ? { ...item, ...updates } : item
      ));
      return true;
    } catch (err) {
      console.error('Error updating item:', err);
      throw err;
    }
  };

  const updateGroup = async (oldLabel, { newLabel, newOrder }) => {
    try {
      const updates = {};
      if (newLabel !== undefined && newLabel !== oldLabel) {
        updates.group_label = newLabel;
      }
      if (newOrder !== undefined) {
        updates.group_order = newOrder;
      }

      if (Object.keys(updates).length === 0) return;

      const { error } = await supabase
        .from('admin_menus')
        .update(updates)
        .eq('group_label', oldLabel);

      if (error) throw error;

      setMenuItems(prev => prev.map(item => {
        if (item.group_label === oldLabel) {
          return { ...item, ...updates };
        }
        return item;
      }));
      return true;
    } catch (err) {
      console.error('Error updating group:', err);
      throw err;
    }
  };

  return {
    menuItems,
    loading,
    error,
    fetchMenu,
    updateMenuOrder,
    toggleVisibility,
    updateMenuItem,
    updateGroup
  };
}
