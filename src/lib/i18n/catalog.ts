/**
 * The runtime translator (ADR-0095).
 *
 * Pure and synchronous: no I/O, no database, no filesystem. It closes over an
 * already-compiled catalog object, which is why it is safe to call from an
 * `.astro` template mid-render and from a module's domain code alike.
 *
 * ## The one invariant worth stating
 *
 * A missing translation returns the `msgid`, and the `msgid` IS the English
 * source text (ADR-0095 §"Keputusan 2"). So the failure mode of an incomplete
 * catalog is *correct English on the screen* — never a leaked key like
 * `admin.nav.posts`, and never an empty element. That property is what makes it
 * safe to land the catalog incrementally across 40 screens instead of
 * atomically.
 */
import { DEFAULT_LOCALE, PLURAL_SELECTOR, type Locale } from "./locales";
import { CONTEXT_SEPARATOR } from "./po";

/**
 * A compiled catalog: lookup key -> plural forms.
 *
 * The key is `msgid`, or `msgctxt\u0004msgid` for a contextualised entry (the
 * separator gettext itself uses). Untranslated entries are OMITTED at compile
 * time rather than stored as `""` — a lookup miss and an empty translation must
 * take the same code path, and the smaller object is the one that ships.
 */
export type CompiledCatalog = Readonly<Record<string, readonly string[]>>;

/** Values substitutable into a message via `{name}` placeholders. */
export type TranslationValues = Readonly<Record<string, string | number>>;

export interface Translator {
  /** The locale this translator was built for. */
  readonly locale: Locale;
  /** Translate `msgid`, optionally interpolating `{name}` placeholders. */
  readonly t: (msgid: string, values?: TranslationValues) => string;
  /** Translate a plural message, choosing the form for `count`. */
  readonly tn: (
    msgid: string,
    msgidPlural: string,
    count: number,
    values?: TranslationValues
  ) => string;
  /**
   * Translate `msgid` under a disambiguating context. Two English words that
   * are identical but translate differently (a noun "Order" vs a verb "Order")
   * need this; without it one of them is always wrong.
   */
  readonly tx: (
    context: string,
    msgid: string,
    values?: TranslationValues
  ) => string;
}

/**
 * Substitutes `{name}` placeholders.
 *
 * A placeholder with no matching value is left VERBATIM rather than replaced
 * with an empty string. `{count}` surviving onto a screen is a visible bug that
 * gets fixed; a silently vanished number is a sentence that reads fine and
 * states something false.
 *
 * No escaping happens here, and none is needed: every call site inserts the
 * result as an Astro text node (or an attribute), both of which Astro escapes.
 * A translated string must never be fed to `set:html` — the CSP would still
 * allow the markup, so that rule is a review rule, not one this function can
 * enforce.
 */
function interpolate(message: string, values?: TranslationValues): string {
  if (!values) return message;

  return message.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = values[name];

    return value === undefined ? whole : String(value);
  });
}

/**
 * Builds a translator over `catalog` for `locale`.
 *
 * Takes the catalog as a PARAMETER rather than importing it, so the same
 * function serves the request path (compiled catalogs) and the tests (small
 * hand-written ones) without a module mock. `mock.module` mutates a live
 * namespace in this repo's harness, so a design that does not need it is
 * strictly better.
 */
export function createTranslator(
  locale: Locale,
  catalog: CompiledCatalog
): Translator {
  const selectPluralForm = PLURAL_SELECTOR[locale];

  const lookup = (key: string): readonly string[] | undefined => catalog[key];

  const t = (msgid: string, values?: TranslationValues): string => {
    const forms = lookup(msgid);
    const message = forms?.[0];

    return interpolate(
      message !== undefined && message !== "" ? message : msgid,
      values
    );
  };

  const tn = (
    msgid: string,
    msgidPlural: string,
    count: number,
    values?: TranslationValues
  ): string => {
    const forms = lookup(msgid);
    const index = selectPluralForm(count);
    const message = forms?.[index];

    if (message !== undefined && message !== "") {
      return interpolate(message, { count, ...values });
    }

    // Untranslated: fall back to the ENGLISH plural rule over the two source
    // strings, not to `locale`'s rule. The source strings are English, so
    // Indonesian's single-form selector would pick `msgid` for every count and
    // render "1 items"/"2 item" in English. Falling back must not also change
    // which language's grammar is being applied.
    return interpolate(
      PLURAL_SELECTOR[DEFAULT_LOCALE](count) === 0 ? msgid : msgidPlural,
      { count, ...values }
    );
  };

  const tx = (
    context: string,
    msgid: string,
    values?: TranslationValues
  ): string => {
    const forms = lookup(`${context}${CONTEXT_SEPARATOR}${msgid}`);
    const message = forms?.[0];

    return interpolate(
      message !== undefined && message !== "" ? message : msgid,
      values
    );
  };

  return { locale, t, tn, tx };
}
