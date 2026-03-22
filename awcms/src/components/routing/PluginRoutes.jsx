/**
 * PluginRoutes Component
 * 
 * Renders dynamic routes registered by plugins via the 'admin_routes' filter.
 * Used inside AdminLayout to inject plugin-defined routes.
 */

import { Suspense, useMemo } from 'react';
import { Route } from 'react-router-dom';
import { usePlugins } from '@/contexts/PluginContext';
import SecureRouteGate from '@/components/routing/SecureRouteGate';
import { getPlugin } from '@/lib/pluginRegistry';
import { getManifestRoutes } from '@/lib/extensionRuntime';

// Loading fallback
const RouteLoader = () => (
    <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
);

/**
 * Get plugin routes from the filter system
 */
export const usePluginRoutes = () => {
    const { applyFilters, isLoading, activePlugins } = usePlugins();

    const routes = useMemo(() => {
        if (isLoading) return [];

        // Get routes registered by plugins via 'admin_routes' filter
        const filteredRoutes = applyFilters('admin_routes', []);
        const manifestRoutes = (activePlugins || []).flatMap((extensionRecord) => {
            const bundledEntry = extensionRecord?.manifest?.resources?.admin?.entry;
            const pluginKey = bundledEntry?.startsWith('bundled:')
                ? bundledEntry.replace('bundled:', '')
                : extensionRecord?.slug;
            const pluginModule = pluginKey ? getPlugin(pluginKey) : null;
            return getManifestRoutes({ pluginKey, extensionRecord, pluginModule });
        });
        const pluginRoutes = [...filteredRoutes, ...manifestRoutes];

        // Validate and normalize routes
        return pluginRoutes
            .filter(route => route.path && route.element)
            .map(route => ({
                path: route.path.startsWith('/') ? route.path.slice(1) : route.path,
                element: route.element,
                permission: route.permission || null,
                lazy: route.lazy !== false,
                secureParams: route.secureParams || route.secure_params || [],
                secureScope: route.secureScope || route.secure_scope || null,
                secureFallback: route.secureFallback || route.secure_fallback || '/cmspanel'
            }));
    }, [activePlugins, applyFilters, isLoading]);

    return { routes, isLoading };
};

/**
 * PluginRoutes Component
 * Renders Route elements for each plugin-registered route
 */
export const PluginRoutes = () => {
    const { routes } = usePluginRoutes();

    if (routes.length === 0) {
        return null;
    }

    return (
        <>
            {routes.map((route) => {
                const Element = route.element;
                const renderElement = (secureParams) => {
                    const elementProps = secureParams ? { secureParams } : {};
                    return route.lazy ? (
                        <Suspense fallback={<RouteLoader />}>
                            <Element {...elementProps} />
                        </Suspense>
                    ) : (
                        <Element {...elementProps} />
                    );
                };

                const element = route.secureParams?.length ? (
                    <SecureRouteGate
                        routePath={route.path}
                        secureParams={route.secureParams}
                        scopeBase={route.secureScope}
                        fallback={route.secureFallback}
                        loadingFallback={<RouteLoader />}
                    >
                        {(secureParams) => renderElement(secureParams)}
                    </SecureRouteGate>
                ) : (
                    renderElement(null)
                );

                return (
                    <Route
                        key={route.path}
                        path={route.path}
                        element={element}
                    />
                );
            })}
        </>
    );
};
