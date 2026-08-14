/**
 * `POST /api/v1/auth/preferences/locale` — switch the UI language for THIS
 * browser, with or without a session (ADR-0095 §"Keputusan 5").
 *
 * ## Why this route touches no database at all
 *
 * It has to work on `/login` and on ADR-0088's tenant-selection screen — the two
 * places a reader most often discovers they are being shown the wrong language,
 * and the two places where no session exists to hang a preference on. So its
 * entire effect is a cookie.
 *
 * That is also why it is not built on `defineSelfServiceTenantRoute`: that
 * factory requires a bearer and answers `onUnauthenticated` without it, which is
 * precisely the caller this endpoint exists to serve. And because it opens no
 * tenant transaction, it needs no entry on `api:tenant-route:check`'s allowlist —
 * that ledger may only shrink, and a route with no database work has nothing to
 * put on it.
 *
 * The DURABLE half of the feature lives at `POST /api/v1/auth/preferences`, which
 * IS a self-service tenant route because persisting against a principal genuinely
 * requires knowing who is asking. `AdminLayout` points the switcher there; the
 * unauthenticated screens point it here. Both set the same cookie, so switching
 * language behaves identically either side of the login boundary.
 *
 * ## CSRF, stated rather than assumed
 *
 * A cross-origin form POST here can change which of two catalogs a reader is
 * shown. That is the entire impact: cosmetic, immediately visible, and undone by
 * one click. The cookie is deliberately not `HttpOnly` (see `request-locale.ts`),
 * so same-origin script could set it anyway, and there is no server state to
 * corrupt. A token here would add a failure mode to the one control a reader
 * looking at the wrong language needs to work.
 */
import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse
} from "../../../../../modules/_shared/api-response";
import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME
} from "../../../../../lib/i18n/request-locale";
import { coerceLocale } from "../../../../../lib/i18n/negotiate";
import { sameOriginPathOr } from "../../../../../lib/security/same-origin-path";

const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

/**
 * Where a no-script form submission goes back to.
 *
 * `return_to` arrives in the BODY, so it is attacker-supplied no matter that the
 * component fills it from the server's own URL. `isSameOriginPath` admits only
 * path-absolute references over an allow-listed character set, which excludes
 * `//evil.com`, `/\evil.com` and the `"/\t/evil.com"` control-character bypass by
 * construction rather than by remembering them.
 *
 * See that file for why this is not a duplicate of `seo_distribution`'s frozen
 * `classifyRedirectTarget`: that guard must additionally accept ABSOLUTE URLs and
 * match them against a tenant's hosts, and importing it here would make
 * `identity_access` depend on `seo_distribution` — a dependency that would
 * outlive the convenience.
 *
 * Anything not admitted falls back to `/admin` rather than failing the request:
 * the language change already succeeded, and answering a successful switch with a
 * 400 because the return path looked odd is a worse outcome than landing
 * somewhere safe.
 */
function safeReturnTo(raw: string | null): string {
  return sameOriginPathOr(raw, "/admin");
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const contentType = request.headers.get("content-type") ?? "";
  const wantsRedirect = contentType.includes(
    "application/x-www-form-urlencoded"
  );

  let requestedLocale: string | null = null;
  let returnTo: string | null = null;

  try {
    if (wantsRedirect) {
      const form = await request.formData();
      requestedLocale = form.get("locale")?.toString() ?? null;
      returnTo = form.get("return_to")?.toString() ?? null;
    } else {
      const body = (await request.json()) as unknown;
      requestedLocale =
        body && typeof body === "object" && "locale" in body
          ? String((body as { locale: unknown }).locale)
          : null;
    }
  } catch {
    return fail(
      400,
      "INVALID_BODY",
      "Request body could not be read.",
      {},
      undefined,
      NO_STORE_HEADERS
    );
  }

  const locale = coerceLocale(requestedLocale);

  if (!locale) {
    return fail(
      400,
      "UNSUPPORTED_LOCALE",
      "Requested locale is not supported by this build.",
      {},
      undefined,
      NO_STORE_HEADERS
    );
  }

  cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    // Not `HttpOnly` on purpose — see `request-locale.ts`. The value carries no
    // authority, and the switcher reflects it client-side.
    httpOnly: false,
    sameSite: "lax",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    secure: process.env.AUTH_COOKIE_SECURE === "true"
  });

  if (wantsRedirect) {
    return new Response(null, {
      // 303 so the browser re-fetches with GET. A 302 leaves some clients
      // re-POSTing on reload.
      status: 303,
      headers: { Location: safeReturnTo(returnTo), ...NO_STORE_HEADERS }
    });
  }

  // `persisted: false` is stated rather than omitted: this endpoint never
  // persists, and a caller comparing the two routes' answers should see that
  // difference in the payload rather than infer it from the URL.
  return jsonResponse(
    { success: true, data: { locale, persisted: false }, meta: {} },
    { status: 200, headers: NO_STORE_HEADERS }
  );
};
