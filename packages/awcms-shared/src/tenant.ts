/**
 * Shared tenant resolution logic for AWCMS public portals.
 *
 * Both portals resolve the tenant ID from env vars at build time.
 * This module centralizes that logic.
 */

/**
 * Resolve the tenant ID from env vars.
 *
 * Supports an explicit override (e.g. from URL params) and
 * falls back to build-time env vars.
 */
export function getTenantId(overrideTenantId?: string | null): string | null {
    if (overrideTenantId) return overrideTenantId;

    const envTenantId =
        (typeof import.meta !== 'undefined' ? import.meta.env?.PUBLIC_TENANT_ID : '') ||
        (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_PUBLIC_TENANT_ID : '') ||
        (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_TENANT_ID : '') ||
        '';

    return envTenantId || null;
}
