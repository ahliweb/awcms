/**
 * supabaseAdmin.js
 * 
 * Admin Supabase client that bypasses RLS using the service role key.
 * 
 * ⚠️ SECURITY WARNING:
 * This client should ONLY be used in:
 * - Edge Functions (server-side)
 * - Backend scripts
 * - Admin-only operations that require bypassing RLS
 * 
 * NEVER expose the service role key to the browser.
 * For client-side operations, use `customSupabaseClient.js` instead.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.warn('[supabaseAdmin] Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY. Admin client will not function.');
}

/**
 * Supabase Admin Client
 * 
 * Uses the service role key to bypass Row Level Security (RLS).
 * Use with caution - this client has full database access.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

/**
 * Helper to check if admin client is properly configured
 */
export function isAdminConfigured() {
    return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

export default supabaseAdmin;
