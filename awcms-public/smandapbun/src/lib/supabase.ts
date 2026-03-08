import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createClientFromEnv as createSharedClientFromEnv } from '@awcms/shared/supabase';

// Avoid module-level crashes during static builds when PUBLIC_* env values
// are intentionally absent or injected only at runtime/CI.
export const supabase = createSharedClientFromEnv(createClient);

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
    client: SupabaseClient | null,
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
