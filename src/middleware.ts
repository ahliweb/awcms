import type { APIContext } from "astro";
import { defineMiddleware } from "astro:middleware";

import { resolveSsrContext } from "./lib/auth/ssr-session";
import { getDatabaseClient } from "./lib/database/client";
import { annotateEdgeCache } from "./lib/edge-cache/runtime";
import type { Locale } from "./lib/i18n/locales";
import { coerceLocale } from "./lib/i18n/negotiate";
import {
  carryLocaleThroughRedirect,
  resolvePublicLocaleRoute
} from "./lib/i18n/public-locale-path";
import {
  LOCALE_COOKIE_NAME,
  resolveRequestLocale
} from "./lib/i18n/request-locale";
import { log } from "./lib/logging/logger";
import { resolvePublicTenantByCode } from "./lib/tenant/public-tenant-resolver";
import { buildSecurityHeaders } from "./lib/security/security-headers";
import { isTurnstileRequired } from "./lib/security/turnstile";
import { isVideoEmbedEnabled } from "./lib/security/video-embed";
import {
  BODY_SIZE_HARD_CEILING_BYTES,
  bodyTooLargeResponse,
  checkContentLengthCeiling
} from "./lib/security/request-body-limit";
import {
  recordPublicNotFound,
  resolvePublicRedirectForRequest
} from "./modules/seo-distribution/presentation/redirect-middleware";

const PROTECTED_PREFIX = "/admin";
const API_PREFIX = "/api/";
const CORRELATION_ID_HEADER = "X-Correlation-ID";

function resolveCorrelationId(request: Request): string {
  const incoming = request.headers.get(CORRELATION_ID_HEADER);

  return incoming && incoming.trim().length > 0
    ? incoming
    : crypto.randomUUID();
}

function applyResponseHeaders(
  response: Response,
  correlationId: string
): Response {
  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  for (const [name, value] of buildSecurityHeaders({
    isProduction: process.env.APP_ENV === "production",
    // Issue #186 — opens the one Cloudflare Turnstile origin in the CSP ONLY on
    // a full-online deployment that requires Turnstile; false (no extra origin)
    // on every LAN/offline deployment.
    turnstileEnabled: isTurnstileRequired(),
    // ADR-0110 — opens the one `youtube-nocookie.com` origin in `frame-src`
    // ONLY when an operator asked for video embeds; false (no extra origin) on
    // every deployment that has not.
    videoEmbedEnabled: isVideoEmbedEnabled()
  })) {
    response.headers.set(name, value);
  }

  return response;
}

/**
 * ADR-0098 decision 3 — the locale-selection redirect.
 *
 * `307`, not `301`/`308`: the choice is made from a cookie that a reader can
 * change at any moment, so it must never be written into a browser's permanent
 * redirect cache. A `301` here would pin the first-ever visitor's language onto
 * that browser for the life of its cache, and the language switcher would look
 * broken with nothing in any log to explain it.
 *
 * `private, no-store` is what keeps the cookie out of the shared cache. It is
 * set here rather than left to `annotateEdgeCache`'s default because this
 * response is the ONE place a cookie influences a public body, and a default is
 * the wrong thing to rely on for that.
 */
function buildLocaleSelectionRedirect(target: URL): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: target.pathname + target.search,
      "Cache-Control": "private, no-store"
    }
  });
}

/**
 * Rewrites a `seo_distribution` redirect's `Location` so a reader who arrived
 * on `/id/…` stays on `/id/…`. Returns the response untouched when there is
 * nothing to carry.
 */
