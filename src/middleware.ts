import { defineMiddleware } from "astro:middleware";

import { resolveSsrContext } from "./lib/auth/ssr-session";
import { annotateEdgeCache } from "./lib/edge-cache/runtime";
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
  // throws. awcms has NO i18n/locale seam, so `locale` is `null`. The `/admin`
  // guard and the API body-ceiling above are untouched.
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

  return finalize(await next());
});
