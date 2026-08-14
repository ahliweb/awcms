/**
 * Locale-aware number, currency and date formatting (ADR-0095).
 *
 * Separate from the catalog on purpose: translating a label and formatting a
 * value are different failures. A missing translation shows English; a wrongly
 * formatted number shows *the wrong number*. `Rp 1.234,56` and `Rp 1,234.56`
 * differ by a factor of a thousand to an Indonesian reader, and no catalog entry
 * can fix that.
 */
import { LOCALE_INTL_TAG, type Locale } from "./locales";

/**
 * `Intl` formatter construction is not free and these run per row on list
 * screens, so instances are memoised per (locale, options) pair.
 *
 * Safe to hold at module scope, unlike a database pool: an `Intl.*Format` is
 * immutable, stateless, and carries nothing request-specific. The key includes
 * every option, so two call sites with different options never share one.
 *
 * The map is bounded by the number of DISTINCT option sets in the codebase — a
 * compile-time quantity, not a per-request one — so it cannot grow unboundedly
 * from traffic.
 */
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(
  locale: Locale,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const existing = numberFormatters.get(key);

  if (existing) return existing;

  const created = new Intl.NumberFormat(LOCALE_INTL_TAG[locale], options);
  numberFormatters.set(key, created);

  return created;
}

function dateFormatter(
  locale: Locale,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const existing = dateFormatters.get(key);

  if (existing) return existing;

  const created = new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], options);
  dateFormatters.set(key, created);

  return created;
}

/** Formats an integer or decimal for display. */
export function formatNumber(
  locale: Locale,
  value: number,
  options: Intl.NumberFormatOptions = {}
): string {
  return numberFormatter(locale, options).format(value);
}

/**
 * Formats a monetary amount.
 *
 * `currency` is REQUIRED rather than defaulting to `IDR`. A default currency is
 * how an amount ends up labelled `Rp` because nobody passed one — and unlike a
 * missing translation, that is a wrong statement about money.
 *
 * Amounts arrive from Postgres `numeric` columns as STRINGS (this repo stores
 * money as `numeric`, never float), so a string is accepted and parsed here
 * rather than forcing every call site to coerce and risk losing precision on the
 * way in.
 */
export function formatCurrency(
  locale: Locale,
  value: number | string,
  currency: string,
  options: Intl.NumberFormatOptions = {}
): string {
  const numeric = typeof value === "string" ? Number(value) : value;

  // A non-numeric string would render as `NaN` on the screen. Showing the raw
  // value is worse than useless for money, so this states the problem instead.
  if (!Number.isFinite(numeric)) return "—";

  return numberFormatter(locale, {
    style: "currency",
    currency,
    ...options
  }).format(numeric);
}

/**
 * Formats a timestamp for display in a given time zone.
 *
 * `timeZone` is required for the same reason `currency` is: `Intl` otherwise
 * silently uses the SERVER's zone, so an SSR-rendered timestamp would be right
 * in development and wrong in production. Every stored instant in this repo is
 * `timestamptz`, so the instant is unambiguous and only the presentation zone
 * has to be chosen.
 */
export function formatDateTime(
  locale: Locale,
  value: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) return "—";

  return dateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
    ...options
  }).format(date);
}

/** Date only, no clock — for `created_at` columns in list views. */
export function formatDate(
  locale: Locale,
  value: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  return formatDateTime(locale, value, timeZone, {
    dateStyle: "medium",
    timeStyle: undefined,
    ...options
  });
}
