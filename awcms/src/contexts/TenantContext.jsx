
import React, { createContext, useContext, useState, useEffect } from 'react';
import { setGlobalTenantId } from '@/lib/customSupabaseClient';
import { resolveTenantByHostname, resolveDevTenant } from '@/lib/tenancy/resolveTenant';

const TenantContext = createContext(undefined);

/**
 * TenantProvider
 *
 * Resolves the current tenant from the hostname using the deployment-cell
 * resolution contract (spec §10). Exposes the full TenantResolutionResult
 * including cellId, routeClass, and serviceProfile — not just tenant ID.
 *
 * Failure policy:
 *   - null resolution → show "Tenant Not Found" error page
 *   - suspended tenant → show "Suspended" page
 *   - other error      → show generic error
 */
export const TenantProvider = ({ children }) => {
    const [currentTenant, setCurrentTenant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [errorKind, setErrorKind] = useState(null); // 'not_found' | 'suspended' | 'maintenance' | 'error'

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
                    setError('Tenant not found for this domain.');
                    setErrorKind('not_found');
                    return;
                }

                if (result.tenantStatus === 'suspended') {
                    setError('This account has been suspended.');
                    setErrorKind('suspended');
                    return;
                }

                if (result.tenantStatus !== 'active' && result.tenantStatus !== 'migrating') {
                    setError(`Tenant is not available (status: ${result.tenantStatus}).`);
                    setErrorKind('not_found');
                    return;
                }

                console.log(
                    '[TenantContext] Resolved:',
                    result.tenantCode,
                    '| profile:', result.serviceProfile,
                    '| routeClass:', result.routeClass,
                    '| cell:', result.cellId
                );

                // Set global tenant ID so Supabase RLS headers are correct
                setGlobalTenantId(result.tenantId);
                setCurrentTenant(result);

            } catch (err) {
                console.error('[TenantContext] Resolution error:', err);
                if (mounted) {
                    setError(err.message || 'Unexpected tenant resolution error.');
                    setErrorKind('error');
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        resolve();
        return () => { mounted = false; };
    }, []);

    const value = React.useMemo(
        () => ({ currentTenant, loading, error, errorKind }),
        [currentTenant, loading, error, errorKind]
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-2">
                <h1 className="text-2xl font-bold">
                    {errorKind === 'suspended' ? 'Account Suspended' : 'Tenant Not Found'}
                </h1>
                <p className="text-muted-foreground">
                    {errorKind === 'suspended'
                        ? 'This account has been suspended. Please contact support.'
                        : 'The requested domain is not configured or is no longer active.'}
                </p>
                {import.meta.env.DEV && (
                    <pre className="mt-4 p-2 bg-muted rounded text-xs max-w-md overflow-auto">{error}</pre>
                )}
            </div>
        );
    }

    return (
        <TenantContext.Provider value={value}>
            {children}
        </TenantContext.Provider>
    );
};

/**
 * useTenant()
 *
 * Returns the resolved TenantResolutionResult plus loading/error state.
 * currentTenant includes: projectId, tenantId, tenantCode, cellId,
 * serviceProfile, routeClass, domainId, hostname, isPrimary.
 */
export const useTenant = () => {
    const context = useContext(TenantContext);
    if (context === undefined) {
        throw new Error('useTenant must be used within a TenantProvider');
    }
    return context;
};
