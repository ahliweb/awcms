/**
 * Internationalization (i18n) library for the public portal.
 * Fetches translations from content_translations table and provides translation utilities.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Translation {
  id: string;
  content_type: "page" | "blog" | "category" | "tag" | "menu";
  content_id: string;
  locale: string;
  title: string;
  slug: string;
  content?: string;
  excerpt?: string;
  meta_description?: string;
}

export interface LocaleConfig {
  code: string;
  name: string;
  flag?: string;
  rtl?: boolean;
  default?: boolean;
}

/**
 * Supported locales for the portal
 */
export const SUPPORTED_LOCALES: LocaleConfig[] = [
  { code: "en", name: "English", flag: "🇺🇸", default: true },
  { code: "id", name: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "ar", name: "العربية", flag: "🇸🇦", rtl: true },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "ja", name: "日本語", flag: "🇯🇵" },
];

/**
 * Get the default locale
 */
export function getDefaultLocale(): string {
  return SUPPORTED_LOCALES.find((l) => l.default)?.code || "en";
}

/**
 * Check if a locale is supported
 */
export function isValidLocale(locale: string): boolean {
  return SUPPORTED_LOCALES.some((l) => l.code === locale);
}

/**
 * Get locale config by code
 */
export function getLocaleConfig(locale: string): LocaleConfig | undefined {
  return SUPPORTED_LOCALES.find((l) => l.code === locale);
}

/**
 * Detect locale from request headers
 */
export function detectLocale(request: Request): string {
  const acceptLanguage = request.headers.get("accept-language");
  if (!acceptLanguage) return getDefaultLocale();

  const languages = acceptLanguage.split(",").map((lang) => {
    const [code] = lang.trim().split(";");
    return code.split("-")[0].toLowerCase();
  });

  for (const lang of languages) {
    if (isValidLocale(lang)) {
      return lang;
    }
  }

  return getDefaultLocale();
}

/**
 * Fetch translation for a specific content item
 */
export async function getTranslation(
  supabase: SupabaseClient,
  contentType: string,
  contentId: string,
  locale: string,
  tenantId?: string | null,
): Promise<Translation | null> {
  let query = supabase
    .from("content_translations")
    .select("*")
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .eq("locale", locale);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query.single();

  if (error) {
    // Not finding a translation is not an error
    if (error.code === "PGRST116") return null;
    console.error(`[i18n] Error fetching translation:`, error.message);
    return null;
  }

  return data as Translation;
}

/**
 * Fetch all translations for a content item (all locales)
 */
export async function getAllTranslations(
  supabase: SupabaseClient,
  contentType: string,
  contentId: string,
  tenantId?: string | null,
): Promise<Translation[]> {
  let query = supabase
    .from("content_translations")
    .select("*")
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .order("locale");

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`[i18n] Error fetching translations:`, error.message);
    return [];
  }

  return data as Translation[];
}

/**
 * Get available locales for a content item
 */
export async function getAvailableLocales(
  supabase: SupabaseClient,
  contentType: string,
  contentId: string,
  tenantId?: string | null,
): Promise<string[]> {
  const translations = await getAllTranslations(
    supabase,
    contentType,
    contentId,
    tenantId,
  );
  return translations.map((t) => t.locale);
}

/**
 * Build localized URL path
 */
export function getLocalizedPath(path: string, locale: string): string {
  const defaultLocale = getDefaultLocale();

  // Don't add locale prefix for default locale
  if (locale === defaultLocale) {
    return path;
  }

  // Add locale prefix
  return `/${locale}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Extract locale from URL path
 */
export function extractLocaleFromPath(path: string): {
  locale: string;
  cleanPath: string;
} {
  const segments = path.split("/").filter(Boolean);

  if (segments.length > 0 && isValidLocale(segments[0])) {
    return {
      locale: segments[0],
      cleanPath: "/" + segments.slice(1).join("/"),
    };
  }

  return {
    locale: getDefaultLocale(),
    cleanPath: path,
  };
}

/**
 * Simple translation function for static strings
 * Uses a key-value map loaded from translations
 */
type TranslationMap = Record<string, Record<string, string>>;

const staticTranslations: TranslationMap = {
  en: {
    "nav.home": "Home",
    "nav.about": "About",
    "nav.contact": "Contact",
    "nav.blog": "Blog",
    "footer.rights": "All rights reserved",
    "search.placeholder": "Search...",
    read_more: "Read more",
    "404.title": "Page not found",
    "404.message": "The page you are looking for does not exist.",
  },
  id: {
    "nav.home": "Beranda",
    "nav.about": "Tentang",
    "nav.contact": "Kontak",
    "nav.blog": "Blog",
    "footer.rights": "Hak cipta dilindungi",
    "search.placeholder": "Cari...",
    read_more: "Baca selengkapnya",
    "404.title": "Halaman tidak ditemukan",
    "404.message": "Halaman yang Anda cari tidak ada.",
  },
};

/**
 * Get translation for a static key
 */
export function t(key: string, locale: string = getDefaultLocale()): string {
  return staticTranslations[locale]?.[key] || staticTranslations.en[key] || key;
}
