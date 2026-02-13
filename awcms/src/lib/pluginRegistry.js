/**
 * Plugin Registry
 * 
 * Auto-discovers and manages core plugins from src/plugins/
 * Each plugin must have a plugin.json manifest and index.js entry point.
 */

import React from 'react';

// Static plugin imports (Vite requires static imports for bundling)
// Each plugin exports: { components, manifest, register, activate, deactivate }
import * as BackupPlugin from '@/plugins/backup/index.js';
import * as HelloWorldPlugin from '@/plugins/helloworld/HelloWorld.jsx';
import * as MailketingPlugin from '@/plugins/mailketing/index.js';

import * as RegionsPlugin from '@/plugins/regions/index.js';
// Import Analytics Extension (Local Integration)
import * as AnalyticsExtension from '@/extensions/ahliweb-analytics/src/index.js';

// Plugin Registry Map
const PLUGIN_REGISTRY = {
    'backup': BackupPlugin,
    'helloworld': HelloWorldPlugin,
    'mailketing': MailketingPlugin,
    'regions': RegionsPlugin,
    'awcms-ext-ahliweb-analytics': AnalyticsExtension
};

/**
 * Get all registered plugins
 * @returns {Object} Map of plugin slug to plugin module
 */
export const getAllPlugins = () => PLUGIN_REGISTRY;

/**
 * Get a specific plugin by slug
 * @param {string} slug - Plugin slug (e.g., 'backup')
 * @returns {Object|null} Plugin module or null
 */
export const getPlugin = (slug) => PLUGIN_REGISTRY[slug] || null;

/**
 * Get a specific component from a plugin
 * @param {string} key - Component key (e.g., 'backup:BackupManager' or 'BackupManager')
 * @returns {React.Component} Component or fallback
 */
export const getPluginComponent = (key) => {
    // Handle namespaced keys (plugin:component)
    if (key.includes(':')) {
        const [pluginSlug, componentName] = key.split(':');
        const plugin = PLUGIN_REGISTRY[pluginSlug];
        if (plugin?.components?.[componentName]) {
            return plugin.components[componentName];
        }
    }

    // Search all plugins for component
    for (const plugin of Object.values(PLUGIN_REGISTRY)) {
        if (plugin.components?.[key]) {
            return plugin.components[key];
        }
        // Also check default export
        if (plugin.default && typeof plugin.default === 'function') {
            return plugin.default;
        }
    }

    // Fallback
    const FallbackComponent = () => React.createElement('div', { className: "p-4 text-red-500" }, `Plugin component "${key}" not found.`);
    FallbackComponent.displayName = `Fallback(${key})`;
    return FallbackComponent;
};

/**
 * Get all available component keys
 * @returns {string[]} Array of component keys
 */
export const getAvailableComponents = () => {
    const keys = [];
    for (const [slug, plugin] of Object.entries(PLUGIN_REGISTRY)) {
        if (plugin.components) {
            Object.keys(plugin.components).forEach(name => {
                keys.push(`${slug}:${name}`);
            });
        }
    }
    return keys;
};

/**
 * Get plugin manifest
 * @param {string} slug - Plugin slug
 * @returns {Object|null} Manifest or null
 */
export const getPluginManifest = (slug) => {
    const plugin = PLUGIN_REGISTRY[slug];
    return plugin?.manifest || null;
};

/**
 * Check if plugin has lifecycle methods
 * @param {string} slug - Plugin slug
 * @returns {Object} { hasRegister, hasActivate, hasDeactivate }
 */
export const getPluginLifecycle = (slug) => {
    const plugin = PLUGIN_REGISTRY[slug];
    return {
        hasRegister: typeof plugin?.register === 'function',
        hasActivate: typeof plugin?.activate === 'function',
        hasDeactivate: typeof plugin?.deactivate === 'function'
    };
};

// Legacy compatibility - map old keys to new
const LEGACY_KEY_MAP = {
    'BackupManager': 'backup:BackupManager',
    'BackupScheduler': 'backup:BackupScheduler',
    'BackupSettings': 'backup:BackupSettings',
    'HelloWorld': 'helloworld'
};

/**
 * Get extension component (Legacy API)
 * @deprecated Use getPluginComponent instead
 */
export const getExtensionComponent = (key) => {
    const mappedKey = LEGACY_KEY_MAP[key] || key;
    return getPluginComponent(mappedKey);
};

const pluginRegistry = {
    getAllPlugins,
    getPlugin,
    getPluginComponent,
    getAvailableComponents,
    getPluginManifest,
    getPluginLifecycle,
    getExtensionComponent
};

export default pluginRegistry;
