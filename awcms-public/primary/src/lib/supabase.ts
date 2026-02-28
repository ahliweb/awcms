import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClientFromEnv as createSharedClientFromEnv } from "@awcms/shared/supabase";

// Global instance removed to prevent startup crashes on Cloudflare
// where import.meta.env might not be fully populated at module-level.
// Use creatingClientFromEnv with runtime variables instead.
export const supabase = null;

// Helper to create client from Runtime Env (Cloudflare) or Build Env (Import Meta)
export const createClientFromEnv = (
  env: Record<string, string> = {},
  headers: Record<string, string> = {},
) => {
  return createSharedClientFromEnv(createClient, env, headers);
};

export const getTenant = async (
  supabase: SupabaseClient,
  tenantIdOrSlug: string,
  type: "id" | "slug" = "id",
): Promise<{ data: Record<string, unknown> | null; error: unknown }> => {
  if (!supabase) {
    return { data: null, error: new Error("No Supabase client provided") };
  }

  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq(type, tenantIdOrSlug)
    .maybeSingle();

  return { data, error };
};

export const createScopedClient = (
  headers: Record<string, string> = {},
  env: Record<string, unknown> = {},
) => {
  return createClientFromEnv(env as Record<string, string>, headers);
};
