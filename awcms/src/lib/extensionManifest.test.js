import { describe, expect, it } from 'vitest';
import { validateExtensionManifest } from '@/lib/extensionManifest';

describe('validateExtensionManifest', () => {
  it('accepts a spec v1 manifest', () => {
    const result = validateExtensionManifest({
      schemaVersion: 1,
      slug: 'events',
      name: 'Events',
      vendor: 'ahliweb',
      version: '1.0.0',
      kind: 'bundled',
      scope: 'tenant',
      compatibility: { awcms: '>=4.1.1' },
      capabilities: ['events:health'],
      resources: { admin: { entry: 'bundled:awcms-ext-ahliweb-events' } },
      permissions: ['tenant.events.read'],
      adminRoutes: [{ path: 'events', component: 'EventsDashboard' }],
      menus: [{ key: 'events', label: 'Events', path: 'events' }],
      publicModules: [{ key: 'events', label: 'Events', url: '/events' }],
      settingsSchema: { type: 'object', properties: {} },
      edgeRoutes: [{ path: '/functions/v1/extensions/events/health', capability: 'events:health' }],
      dependencies: {},
      widgets: [{ key: 'events-overview', component: 'EventsOverviewWidget' }],
      hooks: {},
    });

    expect(result.valid).toBe(true);
    expect(result.manifest?.slug).toBe('events');
  });

  it('fails closed when required fields are missing', () => {
    const result = validateExtensionManifest({
      slug: 'broken',
      name: 'Broken',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
