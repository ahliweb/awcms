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

    const client = createClient(credentials.url, credentials.key, {
        global: {
            headers: { ...headers },
        },
    });

    const edgeUrl =
        env.PUBLIC_EDGE_URL ||
        env.VITE_EDGE_URL ||
        (typeof import.meta !== 'undefined' ? (import.meta as any).env?.PUBLIC_EDGE_URL : '') ||
        (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_EDGE_URL : '') ||
        '';
    const workerApiTimeoutMs = Number.parseInt(
        String(
            env.PUBLIC_EDGE_API_TIMEOUT_MS ||
            env.VITE_EDGE_API_TIMEOUT_MS ||
            (typeof import.meta !== 'undefined' ? (import.meta as any).env?.PUBLIC_EDGE_API_TIMEOUT_MS : '') ||
            (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_EDGE_API_TIMEOUT_MS : '') ||
            '',
        ),
        10,
    ) || 8000;

    if ((client as any).functions) {
        const originalFunctions = (client as any).functions;
        
        const edgeFunctionsProxy = {
            ...originalFunctions,
            invoke: async (functionName: string, invokeOptions: any = {}) => {
                if (!edgeUrl) {
                    return {
                        data: null,
                        error: new Error(`Missing Worker API URL for route: ${functionName}`),
                    };
                }

                const url = `${edgeUrl}/functions/v1/${functionName}`;
                const reqHeaders = new Headers(invokeOptions.headers || {});
                
                Object.entries(headers).forEach(([k, v]) => reqHeaders.set(k, v));
                
                try {
                    const { data: { session } } = await (client as any).auth.getSession();
                    if (session?.access_token) {
                        reqHeaders.set('Authorization', `Bearer ${session.access_token}`);
                    }
                } catch (e) {
                    // Ignore auth errors here
                }
                
                let body = invokeOptions.body;
                if (body !== undefined && typeof body !== 'string') {
                    body = JSON.stringify(body);
                    reqHeaders.set('Content-Type', 'application/json');
                }
            
                try {
                    const fetchFn = (client as any).functions.fetch || (typeof fetch !== 'undefined' ? fetch : null);
                    if (!fetchFn) {
                        return {
                            data: null,
                            error: new Error(`Missing fetch implementation for Worker API route: ${functionName}`),
                        };
                    }

                    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timeoutId = abortController
                        ? globalThis.setTimeout(() => abortController.abort(new Error(`Worker API timeout after ${workerApiTimeoutMs}ms`)), workerApiTimeoutMs)
                        : null;
                     
                    const response = await fetchFn(url, {
                        method: invokeOptions.method || 'POST',
                        headers: reqHeaders,
                        body: body,
                        signal: abortController?.signal,
                    });

                    if (timeoutId) {
                        globalThis.clearTimeout(timeoutId);
                    }
                     
                    const isRelayError = response.headers.get('x-relay-error') === 'true';
                    if (isRelayError) {
                         throw new Error(await response.text());
                    }
            
                    let responseType = invokeOptions.responseType || 'json';
                    let data;
                    let error = null;
            
                    if (response.ok) {
                         if (responseType === 'json') {
                              const contentType = response.headers.get('content-type');
                              if (contentType && contentType.includes('application/json')) {
                                   data = await response.json();
                              } else {
                                   data = await response.text();
                              }
                         } else if (responseType === 'arrayBuffer') {
                              data = await response.arrayBuffer();
                         } else if (responseType === 'blob') {
                              data = await response.blob();
                         } else {
                              data = await response.text();
                         }
                    } else {
                         error = await response.json().catch(() => ({ message: response.statusText }));
                    }
            
                    return { data, error };
                } catch (error) {
                    return { data: null, error };
                }
            }
        };

        Object.defineProperty(client, 'functions', {
            get: () => edgeFunctionsProxy
        });
    }

    return client;
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
