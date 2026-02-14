import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Global instance removed to prevent startup crashes on Cloudflare
// where import.meta.env might not be fully populated at module-level.
// Use creatingClientFromEnv with runtime variables instead.
export const supabase = null;

// Helper to create client from Runtime Env (Cloudflare) or Build Env (Import Meta)
export const createClientFromEnv = (
  env: Record<string, string> = {},
  headers: Record<string, string> = {},
) => {
  // Try Runtime Env first, then fallback to Build Env
  const url =
    env.VITE_SUPABASE_URL ||
    env.PUBLIC_SUPABASE_URL ||
    import.meta.env.VITE_SUPABASE_URL ||
    import.meta.env.PUBLIC_SUPABASE_URL ||
    "";
  const key =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";

  if (!url || !key) {
    console.error("[Supabase] Missing URL or Key. Check Cloudflare Variables.");
    // Return null to indicate failure
    return null;
  }

  return createClient(url, key, {
    global: {
      headers: headers,
    },
  });
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
