/**
 * tenancy.test.js
 * Unit tests for the deployment-cell tenancy resolution layer.
 *
 * Tests: routeClass, serviceProfile, resolveCell, and resolveTenant (mocked DB).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deriveRouteClass, RouteClass } from '../routeClass';
import {
  getServiceProfileMeta,
  requiresCellMigration,
  ServiceProfile,
} from '../serviceProfile';
import { isCellActive, isCellInMaintenance, getCellFailureReason } from '../resolveCell';
import { resolveTenantByHostname } from '../resolveTenant';

// ============================================================
// Mock Supabase client
// vi.mock is hoisted so we must NOT reference outer variables inside the factory.
// We use vi.fn() inline and access the mock via the imported module after mocking.
// ============================================================

vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

// Import the mocked module so we can configure its return values in each test
import { supabase as mockSupabase } from '@/lib/customSupabaseClient';

// ============================================================
// RouteClass tests
// ============================================================

describe('deriveRouteClass', () => {
  it('maps platform_subdomain → public', () => {
    expect(deriveRouteClass('platform_subdomain')).toBe(RouteClass.PUBLIC);
  });

  it('maps custom_domain → public', () => {
    expect(deriveRouteClass('custom_domain')).toBe(RouteClass.PUBLIC);
  });

  it('maps admin_domain → admin', () => {
    expect(deriveRouteClass('admin_domain')).toBe(RouteClass.ADMIN);
  });

  it('maps api_domain → api', () => {
    expect(deriveRouteClass('api_domain')).toBe(RouteClass.API);
  });

  it('maps cdn_domain → cdn', () => {
    expect(deriveRouteClass('cdn_domain')).toBe(RouteClass.CDN);
  });

  it('maps preview_domain → preview', () => {
    expect(deriveRouteClass('preview_domain')).toBe(RouteClass.PREVIEW);
  });

  it('throws on unknown domain_kind', () => {
    expect(() => deriveRouteClass('unknown_kind')).toThrow(/Unknown domain_kind/);
  });
});

// ============================================================
// ServiceProfile tests
// ============================================================

describe('getServiceProfileMeta', () => {
  it('returns metadata for shared_managed', () => {
    const meta = getServiceProfileMeta(ServiceProfile.SHARED_MANAGED);
    expect(meta.runtimeIsolation).toBe('shared');
    expect(meta.quotaCheckRequired).toBe(true);
  });

  it('returns metadata for dedicated_managed', () => {
    const meta = getServiceProfileMeta(ServiceProfile.DEDICATED_MANAGED);
    expect(meta.runtimeIsolation).toBe('dedicated');
    expect(meta.dataIsolation).toBe('dedicated');
  });

  it('throws on unknown profile', () => {
    expect(() => getServiceProfileMeta('nonexistent')).toThrow(/Unknown profile/);
  });
});

describe('requiresCellMigration', () => {
  it('returns false for same profile', () => {
    expect(requiresCellMigration('shared_managed', 'shared_managed')).toBe(false);
  });

  it('returns true when moving from shared to dedicated (runtime changes)', () => {
    expect(requiresCellMigration('shared_managed', 'dedicated_managed')).toBe(true);
  });

  it('returns false for vanity overlay (same isolation levels)', () => {
    // vanity_domain_saas is 'shared' runtime — same as shared_managed
    expect(requiresCellMigration('shared_managed', 'vanity_domain_saas')).toBe(false);
  });
});

// ============================================================
// resolveCell tests
// ============================================================

describe('isCellActive', () => {
  it('returns true for active cell', () => {
    expect(isCellActive({ status: 'active' })).toBe(true);
  });

  it('returns false for maintenance cell', () => {
    expect(isCellActive({ status: 'maintenance' })).toBe(false);
  });

  it('returns false for null cell', () => {
    expect(isCellActive(null)).toBe(false);
  });
});

describe('isCellInMaintenance', () => {
  it('returns true for maintenance status', () => {
    expect(isCellInMaintenance({ status: 'maintenance' })).toBe(true);
  });

  it('returns false for active status', () => {
    expect(isCellInMaintenance({ status: 'active' })).toBe(false);
  });
});

describe('getCellFailureReason', () => {
  it('returns message for decommissioned cell', () => {
    expect(getCellFailureReason({ status: 'decommissioned' })).toMatch(/decommissioned/);
  });

  it('returns message for null cell', () => {
    expect(getCellFailureReason(null)).toMatch(/not found/);
  });
});

// ============================================================
// resolveTenantByHostname tests
// ============================================================

describe('resolveTenantByHostname', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for empty hostname', async () => {
    const result = await resolveTenantByHostname('');
    expect(result).toBeNull();
  });

  it('returns null when RPC returns null (unknown hostname)', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    const result = await resolveTenantByHostname('unknown.example.com');
    expect(result).toBeNull();
  });

  it('returns null when RPC returns an error', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });
    const result = await resolveTenantByHostname('test.example.com');
    expect(result).toBeNull();
  });

  it('returns a full TenantResolutionResult for a known active hostname', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        projectId:      'proj-uuid',
        tenantId:       'tenant-uuid',
        tenantCode:     'acme',
        tenantStatus:   'active',
        cellId:         'cell-uuid',
        serviceProfile: 'shared_managed',
        domainId:       'domain-uuid',
        hostname:       'acme.example.com',
        domainKind:     'custom_domain',
        isPrimary:      true,
      },
      error: null,
    });

    const result = await resolveTenantByHostname('acme.example.com');

    expect(result).not.toBeNull();
    expect(result.routeClass).toBe(RouteClass.PUBLIC);
    expect(result.tenantCode).toBe('acme');
    expect(result.serviceProfile).toBe('shared_managed');
    expect(result.isPrimary).toBe(true);
  });

  it('normalizes hostname to lowercase', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    await resolveTenantByHostname('ACME.EXAMPLE.COM');
    expect(mockSupabase.rpc).toHaveBeenCalledWith('resolve_tenant_by_hostname', {
      p_hostname: 'acme.example.com',
    });
  });

  it('returns null if domainKind is invalid (cannot derive routeClass)', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: {
        projectId:      'proj-uuid',
        tenantId:       'tenant-uuid',
        tenantCode:     'acme',
        tenantStatus:   'active',
        cellId:         'cell-uuid',
        serviceProfile: 'shared_managed',
        domainId:       'domain-uuid',
        hostname:       'acme.example.com',
        domainKind:     'invalid_kind', // bad value
        isPrimary:      false,
      },
      error: null,
    });

    const result = await resolveTenantByHostname('acme.example.com');
    expect(result).toBeNull();
  });
});
