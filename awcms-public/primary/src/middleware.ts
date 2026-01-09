import { defineMiddleware } from "astro/middleware";
import { createClientFromEnv } from "./lib/supabase";
import { extractTenantFromPath, extractPathAfterTenant } from "./lib/url";

/**
 * AWCMS Public Middleware
 * 
 * Resolves tenant context from:
 * 1. Path parameter (PRIMARY - e.g., /primary/articles)
 * 2. Host/subdomain (FALLBACK - for legacy compatibility)
 */
export const onRequest = defineMiddleware(async (context, next) => {
    const { request, locals, url } = context;
    const pathname = url.pathname;

    try {
        // 1. Extract tenant from path
        const tenantSlugFromPath = extractTenantFromPath(pathname);

        // 2. Get Runtime Env for Cloudflare
        const runtimeEnv = context.locals.runtime?.env || {};

        // 3. Create request-scoped Supabase client
        const SafeSupabase = createClientFromEnv(runtimeEnv);

        if (!SafeSupabase) {
            console.error('[Middleware] Failed to initialize Supabase client. Missing env vars.');
            return new Response('Service Unavailable: Invalid Configuration', { status: 503 });
        }

        // 4. Resolve tenant
        let tenantId: string | null = null;
        let tenantSlug: string | null = null;

        if (tenantSlugFromPath) {
            // Path-based resolution (PRIMARY)
            console.log('[Middleware] Resolving tenant from path:', tenantSlugFromPath);

            const { data, error } = await SafeSupabase
                .from('tenants')
                .select('id, slug')
                .eq('slug', tenantSlugFromPath)
                .maybeSingle();

            if (data) {
                tenantId = data.id;
                tenantSlug = data.slug;
                console.log('[Middleware] Tenant resolved from path:', tenantSlug, tenantId);
            } else if (error) {
                console.warn('[Middleware] Tenant lookup error:', error.message);
            }
        }

        // 5. Fallback to host-based resolution
        if (!tenantId) {
            let host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
            if (host.includes(":")) {
                host = host.split(":")[0];
            }

            // Dev override
            if (import.meta.env.DEV && import.meta.env.VITE_DEV_TENANT_HOST) {
                host = import.meta.env.VITE_DEV_TENANT_HOST;
            }

            console.log('[Middleware] Falling back to host resolution:', host);

            const { data: hostTenantId, error: hostError } = await SafeSupabase
                .rpc('get_tenant_id_by_host', { lookup_host: host });

            if (hostTenantId) {
                tenantId = hostTenantId as string;

                // Get tenant slug
                const { data: tenantData } = await SafeSupabase
                    .from('tenants')
                    .select('slug')
                    .eq('id', tenantId)
                    .single();

                if (tenantData) {
                    tenantSlug = tenantData.slug;
                    // Serve content directly from host without path prefix redirect
                    console.log('[Middleware] Tenant resolved from host:', tenantSlug, tenantId);
                }
            } else if (hostError) {
                console.warn('[Middleware] Host lookup error:', hostError.message);
            }
        }

        // 6. Handle unresolved tenant
        if (!tenantId || !tenantSlug) {
            console.warn(`[Middleware] Tenant not found. Path: ${tenantSlugFromPath}, Pathname: ${pathname}`);

            // For static assets and internal paths, let them through
            if (pathname.startsWith('/_') || pathname.startsWith('/favicon')) {
                return next();
            }

            // Fallback to 'primary' for known channel domains
            let host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
            if (host.includes(":")) host = host.split(":")[0];

            if (host === 'ahliweb.com' || host.endsWith('.ahliweb.com') || host === 'localhost' || host.includes('localhost:')) {
                console.log('[Middleware] Fallback to primary tenant for host:', host);
                // Set primary tenant context directly (no redirect)
                tenantSlug = 'primary';
                const { data: primaryTenant } = await SafeSupabase
                    .from('tenants')
                    .select('id')
                    .eq('slug', 'primary')
                    .single();
                if (primaryTenant) {
                    tenantId = primaryTenant.id;
                } else {
                    return new Response('Primary tenant not configured', { status: 500 });
                }
            } else {
                return new Response('Tenant Not Found', { status: 404 });
            }
        }

        // 7. Set context for downstream components
        locals.tenant_id = tenantId!;
        locals.tenant_slug = tenantSlug!;
        locals.host = request.headers.get("host") || "";

        return next();
    } catch (e: any) {
        console.error('[Middleware] CRITICAL ERROR:', e);
        return new Response(`Critical Middleware Error: ${e.message}`, { status: 500 });
    }
});
