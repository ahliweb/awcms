/**
 * PluginRoutes Component
 * 
 * Renders dynamic routes registered by plugins via the 'admin_routes' filter.
 * Used inside AdminLayout to inject plugin-defined routes.
 */

import { Suspense, useMemo } from 'react';
import { Route } from 'react-router-dom';
import { usePlugins } from '@/contexts/PluginContext';

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
    const { applyFilters, isLoading } = usePlugins();

    const routes = useMemo(() => {
        if (isLoading) return [];

        // Get routes registered by plugins via 'admin_routes' filter
        const pluginRoutes = applyFilters('admin_routes', []);

        // Validate and normalize routes
        return pluginRoutes
            .filter(route => route.path && route.element)
            .map(route => ({
                path: route.path.startsWith('/') ? route.path.slice(1) : route.path,
                element: route.element,
                permission: route.permission || null,
                lazy: route.lazy !== false
            }));
    }, [applyFilters, isLoading]);

    return { routes, isLoading };
};

/**
 * PluginRoutes Component
 * Renders Route elements for each plugin-registered route
 */
const PluginRoutes = () => {
    const { routes } = usePluginRoutes();

    if (routes.length === 0) {
        return null;
    }

    return (
        <>
            {routes.map((route) => {
                const Element = route.element;

                return (
                    <Route
                        key={route.path}
                        path={route.path}
                        element={
                            route.lazy ? (
                                <Suspense fallback={<RouteLoader />}>
                                    <Element />
                                </Suspense>
                            ) : (
                                <Element />
                            )
                        }
                    />
                );
            })}
        </>
    );
};

export default PluginRoutes;
