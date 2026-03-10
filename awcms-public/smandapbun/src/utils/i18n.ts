import idLocale from '../locales/id.json';
import enLocale from '../locales/en.json';

export type Locale = 'id' | 'en';

const locales: Record<Locale, typeof idLocale> = {
  id: idLocale,
  en: enLocale,
};

export const defaultLocale: Locale = 'id';
export const supportedLocales: Locale[] = ['id', 'en'];

const isLocalizedRecord = (value: unknown): value is Partial<Record<Locale, unknown>> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export function getLocale(urlOrRequest?: URL | Request | string): Locale {
  if (!urlOrRequest) return defaultLocale;

  let pathname: string;

  if (typeof urlOrRequest === 'string') {
    pathname = urlOrRequest;
  } else if (urlOrRequest instanceof URL) {
    pathname = urlOrRequest.pathname;
  } else if (urlOrRequest instanceof Request) {
    try {
      pathname = new URL(urlOrRequest.url).pathname;
    } catch {
      return defaultLocale;
    }
  } else {
    return defaultLocale;
  }

  const pathLocale = pathname.split('/')[1] as Locale;

  if (supportedLocales.includes(pathLocale)) {
    return pathLocale;
  }

  return defaultLocale;
}

export function t(key: string, locale: Locale = defaultLocale): string {
  const keys = key.split('.');
  let value: any = locales[locale];

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Fallback to default locale
      value = locales[defaultLocale];
      for (const fallbackKey of keys) {
        if (value && typeof value === 'object' && fallbackKey in value) {
          value = value[fallbackKey];
        } else {
          return key; // Return the key if not found
        }
      }
      break;
    }
  }

  return typeof value === 'string' ? value : key;
}

export function getLocalizedValue<T>(obj: any, locale: Locale): T | undefined {
  if (!obj) return undefined;

  if (!isLocalizedRecord(obj)) {
    return obj as T;
  }

  return (obj[locale] ?? obj[defaultLocale]) as T | undefined;
}

export function getLocalizedPath(path: string, locale: Locale): string {
  if (!path || path.startsWith('http') || path.startsWith('#')) {
    return path || '#';
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const { cleanPath } = extractLocaleFromPath(normalizedPath);
  const basePath = cleanPath || '/';

  if (locale === defaultLocale) {
    return basePath;
  }

  return basePath === '/' ? `/${locale}` : `/${locale}${basePath}`;
}

export function switchLocalePath(path: string, locale: Locale): string {
  return getLocalizedPath(path, locale);
}

export function extractLocaleFromPath(path: string): { locale: Locale; cleanPath: string } {
  const segments = path.split('/').filter(Boolean);

  if (segments.length > 0 && supportedLocales.includes(segments[0] as Locale)) {
    return {
      locale: segments[0] as Locale,
      cleanPath: '/' + segments.slice(1).join('/'),
    };
  }

  return {
    locale: defaultLocale,
    cleanPath: path,
  };
}