function withLocaleCarriedThroughRedirect(
  response: Response,
  locale: Locale | null
): Response {
  const location = response.headers.get("Location");

  if (!locale || !location) {
    return response;
  }

  const carried = carryLocaleThroughRedirect(location, locale);

  if (carried === location) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Location", carried);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/** `/blog/{tenantCode}/…` → `tenantCode`; `null` when the path names none. */
function readTenantCodeFromPath(pathname: string): string | null {
  return /^\/blog\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/**
 * The locale for a bare public URL, following ADR-0095's chain as far as a
 * request with no session can follow it: cookie → tenant default →
 * `Accept-Language` → `en`. The stored principal preference is skipped because
 * there is no principal — this is an anonymous public request, and the `/admin`
 * branch below is where a session exists to read one from.
 *
 * The tenant default costs one query, and it is paid ONLY here — on a bare URL
 * that is about to redirect, never on the prefixed URL that actually serves.
 * That keeps the promise the provisional-locale block above makes (a served
 * public request performs no extra query to know its language) while still
 * honouring the tenant's own default, which is the step an Indonesian tenant's
 * readers would notice missing.
 *
 * Fails OPEN, matching the redirect subsystem beside it: if the lookup throws,
 * the reader is redirected using cookie and `Accept-Language` alone rather than
 * being shown a 500 because a language preference could not be read.
 */
async function resolvePublicRedirectLocale(
  context: APIContext
): Promise<Locale> {
  const cookieValue = context.cookies.get(LOCALE_COOKIE_NAME)?.value ?? null;
  const acceptLanguage = context.request.headers.get("accept-language");
  const tenantCode = readTenantCodeFromPath(context.url.pathname);

  let tenantDefault: string | null = null;

  if (tenantCode && !coerceLocale(cookieValue)) {
    try {
      const tenant = await resolvePublicTenantByCode(
        getDatabaseClient(),
        tenantCode
      );

      tenantDefault = tenant?.defaultLocale ?? null;
    } catch (error) {
      log("warning", "i18n.public_locale.tenant_default_unavailable", {
        moduleKey: "i18n",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return resolveRequestLocale({
    cookieValue,
    tenantDefault,
    acceptLanguage
  });
}

/**
 * Guards `/admin/*` here (not in a nested layout component) — middleware
 * runs before any rendering starts, so redirecting here is the
 * stream-safe place to do it (a redirect thrown from inside an
 * already-rendering nested component fails).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.correlationId = resolveCorrelationId(context.request);

  /**
   * Provisional locale (ADR-0095 §"Keputusan 5"), set BEFORE any branch below so
   * that no route can observe `locals.locale` as undefined — including the two
   * branches that return early (body-size rejection, public redirect).
   *
   * Cookie and `Accept-Language` only at this point. The stored principal
   * preference needs a resolved session, which only the `/admin` branch has, so
   * that branch refines this value once it does. Doing it in two steps rather
   * than one is what keeps the cost of a locale off the public path: a public
   * request performs no extra query to know its language.
   */
  context.locals.locale = resolveRequestLocale({
    cookieValue: context.cookies.get(LOCALE_COOKIE_NAME)?.value ?? null,
    acceptLanguage: context.request.headers.get("accept-language")
  });

  const startedAtMs = performance.now();

  /**
   * Single exit point for every branch below (ADR-0042 §7). Routing every
   * RENDERED response — `/admin` and `/api` included — through the edge-cache
   * annotator is what guarantees no rendered response reaches Varnish
   * unlabelled: an undeclared path resolves to `surface_not_declared` and is
   * stamped `Cache-Control: private, no-store`. Varnish's built-in VCL would
   * otherwise cache an unlabelled `200` for its `default_ttl`, which on an
   * admin page is a cross-tenant disclosure. Annotation never throws and never
   * blocks.
   *
   * WHAT "RENDERED" EXCLUDES, AND WHY THAT IS SAFE (Issue #464)
   * ----------------------------------------------------------
   * This middleware does not run for a request the adapter's static handler
   * answers from `dist/client/` — it runs FIRST and only falls through to the
   * app when no file matches. So `public/**` and `_astro/**` are outside this
   * annotator, and this comment used to claim otherwise.
   *
   * That is tolerable for CACHING specifically, and only because of what those
   * files are: `_astro/**` is content-hashed output the adapter itself stamps
   * `public, max-age=31536000, immutable`, and `public/**` is unauthenticated
   * static content whose worst case at the edge is being cached for
   * `default_ttl` — no tenant is derivable from it. It would NOT be tolerable
   * for a path that varies by tenant or session, so a static file must never
   * become one.
   *
   * Security headers are a different matter and are NOT tolerable to skip:
   * `src/lib/server/standalone-entry.ts` applies the same
   * `buildSecurityHeaders()` to static responses before the adapter sees them.
   */
  const finalize = async (response: Response): Promise<Response> =>
    applyResponseHeaders(
      await annotateEdgeCache({
        request: context.request,
        pathname: context.url.pathname,
        searchParams: context.url.searchParams,
        response,
        publishedTenantId: context.locals.edgeCacheTenantId,
        originLatencyMs: performance.now() - startedAtMs,
        nowMs: Date.now()
      }),
      context.locals.correlationId
    );

  if (
    context.url.pathname.startsWith(API_PREFIX) &&
    !checkContentLengthCeiling(context.request)
  ) {
    return finalize(bodyTooLargeResponse(BODY_SIZE_HARD_CEILING_BYTES));
  }

  // Public (non-`/admin`) branch: resolve a `seo_distribution` redirect BEFORE
  // serving, then serve, then best-effort record a 404 observation (ADR-0039).
  // FAIL-OPEN by construction: `resolvePublicRedirectForRequest` swallows every
  // fault to `null` (a redirect-subsystem error never becomes a 500 or blocks a
  // page), and the 404 capture runs AFTER the response is produced and never
  // throws. The `/admin` guard and the API body-ceiling above are untouched.
  //
  // The locale is no longer withheld here. ADR-0098 put it in the PATH, which
  // means it is part of the cache key, which is exactly the condition ADR-0095
  // §"Keputusan 5" named as the prerequisite. Redirect RULES are still matched
  // against the bare path (a slug change is not a language change), and the
  // reader's locale is carried across the hop by rewriting `Location` — see
  // `carryLocaleThroughRedirect`.
  if (!context.url.pathname.startsWith(PROTECTED_PREFIX)) {
    const localeRoute = resolvePublicLocaleRoute(context.url.pathname);

    /**
     * ADR-0098 decision 3 — selection happens by REDIRECT, never by variation.
     *
     * This is the one response in the public branch that reads a cookie, and it
     * is the one response that must never be cached: `buildLocaleSelectionRedirect`
     * stamps it `private, no-store`, so the cookie decides where a reader goes
     * without ever deciding what a shared cache holds. Only the prefixed
     * destination is cacheable.
     */
    if (localeRoute.action === "redirect") {
      const locale = await resolvePublicRedirectLocale(context);

      return finalize(
        buildLocaleSelectionRedirect(
          new URL(localeRoute.target(locale) + context.url.search, context.url)
        )
      );
    }

    /**
     * A prefixed URL: the PATH is authoritative, outranking the cookie that
     * `resolveRequestLocale` consulted above.
     *
     * This inversion is the whole safety property. If the cookie won here, two
     * readers of `/en/blog/acme` would get different bodies under one cache key
     * and the first one to miss would decide what the second sees — the
     * misdelivery ADR-0098 exists to make impossible. The URL is the key, so the
     * URL chooses the body.
     */
    if (localeRoute.action === "serve") {
      context.locals.locale = localeRoute.locale;
    }

    const barePathname =
      localeRoute.action === "serve"
        ? localeRoute.servePathname
        : context.url.pathname;
    const bareUrl = new URL(context.url);
    bareUrl.pathname = barePathname;

    const redirectResult = await resolvePublicRedirectForRequest(
      context.request,
      bareUrl,
      localeRoute.action === "serve" ? localeRoute.locale : null
    );

    if (redirectResult && "redirect" in redirectResult) {
      return finalize(
        withLocaleCarriedThroughRedirect(
          redirectResult.redirect,
          localeRoute.action === "serve" ? localeRoute.locale : null
        )
      );
    }

    const notFoundCapture =
      redirectResult && "capture" in redirectResult
        ? redirectResult.capture
        : null;

    // `next(path)` is a REWRITE, not a second request: the prefixed URL is what
    // the reader sees and what the edge keys on, while the route file that
    // serves it stays at `src/pages/blog/…` with no duplicated `[locale]` tree.
    // Routes read the reader's language from `locals.locale`, set above, rather
    // than from `Astro.url` — which a rewrite deliberately moves to the bare
    // path (`Astro.originPathname` keeps the prefixed one).
    const response =
      localeRoute.action === "serve"
        ? await next(barePathname + context.url.search)
        : await next();

    if (notFoundCapture && response.status === 404) {
      await recordPublicNotFound(context.request, notFoundCapture);
    }

    return finalize(response);
  }

  const ssrContext = await resolveSsrContext(context.cookies, new Date());

  if (!ssrContext) {
    return context.redirect("/login");
  }

  context.locals.ssrContext = ssrContext;

  /**
   * Refine the provisional locale now that a session exists (ADR-0095
   * §"Keputusan 5"). The cookie still wins — an explicit switch must take effect
   * on this device immediately, even when it disagrees with what is stored —
   * but a reader on a NEW device, with no cookie yet, now gets the language they
   * chose somewhere else, and a reader who chose nothing gets their tenant's
   * default before `Accept-Language` is consulted.
   */
  context.locals.locale = resolveRequestLocale({
    cookieValue: context.cookies.get(LOCALE_COOKIE_NAME)?.value ?? null,
    storedPreference: ssrContext.display.preferredLocale,
    tenantDefault: ssrContext.display.tenantDefaultLocale,
    acceptLanguage: context.request.headers.get("accept-language")
  });

  return finalize(await next());
});
