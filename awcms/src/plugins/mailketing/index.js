/**
 * Mailketing Core Plugin
 * Email sending and subscriber management via Mailketing API
 */

import React from 'react';
import MailketingCreditsWidget from './components/MailketingCreditsWidget';
import manifest from './plugin.json';

export const components = {
    MailketingCreditsWidget,
};

export { manifest };

/**
 * Register plugin hooks and filters
 * Called once when the plugin system initializes
 */
export const register = ({ addAction, addFilter, supabase, pluginConfig }) => {
    // Import components dynamically for routing
    const EmailSettings = React.lazy(() => import('./components/EmailSettings'));
    const EmailLogs = React.lazy(() => import('./components/EmailLogs'));

    // Register admin routes for email settings
    addFilter('admin_routes', 'mailketing_routes', (routes) => [
        ...routes,
        {
            path: 'email-settings',
            element: EmailSettings,
            permission: 'tenant.setting.update',
        },
        {
            path: 'email-logs',
            element: EmailLogs,
            permission: 'tenant.setting.read',
        },
    ]);

    // Register sidebar menu items
    addFilter('admin_menu_items', 'mailketing_menu', (items) => [
        ...items,
        {
            id: 'mailketing-settings',
            label: 'Mailketing',
            path: 'email-settings',
            icon: 'Mail',
            group: 'CONFIGURATION',
            order: 75,
            permission: 'tenant.setting.update',
            plugin_type: manifest.type,
        },
    ]);

    // Register email content filter for template injection
    addFilter('email_content', 'mailketing', (content, context) => {
        // Add tracking pixel if enabled
        if (pluginConfig?.tracking_enabled) {
            const trackingPixel = `<img src="${pluginConfig.tracking_url}" width="1" height="1" />`;
            return content + trackingPixel;
        }
        return content;
    });

    // Register dashboard widget for email stats
    addFilter('dashboard_widgets', 'mailketing_stats', (widgets) => {
        return [
            ...widgets,
            {
                id: 'mailketing_credits',
                component: 'mailketing:MailketingCreditsWidget',
                position: 'sidebar',
                priority: 50,
                frame: false,
            },
        ];
    });

    console.log('[Mailketing Plugin] Registered');
};

/**
 * Activate plugin for a specific tenant
 * Called when the plugin is enabled for a tenant
 */
export const activate = async (supabase, tenantId) => {
    console.log(`[Mailketing Plugin] Activated for tenant: ${tenantId}`);

    // Initialize default settings if not exists
    const { data: existingSettings } = await supabase
        .from('settings')
        .select('key')
        .eq('tenant_id', tenantId)
        .eq('key', 'email.provider')
        .is('deleted_at', null)
        .single();

    if (!existingSettings) {
        await supabase.from('settings').upsert([
            { tenant_id: tenantId, key: 'email.provider', value: '"mailketing"', deleted_at: null },
            { tenant_id: tenantId, key: 'email.enabled', value: 'true', deleted_at: null },
        ], { onConflict: 'tenant_id,key' });
    }

    return { success: true };
};

/**
 * Deactivate plugin for a specific tenant
 * Called when the plugin is disabled for a tenant
 */
export const deactivate = async (supabase, tenantId) => {
    console.log(`[Mailketing Plugin] Deactivated for tenant: ${tenantId}`);

    // Optionally disable email sending
    await supabase
        .from('settings')
        .update({ value: 'false' })
        .eq('tenant_id', tenantId)
        .eq('key', 'email.enabled');

    return { success: true };
};

/**
 * Uninstall plugin - cleanup all data
 * Called when the plugin is completely removed
 */
export const uninstall = async (supabase, tenantId) => {
    console.log(`[Mailketing Plugin] Uninstalling for tenant: ${tenantId}`);

    // Remove plugin settings
    await supabase
        .from('settings')
        .update({ deleted_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .like('key', 'email.%');

    return { success: true };
};
