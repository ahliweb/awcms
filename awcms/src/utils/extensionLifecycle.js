
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Synchronizes an extension's configuration (routes, menus, permissions) 
 * with the central registry tables and the core RBAC system.
 */
export const syncExtensionToRegistry = async (extensionId, config) => {
  if (!config) return;

  try {
    console.log(`Syncing extension ${extensionId}...`);

    // 1. Sync Routes
    if (config.routes && Array.isArray(config.routes)) {
      const deletedAt = new Date().toISOString();
      await supabase
        .from('extension_routes_registry')
        .update({ deleted_at: deletedAt, is_active: false, updated_at: deletedAt })
        .eq('extension_id', extensionId)
        .is('deleted_at', null);
      
      const routesToInsert = config.routes.map(route => ({
        extension_id: extensionId,
        path: route.path,
        component_key: route.component,
        name: route.name,
        icon: route.icon,
        requires_auth: route.requires_auth !== false, // Default true
        required_permissions: route.permissions || [],
        is_active: true,
        deleted_at: null
      }));

      if (routesToInsert.length > 0) {
        const { error } = await supabase.from('extension_routes_registry').insert(routesToInsert);
        if (error) console.error("Error syncing routes:", error);
      }
    }

    // 2. Sync Menus
    if (config.menus && Array.isArray(config.menus)) {
      const deletedAt = new Date().toISOString();
      await supabase
        .from('extension_menu_items')
        .update({ deleted_at: deletedAt, is_active: false, updated_at: deletedAt })
        .eq('extension_id', extensionId)
        .is('deleted_at', null);

      const menusToInsert = config.menus.map((menu, index) => ({
        extension_id: extensionId,
        label: menu.label,
        path: menu.path,
        icon: menu.icon,
        order: menu.order || 99 + index,
        is_active: true,
        deleted_at: null
      }));

      if (menusToInsert.length > 0) {
        const { error } = await supabase.from('extension_menu_items').insert(menusToInsert);
        if (error) console.error("Error syncing menus:", error);
      }
    }

    // 3. Sync Permissions - CRITICAL FOR RBAC
    if (config.permissions && Array.isArray(config.permissions)) {
        // A) Insert into Extension Permissions (Metadata)
        const permsToInsert = config.permissions.map(p => ({
            extension_id: extensionId,
            permission_name: p,
            description: `Permission for extension ${extensionId}`
        }));
        
        const { error: extPermError } = await supabase.from('extension_permissions')
            .upsert(permsToInsert, { onConflict: 'extension_id, permission_name'});
            
        if (extPermError) console.error("Error syncing extension_permissions:", extPermError);

        // B) Insert into Core Permissions Table (System-wide recognition)
        // We use a loop or bulk insert with ignore duplicates to ensure they exist
        // The unique constraint on 'name' in 'permissions' table will handle duplicates
        for (const permName of config.permissions) {
             const { error: corePermError } = await supabase.from('permissions').upsert(
                 { 
                     name: permName, 
                     resource: 'extension', 
                     action: 'dynamic', 
                     description: `Registered by extension ${extensionId}`,
                     deleted_at: null
                 },
                 { onConflict: 'name' }
             );
             if (corePermError && corePermError.code !== '23505') { // Ignore unique violations if they occur differently
                 console.error(`Error registering permission ${permName} to core:`, corePermError);
             }
        }
    }

    return true;
  } catch (error) {
    console.error("Extension Sync Error:", error);
    throw error;
  }
};

/**
 * Deactivates extension components in registry without deleting them.
 */
export const deactivateExtensionRegistry = async (extensionId) => {
    await supabase
      .from('extension_routes_registry')
      .update({ is_active: false })
      .eq('extension_id', extensionId)
      .is('deleted_at', null);
    await supabase
      .from('extension_menu_items')
      .update({ is_active: false })
      .eq('extension_id', extensionId)
      .is('deleted_at', null);
};

/**
 * Reactivates extension components.
 */
export const activateExtensionRegistry = async (extensionId) => {
    await supabase
      .from('extension_routes_registry')
      .update({ is_active: true })
      .eq('extension_id', extensionId)
      .is('deleted_at', null);
    await supabase
      .from('extension_menu_items')
      .update({ is_active: true })
      .eq('extension_id', extensionId)
      .is('deleted_at', null);
};
