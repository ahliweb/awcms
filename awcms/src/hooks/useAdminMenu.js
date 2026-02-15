import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { hooks } from '@/lib/hooks';
import { normalizeMenuPath, resolveGroupMeta } from '@/lib/adminMenuUtils';

// Default menu configuration - used as fallback when admin_menus table is empty
// Default menu configuration - used as fallback when admin_menus table is empty
// Default menu configuration - used as fallback when admin_menus table is empty
const DEFAULT_MENU_CONFIG = [];



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
        .select('*, extension:extensions(name, slug, manifest, is_active, deleted_at)')
        .is('deleted_at', null);

      if (extError) {
        console.warn('Error fetching extension menus:', extError);
        // Don't fail completely if extensions table issue
      }

      // 4. Merge and Normalize
      const normalizedExtMenus = (extMenus || [])
        .filter(item => item.extension?.is_active && !item.extension?.deleted_at) // Double check extension is active
        .map(item => {
          const extManifest = item.extension?.manifest;
          const extMenuGroup = extManifest?.menu?.group || extManifest?.menu?.parent;
          const groupSource = extMenuGroup || item.extension?.name || 'Extensions';
          const { label: groupLabel, order: groupOrder } = resolveGroupMeta(
            groupSource,
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
