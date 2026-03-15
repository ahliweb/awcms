import { describe, expect, it } from 'vitest';
import { getPlugin } from '@/lib/pluginRegistry';

describe('pluginRegistry', () => {
  it('exposes the bundled events extension runtime', () => {
    const plugin = getPlugin('awcms-ext-ahliweb-events');

    expect(plugin).toBeTruthy();
    expect(plugin.manifest.slug).toBe('events');
    expect(plugin.manifest.menus[0].key).toBe('events');
    expect(plugin.manifest.adminRoutes[0].path).toBe('events');
    expect(plugin.manifest.widgets[0].key).toBe('events-overview');
  });
});
