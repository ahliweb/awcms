/**
 * Supabase Client Configuration
 * AWCMS - Ahliweb Content Management System
 * 
 * SECURITY: Credentials are loaded from environment variables
 * Never commit actual API keys to version control!
 */

import { createClient } from '@supabase/supabase-js';

// Load from environment variables (Vite uses import.meta.env)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const LEGACY_AUTH_STORAGE_KEY = 'awcms-auth-token';

const getAuthStorageKey = () => {
    try {
        const hostname = new URL(supabaseUrl).hostname.replace(/[^a-zA-Z0-9_-]/g, '_');
        return `awcms-auth-token-${hostname}`;
    } catch {
        return LEGACY_AUTH_STORAGE_KEY;
    }
};

export const AUTH_STORAGE_KEY = getAuthStorageKey();

// Validate environment variables
if (!supabaseUrl || !supabasePublishableKey) {
    console.error(
        '❌ Missing Supabase environment variables!\n' +
        'Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set in your .env.local file.\n' +
        'See .env.example for reference.'
    );
}

if (typeof window !== 'undefined' && AUTH_STORAGE_KEY !== LEGACY_AUTH_STORAGE_KEY) {
    window.localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
}

// Tenant Configuration State
let tenantConfig = {
    id: null
};

/**
 * Update the tenant ID for upcoming requests
 * @param {string} tenantId 
 */
export const setGlobalTenantId = (tenantId) => {
    tenantConfig.id = tenantId;
    console.log('[SupabaseClient] Global Tenant ID set to:', tenantId);
};

// Custom Fetch Wrapper to inject headers
const customFetch = (url, options = {}) => {
    const headers = new Headers(options.headers || {});

    // Inject Tenant ID if available
    if (tenantConfig.id) {
        headers.set('x-tenant-id', tenantConfig.id);
    }

    return fetch(url, {
        ...options,
        headers
    });
};

// Create Supabase client with enhanced configuration
const customSupabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
        // Automatically refresh the token before expiry
        autoRefreshToken: true,
        // Persist session in localStorage
        persistSession: true,
        // Detect session from URL (for OAuth/magic link callbacks)
        detectSessionInUrl: true,
        // Custom storage key for AWCMS
        storageKey: AUTH_STORAGE_KEY,
    },
    global: {
        // Use our custom fetch to inject dynamic headers
        fetch: customFetch,
        headers: {
            'x-application-name': 'awcms',
        },
    },
    realtime: {
        params: {
            eventsPerSecond: 10,
        },
    },
});

// Route Supabase-style function calls to the Cloudflare Worker API.
const originalFunctions = customSupabaseClient.functions;
const edgeUrl = import.meta.env.VITE_EDGE_URL;
const workerApiTimeoutMs = Number.parseInt(import.meta.env.VITE_EDGE_API_TIMEOUT_MS || '', 10) || 8000;
console.log('[WorkerAPI] Initializing Cloudflare Worker API bridge. VITE_EDGE_URL:', edgeUrl);

const edgeFunctionsProxy = {
    ...originalFunctions,
    invoke: async (functionName, invokeOptions = {}) => {
        if (!edgeUrl) {
            const error = new Error(`Missing VITE_EDGE_URL for Worker API route: ${functionName}`);
            console.error('[WorkerAPI] Cloudflare Worker API is not configured.', error);
            return { data: null, error };
        }
        
        const url = `${edgeUrl}/functions/v1/${functionName}`;
        
        const headers = new Headers(invokeOptions.headers || {});
        
        try {
            const { data: { session } } = await customSupabaseClient.auth.getSession();
            if (session?.access_token) {
                headers.set('Authorization', `Bearer ${session.access_token}`);
            }
        } catch (_e) {
            // Ignore auth errors here
        }
        
        let body = invokeOptions.body;
        if (body !== undefined && typeof body !== 'string') {
            body = JSON.stringify(body);
            headers.set('Content-Type', 'application/json');
        }

        try {
            const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timeoutId = abortController
                ? window.setTimeout(() => abortController.abort(new Error(`Worker API timeout after ${workerApiTimeoutMs}ms`)), workerApiTimeoutMs)
                : null;

            const response = await customFetch(url, {
                method: invokeOptions.method || 'POST',
                headers: headers,
                body: body,
                signal: abortController?.signal,
            });

            if (timeoutId) {
                window.clearTimeout(timeoutId);
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
                 error = await response.json().catch(() => ({ message: response.statusText || `Edge HTTP Error: ${response.status}` }));
                  console.error(`[WorkerAPI] Error from Worker route ${functionName}:`, error);
             }

              return { data, error };
        } catch (error) {
            if (error?.name === 'AbortError') {
                console.error(`[WorkerAPI] Request timeout for ${functionName} after ${workerApiTimeoutMs}ms`);
            }
            console.error(`[WorkerAPI] Network/fetch error for ${functionName}:`, error);
            return { data: null, error };
        }
    }
};

Object.defineProperty(customSupabaseClient, 'functions', {
    get: () => edgeFunctionsProxy
});

export default customSupabaseClient;

export {
    customSupabaseClient,
    customSupabaseClient as supabase,
};
