/**
 * Locale negotiation (ADR-0095 §"Keputusan 5").
 *
 * Pure string handling — no request object, no cookies, no database. The
 * middleware owns the ORDER of the sources; this file only answers "given this
 * one input, which supported locale does it mean, if any".
 */
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type Locale
} from "./locales";

/** Longest `Accept-Language` header this will look at, in bytes. */
const ACCEPT_LANGUAGE_MAX_LENGTH = 512;

/** Most entries considered, after which the rest is ignored. */
const ACCEPT_LANGUAGE_MAX_ENTRIES = 24;

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Returns null (never a guess) when nothing matches, so the caller can continue
 * down its own fallback chain rather than being handed `en` prematurely.
 *
 * ## Bounded on purpose
 *
 * This runs on EVERY request, including unauthenticated public ones, and the
 * header is entirely attacker-controlled. So the input is truncated and the
 * entry count capped before any parsing: an `Accept-Language` of 100k
 * comma-separated q-values must cost the same as a normal one. The regex below
 * is linear and anchored with no nested quantifier, so there is no ReDoS to
 * bound in the first place — the caps are about total work, not backtracking.
 *
 * ## Language-only matching, and why the region is dropped
 *
 * Catalogs are keyed by LANGUAGE (`id`), so `id-ID`, `id`, and a hypothetical
 * `id-Latn-ID` must all resolve to the same catalog. The primary subtag is
 * compared and the rest ignored. Region-specific catalogs (`en-US` vs `en-GB`
 * spelling) would need this revisited; nothing here pretends to support them.
 */
export function negotiateAcceptLanguage(
  headerValue: string | null | undefined
): Locale | null {
  if (!headerValue) return null;

  const header = headerValue.slice(0, ACCEPT_LANGUAGE_MAX_LENGTH);

  const candidates: Array<{ locale: Locale; quality: number }> = [];

  const parts = header.split(",", ACCEPT_LANGUAGE_MAX_ENTRIES);

  for (const part of parts) {
    const [rawTag, ...params] = part.split(";");
    const tag = (rawTag ?? "").trim().toLowerCase();

    if (tag === "") continue;

    // `*` means "anything", which is not a preference for any particular
    // locale. Honouring it would make every browser that sends a trailing `*`
    // resolve to whichever locale happened to be first in our list.
    if (tag === "*") continue;

    const primary = tag.split("-")[0] ?? "";

    if (!isSupportedLocale(primary)) continue;

    let quality = 1;

    for (const param of params) {
      const match = /^\s*q\s*=\s*([0-9]*\.?[0-9]+)\s*$/i.exec(param);

      if (match) {
        const parsed = Number.parseFloat(match[1] ?? "");

        // A malformed or out-of-range q is treated as absent (q=1) rather than
        // discarding the entry: the reader still stated a language.
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          quality = parsed;
        }
      }
    }

    // `q=0` means "explicitly not this one".
    if (quality === 0) continue;

    candidates.push({ locale: primary, quality });
  }

  if (candidates.length === 0) return null;

  // Highest q wins; ties keep header order (the reader's own ranking), which a
  // sort must therefore be STABLE to preserve. `Array.prototype.sort` is stable
  // per spec, so comparing only on quality is enough.
  candidates.sort((left, right) => right.quality - left.quality);

  return candidates[0]?.locale ?? null;
}

/**
 * Coerces an untrusted stored/submitted value to a locale, or null.
 *
 * Used for the cookie and for the database column: both can hold a value this
 * build cannot render (a hand-edited cookie, or a row written when a
 * now-removed locale was supported). Neither may wedge a render, so an
 * unrecognised value is "no opinion", not an error.
 */
export function coerceLocale(value: unknown): Locale | null {
  return isSupportedLocale(value) ? value : null;
}

/**
 * Resolves the first source that states a locale, else `DEFAULT_LOCALE`.
 *
 * The middleware passes its sources in priority order (ADR-0095 §"Keputusan 5":
 * cookie override, stored principal preference, tenant default,
 * `Accept-Language`). Keeping the chain here rather than inline in the
 * middleware is what lets it be unit-tested without a request.
 */
export function resolveLocale(
  sources: ReadonlyArray<Locale | null | undefined>
): Locale {
  for (const source of sources) {
    if (source) return source;
  }

  return DEFAULT_LOCALE;
}

/** Every supported locale, for the switcher's option list. */
export function listLocales(): readonly Locale[] {
  return SUPPORTED_LOCALES;
}
