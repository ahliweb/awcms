/**
 * resolveTenant.js
 * Deployment Cell — Primary Runtime Tenant Resolver
 *
 * Implements the hostname-driven tenant resolution algorithm defined
 * in the Deployment Cell Implementation Package v1, §10.
 *
 * Usage:
 *   import { resolveTenantByHostname } from '@/lib/tenancy/resolveTenant';
 *   const ctx = await resolveTenantByHostname(window.location.hostname);
 *   if (!ctx) { // apply 404 / fallback policy }
 */

import { supabase } from '@/lib/customSupabaseClient';
import { deriveRouteClass, RouteClass } from '@/lib/tenancy/routeClass';

/**
 * @typedef {Object} TenantResolutionResult
 * @property {string} projectId
 * @property {string} tenantId
 * @property {string} tenantCode
 * @property {string} tenantStatus      - e.g. 'active', 'migrating', 'suspended'
 * @property {string|null} cellId
 * @property {string|null} serviceProfile    - e.g. 'shared_managed'
 * @property {string|null} domainId
 * @property {string} hostname          - normalized input hostname
 * @property {string|null} domainKind   - raw domain_kind from DB
 * @property {string} routeClass        - derived from domainKind via RouteClass enum
 * @property {boolean} isPrimary
 * @property {boolean} isLegacyResolution - true when resolved via legacy tenants table (dev only)
 */

/**
 * Resolves a tenant context from a given hostname.
 *
 * Algorithm (spec §10.2):
 *   1. Normalize hostname (lowercase, trim)
 *   2. Call `resolve_tenant_by_hostname` DB RPC, which:
 *      - joins tenant_domains → tenants_control → deployment_cells → platform_projects
 *      - enforces: domain verified, active window, active cell, active tenant
 *   3. Derive routeClass from domainKind
 *   4. Return canonical context object
 *
 * Failure behavior (spec §10.3):
 *   - Unknown hostname → returns null (apply 404 / fallback landing)
 *   - Inactive tenant  → returns null (apply suspension policy upstream)
 *   - Inactive cell    → returns null (apply maintenance policy upstream)
 *
 * @param {string} hostname - Raw hostname to resolve (e.g. from window.location.hostname)
 * @returns {Promise<TenantResolutionResult|null>}
 */
export async function resolveTenantByHostname(hostname) {
  const normalized = (hostname || '').toLowerCase().trim();

  if (!normalized) {
    console.warn('[resolveTenant] Called with empty hostname.');
    return null;
  }

  try {
    const { data, error } = await supabase.rpc('resolve_tenant_by_hostname', {
      p_hostname: normalized,
    });

    if (error) {
      console.error('[resolveTenant] RPC error:', error.message);
      return null;
    }

    if (!data) {
      console.warn('[resolveTenant] No active tenant found for hostname:', normalized);
      return null;
    }

    // Derive routeClass from domainKind
    let routeClass;
    try {
      routeClass = deriveRouteClass(data.domainKind);
    } catch (routeErr) {
      console.error('[resolveTenant] Cannot derive routeClass:', routeErr.message);
      return null;
    }

    return {
      projectId:      data.projectId,
      tenantId:       data.tenantId,
      tenantCode:     data.tenantCode,
      tenantStatus:   data.tenantStatus,
      cellId:         data.cellId,
      serviceProfile: data.serviceProfile,
      domainId:       data.domainId,
      hostname:       data.hostname,
      domainKind:     data.domainKind,
      routeClass,
      isPrimary:      data.isPrimary,
      name:           data.name,
      isLegacyResolution: false,
    };
  } catch (err) {
    console.error('[resolveTenant] Unexpected error:', err);
    return null;
  }
}

/**
 * Dev-mode tenant resolver.
 *
 * In development (localhost / 127.0.0.1), uses 'localhost' as the hostname
 * so it resolves through the full control-plane stack — giving you a real
 * cellId, serviceProfile, and domainId in development.
 *
 * Run `supabase/seeds/dev_control_plane.sql` once to seed the control-plane
 * tables so this works. See docs/architecture/deployment-cells/overview.md.
 *
 * Falls back with a warning to the legacy `tenants` table if the seed
 * has not been applied yet (e.g. a fresh checkout).
 *
 * @returns {Promise<TenantResolutionResult|null>}
 */
export async function resolveDevTenant() {
  console.log('[resolveTenant] Dev mode. Resolving via hostname: localhost');

  const preferredSlug = import.meta.env.VITE_DEV_TENANT_SLUG || 'primary';

  if (preferredSlug) {
    try {
      const { data: preferredTenant, error: preferredTenantError } = await supabase
        .from('tenants')
        .select('id, slug, name, status, subscription_tier')
        .eq('slug', preferredSlug)
        .is('deleted_at', null)
        .maybeSingle();

      if (!preferredTenantError && preferredTenant) {
        console.log('[resolveTenant] Dev override matched tenant slug:', preferredSlug);
        return {
          projectId: null,
          tenantId: preferredTenant.id,
          tenantCode: preferredTenant.slug,
          tenantStatus: preferredTenant.status ?? 'active',
          cellId: null,
          serviceProfile: preferredTenant.subscription_tier ?? null,
          domainId: null,
          hostname: 'localhost',
          domainKind: 'platform_subdomain',
          routeClass: RouteClass.PUBLIC,
          isPrimary: preferredTenant.slug === 'primary',
          name: preferredTenant.name,
          isLegacyResolution: true,
        };
      }
    } catch (preferredTenantErr) {
      console.warn('[resolveTenant] Dev override lookup failed:', preferredTenantErr);
    }
  }

  // Step 1: Try full control-plane resolution via localhost
  const rpcResult = await resolveTenantByHostname('localhost');
  if (rpcResult) {
    return rpcResult;
  }

  // Step 2: Seed not applied yet — warn and fall back to legacy tenants table
  console.warn(
    '[resolveTenant] ⚠️  localhost not found in tenant_domains. ' +
    'Run supabase/seeds/dev_control_plane.sql to enable full control-plane dev mode. ' +
    'Falling back to legacy tenants table.'
  );

  const slug = preferredSlug;

  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('id, slug, name, status, subscription_tier')
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      console.error('[resolveTenant] Dev legacy fallback error:', error.message);
      return null;
    }

    if (!data) {
      console.warn('[resolveTenant] Dev: no tenant found in legacy table for slug:', slug);
      return null;
    }

    return {
      projectId:          null,
      tenantId:           data.id,
      tenantCode:         data.slug,
      tenantStatus:       data.status ?? 'active',
      cellId:             null,
      serviceProfile:     data.subscription_tier ?? null,
      domainId:           null,
      hostname:           'localhost',
      domainKind:         'platform_subdomain',
      routeClass:         RouteClass.PUBLIC,
      isPrimary:          true,
      name:               data.name,
      isLegacyResolution: true,
    };
  } catch (err) {
    console.error('[resolveTenant] Dev legacy fallback unexpected error:', err);
    return null;
  }
}
