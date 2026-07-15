import { defineMiddleware } from "astro:middleware";

import { resolveSsrContext } from "./lib/auth/ssr-session";
import { buildSecurityHeaders } from "./lib/security/security-headers";
import {
  BODY_SIZE_HARD_CEILING_BYTES,
  bodyTooLargeResponse,
  checkContentLengthCeiling
} from "./lib/security/request-body-limit";

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
    isProduction: process.env.APP_ENV === "production"
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

  if (!context.url.pathname.startsWith(PROTECTED_PREFIX)) {
    return applyResponseHeaders(await next(), context.locals.correlationId);
  }

  const ssrContext = await resolveSsrContext(context.cookies, new Date());

  if (!ssrContext) {
    return context.redirect("/login");
  }

  context.locals.ssrContext = ssrContext;

  return applyResponseHeaders(await next(), context.locals.correlationId);
});
