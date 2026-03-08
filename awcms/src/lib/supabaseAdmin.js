/**
 * supabaseAdmin.js
 * 
 * Admin Supabase client that bypasses RLS using the secret key.
 * 
 * ⚠️ SECURITY WARNING:
 * This client should ONLY be used in:
 * - Edge Functions (server-side)
 * - Backend scripts
 * - Admin-only operations that require bypassing RLS
 * 
 * NEVER expose the secret key to the browser.
 * For client-side operations, use `customSupabaseClient.js` instead.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (typeof process !== 'undefined' ? process.env.SUPABASE_URL : undefined);
const supabaseSecretKey = typeof process !== 'undefined' ? process.env.SUPABASE_SECRET_KEY : undefined;

if (!supabaseUrl || !supabaseSecretKey) {
    console.warn('[supabaseAdmin] Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY. Admin client will not function.');
}

/**
 * Supabase Admin Client
 * 
 * Uses the secret key to bypass Row Level Security (RLS).
 * Use with caution - this client has full database access.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

/**
 * Helper to check if admin client is properly configured
 */
export function isAdminConfigured() {
    return Boolean(supabaseUrl && supabaseSecretKey);
}

export default supabaseAdmin;
