
import { useState, useEffect } from 'react';
import { resolveTenantByHostname, resolveDevTenant } from '@/lib/tenancy/resolveTenant';

/**
 * usePublicTenant
 *
 * Resolves the current tenant for public-facing Astro island components
 * and any public portal React components that don't use TenantContext.
 *
 * This hook uses the same canonical resolver as TenantContext (spec §10),
 * so all public routes benefit from the deployment-cell resolution contract:
 *   - hostname → tenant_domains → tenants_control → deployment_cells
 *   - Returns routeClass, cellId, serviceProfile alongside tenant identity
 *
 * If you are already inside a TenantProvider, prefer useTenant() instead
 * to avoid duplicate DB calls.
 *
 * @returns {{ tenant: TenantResolutionResult|null, loading: boolean, error: string|null }}
 */
export function usePublicTenant() {
    const [tenant, setTenant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let mounted = true;

        const resolve = async () => {
            try {
                const hostname = window.location.hostname;
                const isDev = hostname === 'localhost' || hostname === '127.0.0.1';

                const result = isDev
                    ? await resolveDevTenant()
                    : await resolveTenantByHostname(hostname);

                if (!mounted) return;

                if (!result) {
                    setError('Public tenant not found for this domain.');
                    return;
                }

                setTenant(result);

            } catch (err) {
                console.error('[usePublicTenant] Resolution error:', err);
                if (mounted) setError(err.message || 'Unexpected error resolving public tenant.');
            } finally {
                if (mounted) setLoading(false);
            }
        };

        resolve();
        return () => { mounted = false; };
    }, []);

    return { tenant, loading, error };
}
