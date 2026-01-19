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
  const url = env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || "";
  const key =
    env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "";

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
  _type: "id" | "slug" = "id",
): Promise<{ data: Record<string, unknown> | null; error: unknown }> => {
  // This function body was not provided in the instruction, returning a placeholder.
  // Please provide the actual implementation for getTenant if needed.
  // For now, it's returning a dummy value to satisfy the return type.
  return { data: null, error: "Function not implemented" };
};

export const createScopedClient = (
  headers: Record<string, string> = {},
  env: Record<string, unknown> = {},
) => {
  return createClientFromEnv(env as Record<string, string>, headers);
};
