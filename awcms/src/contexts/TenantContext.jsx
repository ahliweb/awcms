
import React, { createContext, useContext, useState, useEffect } from 'react';
import { setGlobalTenantId } from '@/lib/customSupabaseClient';
import { supabase } from '@/lib/customSupabaseClient';
import { resolveTenantByHostname, resolveDevTenant } from '@/lib/tenancy/resolveTenant';
import {
    clearStoredPlatformTenantScope,
    getStoredPlatformTenantScope,
    setStoredPlatformTenantScope,
} from '@/lib/tenancy/platformTenantScope';

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
    const [resolvedTenant, setResolvedTenant] = useState(null);
    const [currentTenant, setCurrentTenant] = useState(null);
    const [platformTenantScopeId, setPlatformTenantScopeId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [errorKind, setErrorKind] = useState(null); // 'not_found' | 'suspended' | 'maintenance' | 'error'

    const hydrateTenantContext = React.useCallback(async (tenantResolution) => {
        if (!tenantResolution?.tenantId) {
            return tenantResolution;
        }

        try {
            const { data } = await supabase
                .from('tenants')
                .select('id, slug, name, status, subscription_tier, domain, locale')
                .eq('id', tenantResolution.tenantId)
                .is('deleted_at', null)
                .maybeSingle();

            return {
                ...tenantResolution,
                id: tenantResolution.tenantId,
                slug: tenantResolution.tenantCode,
                status: tenantResolution.tenantStatus,
                subscription_tier: data?.subscription_tier ?? tenantResolution.serviceProfile ?? null,
                domain: data?.domain ?? null,
                locale: data?.locale ?? 'en',
                name: data?.name ?? tenantResolution.name,
            };
        } catch (tenantErr) {
            console.warn('[TenantContext] Failed to hydrate tenant record:', tenantErr);
            return {
                ...tenantResolution,
                id: tenantResolution.tenantId,
                slug: tenantResolution.tenantCode,
                status: tenantResolution.tenantStatus,
                subscription_tier: tenantResolution.serviceProfile ?? null,
            };
        }
    }, []);

    const applyTenantScope = React.useCallback(async (baseTenant, overrideTenantId = null) => {
        const nextTenantId = overrideTenantId || baseTenant?.tenantId || null;
        if (!nextTenantId) {
            setGlobalTenantId(null);
            setCurrentTenant(baseTenant);
            return;
        }

        if (overrideTenantId && overrideTenantId !== baseTenant?.tenantId) {
            const { data: overrideTenant } = await supabase
                .from('tenants')
                .select('id, slug, name, status, subscription_tier, domain, locale')
                .eq('id', overrideTenantId)
                .is('deleted_at', null)
                .maybeSingle();

            if (overrideTenant) {
                setGlobalTenantId(overrideTenant.id);
                setCurrentTenant({
                    ...baseTenant,
                    ...overrideTenant,
                    tenantId: overrideTenant.id,
                    tenantCode: overrideTenant.slug,
                    tenantStatus: overrideTenant.status,
                    serviceProfile: overrideTenant.subscription_tier,
                    isScopedOverride: true,
                });
                return;
            }
        }

        setGlobalTenantId(baseTenant.tenantId);
        setCurrentTenant({
            ...baseTenant,
            isScopedOverride: false,
        });
    }, []);

    const switchTenantScope = React.useCallback(async (tenantId) => {
        if (!resolvedTenant) return;

        if (!tenantId || tenantId === resolvedTenant.tenantId) {
            clearStoredPlatformTenantScope();
            setPlatformTenantScopeId(null);
            await applyTenantScope(resolvedTenant, null);
            return;
        }

        setStoredPlatformTenantScope(tenantId);
        setPlatformTenantScopeId(tenantId);
        await applyTenantScope(resolvedTenant, tenantId);
    }, [applyTenantScope, resolvedTenant]);

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

                // Legacy dev fallback: control-plane tables empty, resolved via old tenants table
                if (result.isLegacyResolution) {
                    console.warn(
                        '[TenantContext] ⚠️  Using legacy tenants table fallback (dev mode). ' +
                        'Seed tenants_control + tenant_domains to use the full resolution contract.'
                    );
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

                const hydratedTenant = await hydrateTenantContext(result);
                if (!mounted) return;

                setResolvedTenant(hydratedTenant);

                const storedTenantScope = getStoredPlatformTenantScope();
                setPlatformTenantScopeId(storedTenantScope || null);
                await applyTenantScope(hydratedTenant, storedTenantScope);

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
    }, [applyTenantScope, hydrateTenantContext]);

    const value = React.useMemo(
        () => ({
            currentTenant,
            resolvedTenant,
            platformTenantScopeId,
            switchTenantScope,
            loading,
            error,
            errorKind,
        }),
        [currentTenant, error, errorKind, loading, platformTenantScopeId, resolvedTenant, switchTenantScope]
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
