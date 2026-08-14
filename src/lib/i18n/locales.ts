/**
 * The supported-locale vocabulary (ADR-0095).
 *
 * ONE list, and everything else derives from it: the catalog compiler's output
 * set, the middleware's negotiation, the `<select>` in `LanguageSwitcher`, and
 * the `CHECK` constraint in sql/128 (which is asserted against this list by
 * `bun run i18n:catalog:check`, so the database and the code cannot drift into
 * disagreeing about what a locale is).
 *
 * Adding a locale is deliberately not free: it costs a catalog, a migration to
 * widen the `CHECK`, and a plural rule below. A locale with no catalog renders
 * as untranslated English, which looks like a bug rather than a missing
 * translation — so the price buys the difference between the two.
 */
export const SUPPORTED_LOCALES = ["en", "id"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * The fallback at the end of every resolution chain, and the language every
 * `msgid` is written in (ADR-0095 §"Keputusan 2" — `msgid` IS the English
 * source text). An untranslated string therefore degrades to correct English
 * rather than to a leaked key.
 */
export const DEFAULT_LOCALE: Locale = "en";

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * How each locale names ITSELF. A language picker that lists "Indonesian" to a
 * reader who does not read English is a picker they cannot use, so the endonym
 * is the label — the one string in this repo that must never be translated.
 */
export const LOCALE_ENDONYM: Record<Locale, string> = {
  en: "English",
  id: "Bahasa Indonesia"
};

/**
 * Flag glyph per locale, decoration only — `LanguageSwitcher` marks it
 * `aria-hidden` and the endonym carries the meaning. (A flag is a country, not
 * a language; it is a visual anchor here and nothing more.)
 */
export const LOCALE_FLAG: Record<Locale, string> = {
  en: "🇬🇧",
  id: "🇮🇩"
};

/**
 * The BCP-47 tag handed to `Intl` for number/currency/date formatting. Distinct
 * from the catalog key on purpose: the catalog is keyed by LANGUAGE (`id`),
 * while `Intl` wants a region to pick separators and calendars (`id-ID` gives
 * `1.234,56` and Indonesian month names; bare `id` is under-specified).
 */
export const LOCALE_INTL_TAG: Record<Locale, string> = {
  en: "en-GB",
  id: "id-ID"
};

/**
 * Plural-form selection, IN CODE — never evaluated from the `.po` header.
 *
 * A `.po` file carries `Plural-Forms: nplurals=2; plural=(n != 1);`, which is a
 * C expression sitting in a DATA file. Evaluating it would mean executing an
 * expression that arrives with the catalog, and this repo does not do that
 * (the same reasoning that makes `theming`'s CSS values validated-by-rejection
 * rather than sanitized). So the rule lives here, and
 * `bun run i18n:catalog:check` asserts each catalog's declared `nplurals`
 * matches `PLURAL_FORM_COUNT` below — the header is read to be VERIFIED, not to
 * be run.
 *
 * Indonesian does not inflect for number (`satu buku` / `dua buku`), so it has
 * exactly one form. English has two.
 */
export const PLURAL_FORM_COUNT: Record<Locale, number> = {
  en: 2,
  id: 1
};

/**
 * Maps a count onto a plural-form INDEX for the locale. Must agree with
 * `PLURAL_FORM_COUNT` (asserted by `tests/i18n-catalog.test.ts`).
 */
export const PLURAL_SELECTOR: Record<Locale, (n: number) => number> = {
  en: (n) => (n === 1 ? 0 : 1),
  id: () => 0
};
