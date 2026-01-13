/**
 * Backup Plugin Entry Point
 * 
 * WordPress-style plugin with lifecycle hooks.
 */

import BackupManager from './BackupManager';
import BackupScheduler from './BackupScheduler';
import BackupSettings from './BackupSettings';
import manifest from './plugin.json';

// Export components for registry
export const components = {
    BackupManager,
    BackupScheduler,
    BackupSettings
};

// Export manifest
export { manifest };

/**
 * Register plugin hooks and filters
 * Called when plugin is loaded
 */
export const register = ({ addAction, addFilter, supabase }) => {
    // Register admin menu item
    addFilter('admin_menu_items', 'backup_plugin', (items) => {
        return [
            ...items,
            {
                id: 'backup',
                label: manifest.menu.label,
                icon: manifest.menu.icon,
                path: manifest.menu.path,
                parent: manifest.menu.parent,
                order: 100,
                permission: 'plugin.backup.view',
                plugin_type: manifest.type
            }
        ];
    });

    // Register routes
    addFilter('admin_routes', 'backup_plugin', (routes) => {
        return [
            ...routes,
            ...manifest.routes.map(r => ({
                path: r.path,
                element: components[r.component],
                permission: 'plugin.backup.view'
            }))
        ];
    });

    // Log plugin loaded
    addAction('plugins_loaded', 'backup_init', () => {
        console.log(`[Plugin] ${manifest.name} v${manifest.version} loaded`);
    });
};

/**
 * Activate plugin
 * Called when plugin is first enabled
 */
export const activate = async (supabase, tenantId) => {
    // Register plugin permissions in database
    const permissions = manifest.permissions.map(key => ({
        permission_name: key,
        description: `Permission for ${manifest.name}`,
        tenant_id: tenantId
    }));

    // Upsert permissions (soft create if not exists)
    for (const perm of permissions) {
        await supabase.from('permissions').upsert({ ...perm, deleted_at: null }, { onConflict: 'permission_name' });
    }

    console.log(`[Plugin] ${manifest.name} activated`);
};

/**
 * Deactivate plugin
 * Called when plugin is disabled
 */
export const deactivate = async (supabase, tenantId) => {
    console.log(`[Plugin] ${manifest.name} deactivated`);
    // Cleanup logic if needed (but preserve data)
};

// Default export for backward compatibility
export default BackupManager;
