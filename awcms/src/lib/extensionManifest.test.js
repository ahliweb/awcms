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
      runtime_mode: 'trusted',
      compatibility: { awcms: '>=4.1.1' },
      capabilities: ['tenant.events.read'],
      resources: { admin: { entry: 'bundled:awcms-ext-ahliweb-events' } },
      permissions: ['tenant.events.read'],
      adminRoutes: [{ path: 'events', component: 'EventsDashboard' }],
      menus: [{ key: 'events', label: 'Events', path: 'events' }],
      publicModules: [{ key: 'events', label: 'Events', url: '/events' }],
      settingsSchema: { type: 'object', properties: {} },
      edgeRoutes: [{ path: '/functions/v1/extensions/events/health', capability: 'tenant.events.read' }],
      dependencies: {},
      widgets: [{ key: 'events-overview', component: 'EventsOverviewWidget' }],
      hooks: {},
    });

    expect(result.valid).toBe(true);
    expect(result.manifest?.slug).toBe('events');
    expect(result.diagnostics.validationStatus).toBe('valid');
  });

  it('fails closed when required fields are missing', () => {
    const result = validateExtensionManifest({
      slug: 'broken',
      name: 'Broken',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects capabilities that are not scope.resource.action identifiers', () => {
    const result = validateExtensionManifest({
      schemaVersion: 1,
      slug: 'events',
      name: 'Events',
      vendor: 'ahliweb',
      version: '1.0.0',
      kind: 'bundled',
      scope: 'tenant',
      runtime_mode: 'trusted',
      capabilities: ['events:health'],
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.reasonCategories).toContain('capability_validation_failed');
  });

  it('requires runtime_mode for new manifests', () => {
    const result = validateExtensionManifest({
      schemaVersion: 1,
      slug: 'events',
      name: 'Events',
      vendor: 'ahliweb',
      version: '1.0.0',
      kind: 'bundled',
      scope: 'tenant',
      capabilities: ['tenant.events.read'],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('runtime_mode is required');
  });

  it('accepts sandbox metadata and marks it metadata-only', () => {
    const result = validateExtensionManifest({
      schemaVersion: 1,
      slug: 'sandbox-events',
      name: 'Sandbox Events',
      vendor: 'ahliweb',
      version: '1.0.0',
      kind: 'bundled',
      scope: 'tenant',
      runtime_mode: 'trusted',
      capabilities: ['tenant.events.read'],
      sandbox_profile: {
        requested: true,
        network_access: 'outbound_http',
        storage_access: 'tenant_template_parts',
        worker_bindings: ['EVENTS_KV'],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.diagnostics.sandboxReadinessStatus).toBe('metadata_only');
    expect(result.diagnostics.sandboxProfile.worker_bindings).toContain('EVENTS_KV');
  });
});
