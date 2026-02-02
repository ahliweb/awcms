
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl =
    import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase URL or Anon Key. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const createClientFromEnv = (
    env: Record<string, string> = {},
    headers: Record<string, string> = {},
) => {
    const url =
        env.PUBLIC_SUPABASE_URL ||
        env.VITE_SUPABASE_URL ||
        import.meta.env.PUBLIC_SUPABASE_URL ||
        import.meta.env.VITE_SUPABASE_URL ||
        '';
    const key =
        env.PUBLIC_SUPABASE_ANON_KEY ||
        env.VITE_SUPABASE_ANON_KEY ||
        import.meta.env.PUBLIC_SUPABASE_ANON_KEY ||
        import.meta.env.VITE_SUPABASE_ANON_KEY ||
        '';

    if (!url || !key) {
        console.error('[Supabase] Missing URL or Key. Check environment variables.');
        return null;
    }

    return createClient(url, key, {
        global: {
            headers,
        },
    });
};

export const createScopedClient = (
    headers: Record<string, string> = {},
    env: Record<string, unknown> = {},
) => createClientFromEnv(env as Record<string, string>, headers);

export const getTenant = async (
    client: SupabaseClient,
    tenantIdOrSlug: string,
    type: 'id' | 'slug' = 'id',
) => {
    if (!client) {
        return { data: null, error: new Error('No Supabase client provided') };
    }

    const { data, error } = await client
        .from('tenants')
        .select('*')
        .eq(type, tenantIdOrSlug)
        .maybeSingle();

    return { data, error };
};
