import { defineMiddleware } from "astro:middleware";

import { resolveSsrContext } from "./lib/auth/ssr-session";
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
} from "./lib/seo/redirect-middleware";

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

  if (
    context.url.pathname.startsWith(API_PREFIX) &&
    !checkContentLengthCeiling(context.request)
  ) {
    return applyResponseHeaders(
      bodyTooLargeResponse(BODY_SIZE_HARD_CEILING_BYTES),
      context.locals.correlationId
    );
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
      return applyResponseHeaders(
        redirectResult.redirect,
        context.locals.correlationId
      );
    }

    const notFoundCapture =
      redirectResult && "capture" in redirectResult
        ? redirectResult.capture
        : null;

    const response = await next();

    if (notFoundCapture && response.status === 404) {
      await recordPublicNotFound(context.request, notFoundCapture);
    }

    return applyResponseHeaders(response, context.locals.correlationId);
  }

  const ssrContext = await resolveSsrContext(context.cookies, new Date());

  if (!ssrContext) {
    return context.redirect("/login");
  }

  context.locals.ssrContext = ssrContext;

  return applyResponseHeaders(await next(), context.locals.correlationId);
});
