import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ error: null })),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

import { useModules } from '../useModules';
import { useAdminMenu } from '../useAdminMenu';

const modulesRows = [
  {
    id: 'module-blogs',
    tenant_id: 'tenant-1',
    name: 'Blogs',
    slug: 'blogs',
    status: 'active',
    created_at: '2026-03-20T00:00:00.000Z',
    updated_at: '2026-03-20T00:00:00.000Z',
  },
  {
    id: 'module-platform',
    tenant_id: 'tenant-2',
    name: 'Modules',
    slug: 'modules',
    status: 'inactive',
    created_at: '2026-03-20T00:00:00.000Z',
    updated_at: '2026-03-20T00:00:00.000Z',
  },
];

const adminMenuRows = [
  {
    id: 'menu-blogs',
    key: 'blogs',
    label: 'Blogs',
    path: 'blogs',
    group_label: 'CONTENT',
    group_order: 10,
    order: 10,
    is_visible: true,
    permission: 'tenant.blog.read',
    scope: 'tenant',
  },
  {
    id: 'menu-modules',
    key: 'modules',
    label: 'Modules',
    path: 'modules',
    group_label: 'SYSTEM',
    group_order: 60,
    order: 40,
    is_visible: true,
    permission: 'platform.module.read',
    scope: 'platform',
  },
];

const tenantsRows = [
  { id: 'tenant-1' },
  { id: 'tenant-2' },
];

const resourcesRows = [];
const extensionMenuRows = [];

const channelBuilder = () => {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  };
  return channel;
};

vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: supabaseMock,
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-1', name: 'Tenant One', subscription_tier: 'free' } }),
}));

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    isPlatformAdmin: true,
    isFullAccess: false,
    isTenantAdmin: true,
    userRole: 'owner',
    hasPermission: (permission) => ['platform.module.manage', 'platform.module.read', 'tenant.blog.read'].includes(permission),
    hasAnyPermission: (permissions = []) => permissions.some((permission) => ['platform.module.manage', 'platform.module.read', 'tenant.blog.read'].includes(permission)),
  }),
}));

vi.mock('@/lib/hooks', () => ({
  hooks: {
    applyFilters: vi.fn((hookName, value) => value),
  },
}));

vi.mock('@/lib/adminMenuUtils', () => ({
  normalizeMenuPath: (path) => path,
  resolveGroupMeta: (label, order = 999) => ({ label: label || 'General', order: order || 999 }),
  resolveResourcePath: (_key, path) => path,
}));

function buildModulesSelectChain(rows = modulesRows) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.order = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  chain.eq = vi.fn(() => chain);
  return chain;
}

function buildAdminMenuSelectChain(rows = adminMenuRows) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.order = vi.fn((field) => {
    if (field === 'group_order') return chain;
    return Promise.resolve({ data: rows, error: null });
  });
  return chain;
}

function buildResourcesSelectChain(rows = resourcesRows) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

function buildExtensionMenuSelectChain(rows = extensionMenuRows) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.is = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

function buildTenantsSelectChain(rows = tenantsRows) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

describe('module refresh wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.channel.mockImplementation(() => channelBuilder());

    supabaseMock.from.mockImplementation((table) => {
      if (table === 'modules') {
        return {
          select: vi.fn(() => {
            const selectChain = buildModulesSelectChain();
            selectChain.update = vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            }));
            return selectChain;
          }),
          update: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ error: null })),
          })),
        };
      }

      if (table === 'admin_menus') {
        return buildAdminMenuSelectChain();
      }

      if (table === 'resources_registry') {
        return buildResourcesSelectChain();
      }

      if (table === 'tenants') {
        return buildTenantsSelectChain();
      }

      if (table === 'extension_menu_items') {
        return buildExtensionMenuSelectChain();
      }

      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('dispatches a shared refresh event after a module toggle', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result } = renderHook(() => useModules());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.modules).toHaveLength(2);
    });

    await act(async () => {
      await result.current.toggleModuleStatus('module-blogs', 'active');
    });

    expect(dispatchSpy).toHaveBeenCalled();

    const customEvent = dispatchSpy.mock.calls.find(([event]) => event?.type === 'awcms:modules-changed')?.[0];
    expect(customEvent).toBeDefined();
    expect(customEvent.detail).toMatchObject({
      tenantId: 'tenant-1',
      moduleId: 'module-blogs',
      slug: 'blogs',
      status: 'inactive',
      source: 'toggle',
    });
  });

  it('refetches admin menu data when the shared module event fires', async () => {
    const { result } = renderHook(() => useAdminMenu());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.menuItems).toHaveLength(2);
    });

    const initialAdminMenuCalls = supabaseMock.from.mock.calls.filter(([table]) => table === 'admin_menus').length;

    await act(async () => {
      window.dispatchEvent(new CustomEvent('awcms:modules-changed', {
        detail: { tenantId: 'tenant-1', source: 'toggle', slug: 'blogs' },
      }));
    });

    await waitFor(() => {
      const nextAdminMenuCalls = supabaseMock.from.mock.calls.filter(([table]) => table === 'admin_menus').length;
      expect(nextAdminMenuCalls).toBeGreaterThan(initialAdminMenuCalls);
    });
  });

  it('keeps platform menu items visible even if another tenant marks that module inactive', async () => {
    const { result } = renderHook(() => useAdminMenu());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const keys = result.current.menuItems.map((item) => item.key);
    expect(keys).toContain('blogs');
    expect(keys).toContain('modules');
  });

  it('syncs modules for every tenant when run by a platform admin', async () => {
    const { result } = renderHook(() => useModules());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.syncModules();
    });

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(2);
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(1, 'sync_modules_from_sidebar', {
      p_tenant_id: 'tenant-1',
    });
    expect(supabaseMock.rpc).toHaveBeenNthCalledWith(2, 'sync_modules_from_sidebar', {
      p_tenant_id: 'tenant-2',
    });
  });
});
