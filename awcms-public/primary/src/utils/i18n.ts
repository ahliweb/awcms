/**
 * AWCMS Public Portal - Internationalization Utility
 *
 * Provides translation functions for Astro components.
 * Supports English (primary) and Indonesian languages.
 */

import en from "../locales/en.json";
import id from "../locales/id.json";

export type Locale = "en" | "id";

const translations: Record<Locale, typeof en> = {
  en,
  id,
};

// Default locale
export const defaultLocale: Locale = "en";
export const supportedLocales: Locale[] = ["en", "id"];

/**
 * Get the current locale from various sources
 */
export function getLocale(request?: Request): Locale {
  // 1. Check URL Path (First priority for static/rewritten paths)
  if (request) {
    try {
      const url = new URL(request.url);

      // Check specific path prefix
      const match = url.pathname.match(/^\/(id|en)(\/|$)/);
      if (match && supportedLocales.includes(match[1] as Locale)) {
        return match[1] as Locale;
      }

      // Check URL parameter
      const langParam = url.searchParams.get("lang");
      if (langParam && supportedLocales.includes(langParam as Locale)) {
        return langParam as Locale;
      }
    } catch {
      // Ignore URL parsing errors
    }
  }

  // 2. Check cookie (for SSR only - headers might not be available in SSG)
  if (request) {
    try {
      // Check if headers are available (avoid SSG errors)
      if (request.headers && typeof request.headers.get === "function") {
        const cookies = request.headers.get("cookie") || "";
        const match = cookies.match(/lang=(\w+)/);
        if (match && supportedLocales.includes(match[1] as Locale)) {
          return match[1] as Locale;
        }
      }
    } catch {
      // Ignore header access errors
    }
  }

  // 3. Check Accept-Language header
  if (request) {
    try {
      if (request.headers && typeof request.headers.get === "function") {
        const acceptLang = request.headers.get("accept-language") || "";
        if (acceptLang.startsWith("id")) {
          return "id";
        }
      }
    } catch {
      // Ignore header access errors
    }
  }

  // 4. Default to English
  return defaultLocale;
}

/**
 * Get a nested translation value by key path
 * Example: t('nav.home') returns 'Home'
 */
export function t(key: string, locale: Locale = defaultLocale): string {
  const keys = key.split(".");
  let value: unknown = translations[locale];

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      // Fallback to English if key not found
      value = translations[defaultLocale];
      for (const fallbackKey of keys) {
        if (value && typeof value === "object" && fallbackKey in value) {
          value = (value as Record<string, unknown>)[fallbackKey];
        } else {
          return key; // Return key if not found anywhere
        }
      }
      break;
    }
  }

  return typeof value === "string" ? value : key;
}

/**
 * Create a translator function bound to a specific locale
 */
export function createTranslator(locale: Locale) {
  return (key: string) => t(key, locale);
}

/**
 * Get all translations for a namespace
 * Example: getNamespace('nav') returns { home: 'Home', about: 'About', ... }
 */
export function getNamespace(
  namespace: string,
  locale: Locale = defaultLocale,
): Record<string, unknown> {
  const trans = translations[locale] as Record<string, unknown>;
  return (trans[namespace] as Record<string, unknown>) || {};
}

/**
 * Locale display names for UI
 */
export const localeNames: Record<Locale, string> = {
  en: "English",
  id: "Bahasa Indonesia",
};

/**
 * Locale flags for UI
 */
export const localeFlags: Record<Locale, string> = {
  en: "🇺🇸",
  id: "🇮🇩",
};
