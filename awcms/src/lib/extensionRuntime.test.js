import { describe, expect, it } from 'vitest';
import { createHooks } from '@/lib/hooks';
import { getPlugin } from '@/lib/pluginRegistry';
import { registerManifestArtifacts } from '@/lib/extensionRuntime';

describe('registerManifestArtifacts', () => {
  it('registers menu, route, and widget artifacts from the events manifest', () => {
    const hookBag = createHooks();
    const plugin = getPlugin('awcms-ext-ahliweb-events');

    registerManifestArtifacts({
      addFilter: hookBag.addFilter,
      pluginKey: 'awcms-ext-ahliweb-events',
      extensionRecord: { kind: 'bundled', manifest: plugin.manifest },
      pluginModule: plugin,
    });

    const menus = hookBag.applyFilters('admin_menu_items', []);
    const routes = hookBag.applyFilters('admin_routes', []);
    const widgets = hookBag.applyFilters('dashboard_widgets', []);

    expect(menus.some((item) => item.key === 'events' && item.permission === 'tenant.events.read')).toBe(true);
    expect(routes.some((item) => item.path === 'events' && item.permission === 'tenant.events.read')).toBe(true);
    expect(widgets.some((item) => item.id === 'events-overview' && item.position === 'sidebar')).toBe(true);
  });
});
