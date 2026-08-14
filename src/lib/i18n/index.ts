/**
 * The i18n entry point every caller should use (ADR-0095).
 *
 * Binds a `Locale` to its COMPILED catalog. The two generated modules are
 * imported STATICALLY and by name, which is the whole point: a static import is
 * what makes the catalogs part of the bundle, so they reach `dist/` and
 * therefore reach the production image. A dynamic `import(\`./catalogs/${locale}\`)`
 * would look tidier and would resolve to nothing in production — the same shape
 * of failure as the 29 jobs that exited `Script not found` because
 * `Dockerfile.production` never copied `scripts/`.
 *
 * Adding a locale therefore costs an explicit line here. That is intended: the
 * cost is one line, and what it buys is the impossibility of a locale that
 * resolves at build time and vanishes at runtime.
 */
import {
  createTranslator,
  type CompiledCatalog,
  type Translator
} from "./catalog";
import { EN_CATALOG } from "./catalogs/en.generated";
import { ID_CATALOG } from "./catalogs/id.generated";
import { DEFAULT_LOCALE, type Locale } from "./locales";

const CATALOGS: Record<Locale, CompiledCatalog> = {
  en: EN_CATALOG,
  id: ID_CATALOG
};

/**
 * Translators are built once per locale and reused for every request.
 *
 * Safe at module scope for the same reason the `Intl` cache in `format.ts` is:
 * a translator closes over an immutable catalog and holds nothing
 * request-specific — no tenant, no session, no connection. The map is bounded by
 * `SUPPORTED_LOCALES`, so it cannot grow with traffic.
 */
const translators = new Map<Locale, Translator>();

/** The translator for `locale`. Never throws; never returns undefined. */
export function getTranslator(locale: Locale): Translator {
  const existing = translators.get(locale);

  if (existing) return existing;

  const created = createTranslator(locale, CATALOGS[locale]);
  translators.set(locale, created);

  return created;
}

/**
 * The translator for a locale that may be absent or invalid.
 *
 * The convenience matters at the call sites that read `Astro.locals.locale`: a
 * page rendered outside the middleware (a test, or a route added before the
 * locale seam existed) must still render, in English, rather than crash on
 * `undefined`.
 */
export function getTranslatorFor(
  locale: Locale | null | undefined
): Translator {
  return getTranslator(locale ?? DEFAULT_LOCALE);
}

export { createTranslator } from "./catalog";
export type { CompiledCatalog, Translator, TranslationValues } from "./catalog";
export {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber
} from "./format";
export {
  DEFAULT_LOCALE,
  LOCALE_ENDONYM,
  LOCALE_FLAG,
  LOCALE_INTL_TAG,
  PLURAL_FORM_COUNT,
  PLURAL_SELECTOR,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type Locale
} from "./locales";
export {
  coerceLocale,
  listLocales,
  negotiateAcceptLanguage,
  resolveLocale
} from "./negotiate";
