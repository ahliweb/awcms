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

// Validate environment variables
if (!supabaseUrl || !supabasePublishableKey) {
    console.error(
        '❌ Missing Supabase environment variables!\n' +
        'Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are set in your .env.local file.\n' +
        'See .env.example for reference.'
    );
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
        storageKey: 'awcms-auth-token',
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

export default customSupabaseClient;

export {
    customSupabaseClient,
    customSupabaseClient as supabase,
};
