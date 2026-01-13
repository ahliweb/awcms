
import RegionsManager from './RegionsManager';
import manifest from './plugin.json';

// Export components
export const components = {
    RegionsManager
};

// Export manifest
export { manifest };

// Register hooks
export const register = ({ addFilter }) => {


    // Routes
    addFilter('admin_routes', 'regions_routes', (routes) => {
        return [...routes, {
            path: 'regions', // This should match what MainRouter expects for children
            element: RegionsManager,
            permission: 'tenant.region.read'
        }];
    });
};
