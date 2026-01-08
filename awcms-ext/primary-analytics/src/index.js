/**
 * AWCMS External Extension: Advanced Analytics
 * 
 * This is an example external extension demonstrating the plugin architecture.
 * External extensions are loaded dynamically by AWCMS at runtime.
 */

import React from 'react';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import AnalyticsReports from './components/AnalyticsReports';
import AnalyticsWidget from './components/AnalyticsWidget';
import manifest from '../manifest.json';

// Export components
export const components = {
    AnalyticsDashboard,
    AnalyticsReports,
    AnalyticsWidget
};

// Export manifest
export { manifest };

/**
 * Register extension hooks and filters
 * Called when extension is loaded by AWCMS
 */
export const register = ({ addAction, addFilter, supabase, pluginConfig }) => {
    console.log(`[External Extension] ${manifest.name} v${manifest.version} registering...`);

    // Register dashboard widget
    addFilter('dashboard_widgets', 'analytics_widget', (widgets) => {
        return [...widgets, {
            id: 'analytics-overview',
            title: 'Analytics Overview',
            component: AnalyticsWidget,
            size: 'large',
            order: 1
        }];
    });

    // Register admin menu item
    addFilter('admin_menu_items', 'analytics_menu', (items) => {
        return [...items, {
            id: 'analytics',
            label: manifest.menu.label,
            icon: manifest.menu.icon,
            path: manifest.menu.path,
            parent: manifest.menu.parent,
            order: manifest.menu.order,
            permission: 'ext.analytics.view'
        }];
    });

    // Register routes
    addFilter('admin_routes', 'analytics_routes', (routes) => {
        return [...routes,
        { path: '/admin/analytics', element: AnalyticsDashboard, permission: 'ext.analytics.view' },
        { path: '/admin/analytics/reports', element: AnalyticsReports, permission: 'ext.analytics.reports' }
        ];
    });

    // Track page views (example action hook)
    addAction('page_viewed', 'analytics_track', async ({ path, userId, tenantId }) => {
        if (!pluginConfig?.trackPageViews) return;

        try {
            await supabase.from('analytics_events').insert({
                event_type: 'page_view',
                path,
                user_id: userId,
                tenant_id: tenantId,
                created_at: new Date().toISOString()
            });
        } catch (err) {
            console.error('[Analytics] Failed to track page view:', err);
        }
    });

    console.log(`[External Extension] ${manifest.name} registered successfully`);
};

/**
 * Activate extension (first-time setup)
 */
export const activate = async (supabase, tenantId) => {
    console.log(`[External Extension] Activating ${manifest.name}...`);

    // Create analytics table if not exists (via RPC or migration)
    // Note: In production, DDL should be done via proper migrations

    console.log(`[External Extension] ${manifest.name} activated`);
};

/**
 * Deactivate extension
 */
export const deactivate = async (supabase, tenantId) => {
    console.log(`[External Extension] Deactivating ${manifest.name}...`);
    // Cleanup if needed
};

// Default export
export default AnalyticsDashboard;
