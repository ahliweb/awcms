import React, { createContext, useContext, useEffect, useState } from 'react';
import { hooks } from '@/lib/hooks';
import { supabase } from '@/lib/customSupabaseClient';
import { getAllPlugins, getPlugin, getPluginComponent } from '@/lib/pluginRegistry';
import { loadExternalExtension } from '@/lib/externalExtensionLoader';
import { listActiveTenantExtensions } from '@/lib/extensionCatalog';
import { registerManifestArtifacts } from '@/lib/extensionRuntime';
import ExtensionErrorBoundary from '@/components/ui/ExtensionErrorBoundary';
import { useTenant } from '@/contexts/TenantContext';

const PluginContext = createContext(null);

export const usePlugins = () => {
    const context = useContext(PluginContext);
    if (!context) {
        throw new Error('usePlugins must be used within a PluginProvider');
    }
    return context;
};

/**
 * Component to render content injected via filters
 * Usage: <PluginSlot name="dashboard_top" args={{ user }} />
 */
export const PluginSlot = ({ name, args = {}, fallback = null }) => {
    const { applyFilters } = usePlugins();
    const components = applyFilters(name, []);

    if (!Array.isArray(components) || components.length === 0) {
        return fallback;
    }

    return (
        <>
            {components.map((Comp, index) => (
                <ExtensionErrorBoundary key={index} extensionName={`Plugin: ${name}`}>
                    {React.isValidElement(Comp) ? Comp : <Comp {...args} />}
                </ExtensionErrorBoundary>
            ))}
        </>
    );
};

// Backward compatibility alias
export const PluginAction = PluginSlot;

export const PluginProvider = ({ children }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [activePlugins, setActivePlugins] = useState([]);
    const [registeredPlugins, setRegisteredPlugins] = useState([]);
    const [externalPlugins, setExternalPlugins] = useState([]);
    const { currentTenant } = useTenant();

    // Expose hook methods
    const { addAction, doAction, addFilter, applyFilters, removeAction, removeFilter } = hooks;

    useEffect(() => {
        const loadPlugins = async () => {
            setIsLoading(true);
            try {
                // 1. Fetch active plugins from database
                const dbPlugins = await listActiveTenantExtensions(currentTenant?.id || null);

                setActivePlugins(dbPlugins || []);

                // 2. Separate bundled and external plugins
                const corePlugins = (dbPlugins || []).filter((plugin) => plugin.kind !== 'external');
                const extPlugins = (dbPlugins || []).filter((plugin) => plugin.kind === 'external');

                const allBundledPlugins = getAllPlugins();
                const registered = [];
                const loadedExternal = [];

                // 3. Register core plugins
                for (const dbPlugin of corePlugins) {
                    try {
                        const bundledEntry = dbPlugin.manifest?.resources?.admin?.entry;
                        const pluginKey = bundledEntry?.startsWith('bundled:')
                            ? bundledEntry.replace('bundled:', '')
                            : dbPlugin.slug;
                        const pluginModule = allBundledPlugins[pluginKey] || getPlugin(pluginKey);

                        if (!pluginModule) {
                            console.warn(`[Core Plugin] "${pluginKey}" not found in registry`);
                            continue;
                        }

                        if (typeof pluginModule.register !== 'function') {
                            registerManifestArtifacts({ addFilter, pluginKey, extensionRecord: dbPlugin, pluginModule });
                        }

                        if (typeof pluginModule.register === 'function') {
                            pluginModule.register({
                                addAction,
                                addFilter,
                                supabase,
                                pluginConfig: dbPlugin.config || {},
                                tenantId: dbPlugin.tenant_id || null,
                                manifest: dbPlugin.manifest,
                            });
                            registered.push(pluginKey);
                            console.log(`[Core Plugin] Registered: ${dbPlugin.name}`);
                        }
                    } catch (err) {
                        console.error(`[Core Plugin] Failed to register ${dbPlugin.name}:`, err);
                    }
                }

                // 4. Load external plugins (async)
                for (const extPlugin of extPlugins) {
                    try {
                        const manifest = extPlugin.manifest;
                        const pluginKey = `${manifest.vendor}-${manifest.slug}`;

                        // Pass tenant_id for multi-tenant context
                        const loadedModule = await loadExternalExtension(manifest, extPlugin.tenant_id);

                        if (typeof loadedModule.register !== 'function') {
                            registerManifestArtifacts({ addFilter, pluginKey, extensionRecord: extPlugin, pluginModule: loadedModule });
                        }

                        if (loadedModule.loaded && typeof loadedModule.register === 'function') {
                            loadedModule.register({
                                addAction,
                                addFilter,
                                supabase,
                                tenantId: extPlugin.tenant_id, // Pass tenant context
                                pluginConfig: extPlugin.config || {},
                                manifest,
                            });
                            registered.push(pluginKey);
                            loadedExternal.push({ ...extPlugin, module: loadedModule });
                            console.log(`[External Plugin] Registered: ${extPlugin.name}`);
                        } else if (!loadedModule.loaded) {
                            console.error(`[External Plugin] Failed to load: ${extPlugin.name}`, loadedModule.error);
                        }
                    } catch (err) {
                        console.error(`[External Plugin] Failed to load ${extPlugin.name}:`, err);
                    }
                }

                setRegisteredPlugins(registered);
                setExternalPlugins(loadedExternal);

                // 5. Trigger 'plugins_loaded' action
                doAction('plugins_loaded', {
                    core: corePlugins.length,
                    external: loadedExternal.length,
                    total: registered.length
                });

            } catch (err) {
                console.error("Error loading plugins:", err);
            } finally {
                setIsLoading(false);
            }
        };

        loadPlugins();
    }, [addAction, addFilter, doAction, currentTenant?.id]);

    const value = {
        isLoading,
        activePlugins,
        registeredPlugins,
        externalPlugins,
        addAction,
        doAction,
        addFilter,
        applyFilters,
        removeAction,
        removeFilter,
        // APIs
        getPluginComponent,
        getAllPlugins,
        loadExternalExtension
    };

    return (
        <PluginContext.Provider value={value}>
            {children}
        </PluginContext.Provider>
    );
};
