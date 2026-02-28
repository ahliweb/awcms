/**
 * Shared Supabase env resolution for AWCMS public portals.
 *
 * This module intentionally avoids importing `@supabase/supabase-js` so
 * consumers can provide their own local `createClient` implementation.
 */

export interface SupabaseCredentials {
    url: string;
    key: string;
}

type ClientFactory<TClient> = (
    url: string,
    key: string,
    options?: { global?: { headers?: Record<string, string> } },
) => TClient;

/**
 * Resolve Supabase credentials from runtime or build-time env vars.
 */
export function resolveSupabaseCredentials(
    env: Record<string, string> = {},
): SupabaseCredentials | null {
    const url =
        env.PUBLIC_SUPABASE_URL ||
        env.VITE_SUPABASE_URL ||
        (typeof import.meta !== 'undefined' ? import.meta.env?.PUBLIC_SUPABASE_URL : '') ||
        (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : '') ||
        '';

    const key =
        env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        (typeof import.meta !== 'undefined' ? import.meta.env?.PUBLIC_SUPABASE_PUBLISHABLE_KEY : '') ||
        (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY : '') ||
        '';

    if (!url || !key) {
        return null;
    }

    return { url, key };
}

/**
 * Create a Supabase client using a consumer-provided factory.
 */
export function createClientFromEnv<TClient>(
    createClient: ClientFactory<TClient>,
    env: Record<string, string> = {},
    headers: Record<string, string> = {},
): TClient | null {
    const credentials = resolveSupabaseCredentials(env);

    if (!credentials) {
        console.error('[AWCMS Shared] Missing Supabase URL or Key.');
        return null;
    }

    return createClient(credentials.url, credentials.key, {
        global: {
            headers: { ...headers },
        },
    });
}

/**
 * Create a tenant-scoped client using a consumer-provided factory.
 */
export function createTenantClient<TClient>(
    createClient: ClientFactory<TClient>,
    tenantId: string,
    env: Record<string, string> = {},
): TClient | null {
    return createClientFromEnv(createClient, env, { 'x-tenant-id': tenantId });
}
