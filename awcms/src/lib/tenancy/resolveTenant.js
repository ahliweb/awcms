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
import { deriveRouteClass } from '@/lib/tenancy/routeClass';

/**
 * @typedef {Object} TenantResolutionResult
 * @property {string} projectId
 * @property {string} tenantId
 * @property {string} tenantCode
 * @property {string} tenantStatus      - e.g. 'active', 'migrating', 'suspended'
 * @property {string} cellId
 * @property {string} serviceProfile    - e.g. 'shared_managed'
 * @property {string} domainId
 * @property {string} hostname          - normalized input hostname
 * @property {string} domainKind        - raw domain_kind from DB
 * @property {string} routeClass        - derived from domainKind via RouteClass enum
 * @property {boolean} isPrimary
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
    };
  } catch (err) {
    console.error('[resolveTenant] Unexpected error:', err);
    return null;
  }
}

/**
 * Dev-mode tenant resolver.
 * In development (localhost / 127.0.0.1), the hostname-based lookup is
 * replaced by a slug-keyed lookup so engineers can work without DNS.
 *
 * Falls back to `resolveTenantByHostname` using VITE_DEV_TENANT_SLUG
 * if the env var is set, otherwise uses 'primary'.
 *
 * @returns {Promise<TenantResolutionResult|null>}
 */
export async function resolveDevTenant() {
  const slug = import.meta.env.VITE_DEV_TENANT_SLUG || 'primary';
  console.log('[resolveTenant] Dev mode. Resolving via slug:', slug);
  return resolveTenantByHostname(slug);
}
