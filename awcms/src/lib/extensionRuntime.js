import { getPluginComponent } from '@/lib/pluginRegistry';

const resolveManifestComponent = (pluginKey, pluginModule, componentName) => {
  if (!componentName) return null;

  if (pluginModule?.components?.[componentName]) {
    return pluginModule.components[componentName];
  }

  if (typeof pluginModule?.[componentName] === 'function') {
    return pluginModule[componentName];
  }

  if (pluginKey) {
    return getPluginComponent(`${pluginKey}:${componentName}`);
  }

  return getPluginComponent(componentName);
};

export const registerManifestArtifacts = ({ addFilter, pluginKey, extensionRecord, pluginModule }) => {
  const manifest = extensionRecord?.manifest;
  if (!manifest) return;

  if (Array.isArray(manifest.menus) && manifest.menus.length > 0) {
    addFilter('admin_menu_items', `${pluginKey}_manifest_menus`, (items) => [
      ...items,
      ...manifest.menus.map((menu) => ({
        id: `${pluginKey}:${menu.key}`,
        key: menu.key,
        label: menu.label,
        icon: menu.icon || 'Puzzle',
        path: menu.path,
        parent: menu.parent,
        group: menu.group,
        order: menu.order,
        permission: menu.permission,
        plugin_type: extensionRecord.kind,
      })),
    ]);
  }

  if (Array.isArray(manifest.adminRoutes) && manifest.adminRoutes.length > 0) {
    addFilter('admin_routes', `${pluginKey}_manifest_routes`, (routes) => [
      ...routes,
      ...manifest.adminRoutes
        .map((route) => {
          const component = resolveManifestComponent(pluginKey, pluginModule, route.component);
          if (!component) return null;
          return {
            path: route.path,
            element: component,
            permission: route.permission,
            secureParams: route.secureParams,
            secureScope: route.secureScope,
          };
        })
        .filter(Boolean),
    ]);
  }

  if (Array.isArray(manifest.widgets) && manifest.widgets.length > 0) {
    addFilter('dashboard_widgets', `${pluginKey}_manifest_widgets`, (widgets) => [
      ...widgets,
      ...manifest.widgets
        .map((widget) => {
          const component = resolveManifestComponent(pluginKey, pluginModule, widget.component);
          if (!component) return null;
          return {
            id: widget.key,
            title: widget.title,
            icon: widget.icon,
            badge: widget.badge,
            component,
            position: widget.position,
            order: widget.order,
          };
        })
        .filter(Boolean),
    ]);
  }
};

export const getManifestRoutes = ({ pluginKey, extensionRecord, pluginModule }) => {
  const manifest = extensionRecord?.manifest;
  if (!manifest || !Array.isArray(manifest.adminRoutes)) {
    return [];
  }

  return manifest.adminRoutes
    .map((route) => {
      const component = resolveManifestComponent(pluginKey, pluginModule, route.component);
      if (!component) return null;
      return {
        path: route.path,
        element: component,
        permission: route.permission,
        secureParams: route.secureParams,
        secureScope: route.secureScope,
      };
    })
    .filter(Boolean);
};
