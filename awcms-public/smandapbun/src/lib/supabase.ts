import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClientFromEnv as createSharedClientFromEnv } from '@awcms/shared/supabase';

const supabaseUrl =
    import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
    import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
    console.error('Missing Supabase URL or Publishable Key. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

export const createClientFromEnv = (
    env: Record<string, string> = {},
    headers: Record<string, string> = {},
) => {
    return createSharedClientFromEnv(createClient, env, headers);
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
