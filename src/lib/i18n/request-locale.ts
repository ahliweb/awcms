/**
 * Request-side locale resolution (ADR-0095 §"Keputusan 5").
 *
 * Kept out of `src/middleware.ts` so the ORDER of the fallback chain is
 * unit-testable without constructing a request, and out of `negotiate.ts` so
 * that file stays free of HTTP concepts.
 */
import {
  coerceLocale,
  resolveLocale,
  negotiateAcceptLanguage
} from "./negotiate";
import type { Locale } from "./locales";

/**
 * Cookie the language switcher writes.
 *
 * NOT `HttpOnly`, and deliberately so: the switcher sets it from client script
 * on a page that may be unauthenticated (`/login`, ADR-0088's tenant-selection
 * screen), and there is no server round trip to set it on at that point. That is
 * safe because the value carries no authority whatsoever — it selects a catalog,
 * and the worst a forged value achieves is reading the admin in a language you
 * did not pick. Anything unrecognised is discarded by `coerceLocale`, so it
 * cannot even be a vector for reflecting attacker text onto the page.
 */
export const LOCALE_COOKIE_NAME = "awcms_locale";

/**
 * One year. A language choice does not expire in any meaningful sense, and a
 * short-lived cookie would silently revert a reader to `Accept-Language`
 * mid-week.
 */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface LocaleSources {
  /** Value of the `awcms_locale` cookie, if present. */
  readonly cookieValue?: string | null;
  /** The authenticated principal's stored preference, if a session resolved. */
  readonly storedPreference?: string | null;
  /** `awcms_tenants.default_locale` for the active tenant, if known. */
  readonly tenantDefault?: string | null;
  /** Raw `Accept-Language` header. */
  readonly acceptLanguage?: string | null;
}

/**
 * Resolves the locale for one request.
 *
 * The order is the ADR's, and each step earns its position:
 *
 * 1. **Cookie override** — an explicit, just-now choice. It outranks the stored
 *    preference so that switching language takes effect on the CURRENT device
 *    immediately, including before login and on the tenant-selection screen
 *    where no preference is readable yet.
 * 2. **Stored principal preference** — follows the human across devices.
 * 3. **Tenant default** (`awcms_tenants.default_locale`) — an Indonesian
 *    tenant's operators should not each have to pick Indonesian.
 * 4. **`Accept-Language`** — what the browser asked for.
 * 5. **`en`** — the source language.
 *
 * Every source is coerced, never trusted: a cookie is user-editable, and a
 * database column can hold a locale a later build no longer supports. An
 * unrecognised value means "no opinion" and falls through, so no input can wedge
 * a render.
 */
export function resolveRequestLocale(sources: LocaleSources): Locale {
  return resolveLocale([
    coerceLocale(sources.cookieValue),
    coerceLocale(sources.storedPreference),
    coerceLocale(sources.tenantDefault),
    negotiateAcceptLanguage(sources.acceptLanguage)
  ]);
}
