import { createClientFromEnv } from "~/lib/supabase";
import { getPublicTenantId } from "~/lib/publicTenant";

export type PublicSettings = {
  seo?: Record<string, unknown>;
  siteInfo?: Record<string, unknown>;
  analyticsConsent?: Record<string, unknown>;
  branding?: Record<string, unknown>;
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

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const buildSettings = (
  settingsMap: Record<string, unknown>,
  tenantRecord?: Record<string, unknown> | null,
  seoRecord?: Record<string, unknown> | null,
): PublicSettings => {
  const tenantConfig = asRecord(tenantRecord?.config);
  const tenantTheme = asRecord(tenantConfig?.theme);
  const tenantSettings = asRecord(tenantConfig?.settings);
  const siteInfoSetting = asRecord(parseSetting(settingsMap.site_info));
  const seoSetting = asRecord(parseSetting(settingsMap.seo_global));
  const analyticsConsent = asRecord(
    parseSetting(settingsMap.analytics_consent),
  );
  const seoSiteRecord = asRecord(seoRecord);

  const siteInfo = {
    ...(tenantSettings || {}),
    ...(siteInfoSetting || {}),
    name:
      (siteInfoSetting?.name as string | undefined) ||
      (siteInfoSetting?.site_name as string | undefined) ||
      (tenantSettings?.siteName as string | undefined) ||
      (tenantSettings?.site_name as string | undefined) ||
      (tenantRecord?.name as string | undefined),
    site_name:
      (siteInfoSetting?.site_name as string | undefined) ||
      (siteInfoSetting?.name as string | undefined) ||
      (tenantSettings?.siteName as string | undefined) ||
      (tenantSettings?.site_name as string | undefined) ||
      (tenantRecord?.name as string | undefined),
    tagline:
      (siteInfoSetting?.tagline as string | undefined) ||
      (siteInfoSetting?.site_tagline as string | undefined) ||
      (tenantSettings?.siteTagline as string | undefined) ||
      (tenantSettings?.site_tagline as string | undefined),
  };

  const seo = {
    ...(seoSetting || {}),
    ...(seoSiteRecord || {}),
    site_title:
      (seoSiteRecord?.meta_title as string | undefined) ||
      (seoSetting?.site_title as string | undefined) ||
      (siteInfo.site_name as string | undefined),
    site_description:
      (seoSiteRecord?.meta_description as string | undefined) ||
      (seoSetting?.site_description as string | undefined) ||
      (siteInfo.tagline as string | undefined),
    default_keywords:
      (seoSiteRecord?.meta_keywords as string | undefined) ||
      (seoSetting?.default_keywords as string | undefined),
    og_image:
      (seoSiteRecord?.og_image as string | undefined) ||
      (seoSetting?.og_image as string | undefined) ||
      (tenantTheme?.logoUrl as string | undefined),
    canonical_url:
      (seoSiteRecord?.canonical_url as string | undefined) ||
      (seoSetting?.canonical_url as string | undefined) ||
      (tenantRecord?.domain as string | undefined),
    robots:
      (seoSiteRecord?.robots as string | undefined) ||
      (seoSetting?.robots as string | undefined),
  };

  return {
    seo,
    siteInfo,
    analyticsConsent,
    branding: tenantTheme,
  };
};

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
    const [{ data, error }, { data: tenantRecord }, { data: seoRecord }] =
      await Promise.all([
        supabase
          .from("settings")
          .select("key, value")
          .eq("tenant_id", tenantId)
          .in("key", ["seo_global", "site_info", "analytics_consent"]),
        supabase
          .from("tenants")
          .select("id, name, domain, config")
          .eq("id", tenantId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("seo_metadata")
          .select(
            "meta_title, meta_description, meta_keywords, og_image, canonical_url, robots",
          )
          .eq("tenant_id", tenantId)
          .eq("resource_type", "site")
          .is("resource_id", null)
          .maybeSingle(),
      ]);

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

    return buildSettings(
      settingsMap,
      (tenantRecord as Record<string, unknown> | null) || null,
      (seoRecord as Record<string, unknown> | null) || null,
    );
  })();

  cachedSettings = await settingsPromise;
  settingsPromise = null;
  return cachedSettings;
};
