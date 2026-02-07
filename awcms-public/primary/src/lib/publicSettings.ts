import { createClientFromEnv } from "~/lib/supabase";
import { getPublicTenantId } from "~/lib/publicTenant";

export type PublicSettings = {
  seo?: Record<string, unknown>;
  siteInfo?: Record<string, unknown>;
  analyticsConsent?: Record<string, unknown>;
};

let cachedSettings: PublicSettings | null = null;
let cachedTenantId: string | null = null;
let settingsPromise: Promise<PublicSettings> | null = null;

const parseSetting = (value: unknown) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn("[Settings] Failed to parse settings JSON:", error);
      return null;
    }
  }
  return value;
};

const buildSettings = (
  settingsMap: Record<string, unknown>,
): PublicSettings => ({
  seo: (parseSetting(settingsMap.seo_global) || undefined) as
    | Record<string, unknown>
    | undefined,
  siteInfo: (parseSetting(settingsMap.site_info) || undefined) as
    | Record<string, unknown>
    | undefined,
  analyticsConsent: (parseSetting(settingsMap.analytics_consent) || undefined) as
    | Record<string, unknown>
    | undefined,
});

export const getPublicSettings = async (): Promise<PublicSettings> => {
  const tenantId = getPublicTenantId();
  if (!tenantId) {
    return {};
  }

  if (cachedSettings && cachedTenantId === tenantId) {
    return cachedSettings;
  }

  if (settingsPromise && cachedTenantId === tenantId) {
    return settingsPromise;
  }

  const supabase = createClientFromEnv(import.meta.env);
  if (!supabase) {
    return {};
  }

  cachedTenantId = tenantId;
  settingsPromise = (async () => {
    const { data, error } = await supabase
      .from("settings")
      .select("key, value")
      .eq("tenant_id", tenantId)
      .in("key", ["seo_global", "site_info", "analytics_consent"]);

    if (error) {
      console.error("[Settings] Error fetching settings:", error.message);
      return {};
    }

    const settingsMap = (data || []).reduce(
      (acc: Record<string, unknown>, row) => {
        acc[row.key] = row.value;
        return acc;
      },
      {},
    );

    return buildSettings(settingsMap);
  })();

  cachedSettings = await settingsPromise;
  settingsPromise = null;
  return cachedSettings;
};
