import { defineMiddleware } from "astro:middleware";

import { resolveSsrContext } from "./lib/auth/ssr-session";
import { annotateEdgeCache } from "./lib/edge-cache/runtime";
import {
  LOCALE_COOKIE_NAME,
  resolveRequestLocale
} from "./lib/i18n/request-locale";
import { buildSecurityHeaders } from "./lib/security/security-headers";
import { isTurnstileRequired } from "./lib/security/turnstile";
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
    turnstileEnabled: isTurnstileRequired()
  })) {
    response.headers.set(name, value);
  }

  return response;
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
  // `locale` stays `null` here, and the reason has CHANGED: a locale seam now
  // exists (ADR-0095 sets `locals.locale` above), so this is no longer "there is
  // nothing to pass". It is a deliberate refusal to make a PUBLIC response vary
  // by locale before the edge-cache key carries one. Varnish keys on the URL;
  // handing a locale to redirect matching here would let the first reader's
  // language decide which redirect every later reader gets. Passing the resolved
  // locale is a one-line change that must wait for that key (ADR-0095
  // §"Keputusan 5" lists it as the prerequisite).
  if (!context.url.pathname.startsWith(PROTECTED_PREFIX)) {
    const redirectResult = await resolvePublicRedirectForRequest(
      context.request,
      context.url,
      null
    );

    if (redirectResult && "redirect" in redirectResult) {
      return finalize(redirectResult.redirect);
    }

    const notFoundCapture =
      redirectResult && "capture" in redirectResult
        ? redirectResult.capture
        : null;

    const response = await next();

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
