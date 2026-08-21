import type { APIRoute } from "astro";

import { fail, jsonResponse } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { resolvePublicTenantByCode } from "../../../../lib/tenant/public-tenant-resolver";
import { resolvePublicTenantByHost } from "../../../../lib/tenant/public-host-tenant-resolver";
import { collectVisitorTelemetry } from "../../../../modules/visitor-analytics/application/collector";
import {
  beaconCorsDeniedHeaders,
  beaconCorsResponseHeaders,
  beaconPreflightHeaders,
  isCrossOriginBeacon,
  parseBeaconOrigin,
  resolveVisitorCookieSameSite
} from "../../../../modules/visitor-analytics/domain/beacon-cors";
import { resolveVisitorAnalyticsConfig } from "../../../../modules/visitor-analytics/domain/visitor-analytics-config";
import { resolveAnalyticsClientIp } from "../../../../modules/visitor-analytics/domain/client-ip";
import { resolveGeoEnrichment } from "../../../../modules/visitor-analytics/domain/geo-enrichment";
import { determineArea } from "../../../../modules/visitor-analytics/domain/request-area";
import { isTrackablePath } from "../../../../modules/visitor-analytics/domain/path-sanitizer";
import {
  planVisitorKeyCookie,
  shouldRevokeVisitorKeyCookie
} from "../../../../modules/visitor-analytics/domain/visitor-key-cookie";

const VISITOR_KEY_COOKIE_NAME = "awcms_visitor_key";

/**
 * Defensive upper bound on the reported `path` before it is stored. The
 * `path_sanitized`/`current_path` columns are unbounded `text` and the request
 * body limit already caps the whole payload, but this bounds the single field
 * independently — a real navigable URL path is far shorter, and an oversized
 * value is only ever storage/log bloat on an anonymous, unauthenticated write.
 */
const MAX_PATH_LENGTH = 2048;

/**
 * Per-IP rate-limit backstop for this PUBLIC, unauthenticated beacon — the same
 * `checkRateLimit` in-process fixed-window limiter `auth/login.ts` and
 * `setup/initialize.ts` use. Without it, anyone holding a public `tenantCode`
 * could flood the endpoint with unbounded session/event writes and poison a
 * tenant's aggregates. The key is IP-only (never the tenant): a 429 is driven
 * purely by request volume from one source and reveals nothing about whether
 * any given tenant exists — the beacon's no-oracle contract is preserved.
 *
 * Env-tunable with defensive defaults (same pattern as `SETUP_RATE_LIMIT_*`):
 * a page view fires one beacon per navigation, so 120/min per IP is generous
 * for a real human while still bounding an abusive client.
 */
const COLLECT_RATE_LIMIT_MAX = Number(
  process.env.VISITOR_ANALYTICS_COLLECT_RATE_LIMIT_MAX ?? 120
);
const COLLECT_RATE_LIMIT_WINDOW_SEC = Number(
  process.env.VISITOR_ANALYTICS_COLLECT_RATE_LIMIT_WINDOW_SEC ?? 60
);

/**
 * `POST /api/v1/analytics/collect` — additive, PUBLIC (anonymous, no auth)
 * visit-ingest beacon. This is this base's replacement for awcms-micro's
 * middleware collector: `src/middleware.ts` is intentionally UNTOUCHED (its
 * login/Turnstile/CSP guarantees are unchanged), so collection is an opt-in,
 * client-driven beacon instead of a server-side per-request hook.
 *
 * The beacon carries the public tenant code (resolved against the RLS-free
 * `awcms_tenants` table, ADR-0009 — exactly like the `/blog/{tenantCode}`
 * public routes, so no SECURITY DEFINER is needed) plus the page path it is
 * reporting. Every identifier stored is derived server-side and privacy-
 * preserving: IP/user-agent come from the request's own headers (never the
 * body) and are stored only as salted HMAC hashes; the visitor key is an
 * anonymous cookie; `identity_id`/`login_identifier_snapshot` are always
 * null (anonymous-only).
 *
 * HARDENING beyond awcms-micro: an anonymous beacon cannot prove it is an
 * admin/API request, so this endpoint records `public`-area page views ONLY
 * — a beacon reporting an `/admin` or `/api` path is accepted but not
 * recorded (prevents an anonymous client polluting admin/api analytics). A
 * per-IP fixed-window rate limit (the shared `checkRateLimit` backstop, keyed
 * on the client IP only) fronts every database write, so a client holding a
 * public `tenantCode` cannot flood unbounded rows or poison a tenant's
 * aggregates; a `path` longer than `MAX_PATH_LENGTH` is rejected before storage.
 *
 * Always returns 202 for a well-formed request whether or not anything was
 * actually recorded (module disabled, unknown/inactive tenant, non-public or
 * non-trackable path) — fire-and-forget beacon semantics that never leak
 * tenant existence. `collectVisitorTelemetry` is itself fail-open.
 *
 * CROSS-ORIGIN (Issue #637): a static `awcms-astro` build on its own domain can
 * call this, but ONLY as JSON — `security.checkOrigin` still answers 403 to a
 * `text/plain` body, which is what `navigator.sendBeacon` sends. The supported
 * call is therefore:
 *
 * ```js
 * fetch("https://cms.example/api/v1/analytics/collect", {
 *   method: "POST",
 *   headers: { "content-type": "application/json" },
 *   credentials: "include",           // the anonymous visitor-key cookie
 *   keepalive: true,
 *   body: JSON.stringify({ tenantCode, path: location.pathname })
 * });
 * ```
 *
 * `credentials: "include"` is what makes repeat visits from one reader count as
 * one visitor; see `resolveVisitorCookieSameSite` for what it can and cannot
 * promise. The `Origin` must be an active domain in `awcms_tenant_domains` —
 * see `domain/beacon-cors.ts` for why that check is not, and does not replace,
 * the `tenantCode` validation below.
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  locals
}) => {
  const config = resolveVisitorAnalyticsConfig();
  const existingVisitorKey = cookies.get(VISITOR_KEY_COOKIE_NAME)?.value;
  const parsedOrigin = parseBeaconOrigin(request.headers.get("origin"));
  const crossOrigin = isCrossOriginBeacon(parsedOrigin, request.url);

  /**
   * The per-IP limiter, consumed AT MOST ONCE per request no matter how many
   * call sites reach for it.
   *
   * The binding rule this preserves is the one the constant above states: the
   * limiter runs before ANY database work. Issue #637 added a second piece of
   * database work (the cross-origin allow-list lookup) that happens earlier
   * than the tenant lookup, so the check had to move ahead of it — without
   * charging a cross-origin beacon twice for one request, and without charging
   * a same-origin beacon that never reaches the database at all.
   */
  let rateLimitDecision: Awaited<
    ReturnType<typeof checkSharedRateLimit>
  > | null = null;
  const consumeRateLimit = async () => {
    rateLimitDecision ??= await checkSharedRateLimit(
      `analytics-collect:${resolveClientIp(request, clientAddress)}`,
      {
        maxAttempts:
          Number.isFinite(COLLECT_RATE_LIMIT_MAX) && COLLECT_RATE_LIMIT_MAX > 0
            ? COLLECT_RATE_LIMIT_MAX
            : 120,
        windowMs:
          (Number.isFinite(COLLECT_RATE_LIMIT_WINDOW_SEC) &&
          COLLECT_RATE_LIMIT_WINDOW_SEC > 0
            ? COLLECT_RATE_LIMIT_WINDOW_SEC
            : 60) * 1000
      }
    );
    return rateLimitDecision;
  };

  // Refused cross-origin, and every same-origin request, carry `Vary: Origin`
  // and no grant. Only a verified tenant domain upgrades this.
  let corsHeaders = beaconCorsDeniedHeaders();

  /**
   * Stamps the decision above onto a response that was built without knowing
   * about it. EVERY exit from this handler goes through here — including the
   * ones that refuse — because a response whose headers vary by `Origin` has to
   * say so whichever way the decision went.
   */
  const withCors = (response: Response): Response => {
    for (const [name, value] of Object.entries(corsHeaders)) {
      response.headers.set(name, value);
    }
    return response;
  };

  if (crossOrigin && parsedOrigin) {
    const preflightBudget = await consumeRateLimit();

    if (!preflightBudget.allowed) {
      return fail(
        429,
        "RATE_LIMITED",
        "Too many analytics beacons from this source. Try again later.",
        {},
        undefined,
        { ...corsHeaders, "retry-after": String(preflightBudget.retryAfterSec) }
      );
    }

    const originTenant = await resolvePublicTenantByHost(
      getDatabaseClient(),
      parsedOrigin.hostname
    );

    if (originTenant) {
      corsHeaders = beaconCorsResponseHeaders(parsedOrigin.origin);
    }
  }

  // Revoke a lingering anonymous identifier when the module is disabled —
  // before doing anything else, on every request, regardless of body shape.
  if (
    shouldRevokeVisitorKeyCookie({ config, existingValue: existingVisitorKey })
  ) {
    cookies.delete(VISITOR_KEY_COOKIE_NAME, { path: "/" });
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return withCors(bodyTooLargeResponse(bodyRead.limitBytes));
  }

  const body = bodyRead.value as Record<string, unknown> | null;
  const tenantCode =
    typeof body?.tenantCode === "string" ? body.tenantCode.trim() : "";
  const path = typeof body?.path === "string" ? body.path.trim() : "";
  const referrer = typeof body?.referrer === "string" ? body.referrer : null;

  if (
    tenantCode.length === 0 ||
    tenantCode.length > 128 ||
    !path.startsWith("/") ||
    path.length > MAX_PATH_LENGTH
  ) {
    return withCors(
      fail(
        400,
        "VALIDATION_ERROR",
        "tenantCode (non-empty, <=128 chars) and path (must start with '/', <=2048 chars) are required."
      )
    );
  }

  const accepted = () =>
    withCors(
      jsonResponse(
        { success: true, data: { accepted: true }, meta: {} },
        { status: 202 }
      )
    );

  // Nothing to record: module off, non-public area, or a non-trackable path.
  // Still 202 (accepted) — never distinguish these cases to the caller.
  if (!config.enabled) {
    return accepted();
  }

  const area = determineArea(path.split("?")[0] ?? path);
  if (area !== "public" || !config.collectPublic || !isTrackablePath(path)) {
    return accepted();
  }

  // Per-IP rate-limit backstop — checked here, AFTER the free (no-DB) filters
  // above but BEFORE any database work (the tenant lookup and the session/event
  // write below). Keyed on the client IP only, so it can never distinguish an
  // existing tenant from an unknown one (no enumeration oracle); a source that
  // exceeds the window is refused with 429 before it can touch the database.
  const rateLimit = await consumeRateLimit();

  if (!rateLimit.allowed) {
    return withCors(
      fail(
        429,
        "RATE_LIMITED",
        "Too many analytics beacons from this source. Try again later.",
        {},
        undefined,
        { "retry-after": String(rateLimit.retryAfterSec) }
      )
    );
  }

  const sql = getDatabaseClient();
  const tenant = await resolvePublicTenantByCode(sql, tenantCode);

  if (!tenant) {
    return accepted();
  }

  // Anonymous visitor key: reuse a valid existing cookie or mint a fresh one,
  // and (re)set the cookie so it persists for dedup. A cross-origin beacon
  // needs `SameSite=None` for the browser to keep it at all — and that is only
  // legal alongside `Secure`, so a plain-http deployment keeps `Lax` and keeps
  // minting fresh keys. `resolveVisitorCookieSameSite` carries the reasoning.
  const cookieSecure = process.env.AUTH_COOKIE_SECURE === "true";
  const cookiePlan = planVisitorKeyCookie({
    config,
    existingValue: existingVisitorKey
  });

  if (cookiePlan.shouldSetCookie) {
    cookies.set(VISITOR_KEY_COOKIE_NAME, cookiePlan.value, {
      httpOnly: true,
      sameSite: resolveVisitorCookieSameSite({
        crossOrigin,
        secure: cookieSecure
      }),
      secure: cookieSecure,
      path: "/",
      maxAge: cookiePlan.maxAgeSeconds
    });
  }

  const ipAddress = resolveAnalyticsClientIp(request, clientAddress, {
    trustProxy: config.trustProxy,
    trustCloudflare: config.trustCloudflare
  });
  const geo = resolveGeoEnrichment(request, {
    geoEnabled: config.geoEnabled,
    trustCloudflare: config.trustCloudflare
  });

  await collectVisitorTelemetry({
    sql,
    tenantId: tenant.tenantId,
    correlationId: locals.correlationId,
    config,
    // A page view is a navigation (GET); the beacon POST itself is transport.
    method: "GET",
    rawPath: path,
    statusCode: null,
    visitorKey: cookiePlan.value,
    ipAddress,
    userAgent: request.headers.get("user-agent"),
    referrerHeader: referrer ?? request.headers.get("referer"),
    isAuthenticated: false,
    identityId: null,
    geo
  });

  return accepted();
};

/**
 * `OPTIONS /api/v1/analytics/collect` — the CORS preflight (Issue #637).
 *
 * A preflight carries NO BODY, so this handler cannot know which `tenantCode`
 * the POST that follows will name. It answers the only question it can: is this
 * `Origin` an active, verified domain of SOME tenant on this deployment
 * (`awcms_tenant_domains`, via the same SECURITY DEFINER lookup the public host
 * router uses)? The POST then validates `tenantCode` exactly as it always has.
 * CORS is not authorization — see `domain/beacon-cors.ts`.
 *
 * Every outcome is `204`. What differs is whether the response carries the
 * grant headers, because that is the one thing CORS cannot hide: a browser
 * proceeds only when it sees `Access-Control-Allow-Origin`. That is not a new
 * disclosure — visiting the hostname already serves that tenant's site, so
 * "this host belongs to a tenant here" is public by construction.
 *
 * `OPTIONS` is in Astro's `SAFE_METHODS`, so `security.checkOrigin` lets the
 * preflight through untouched; only the POST it authorizes is subject to the
 * form-like content-type rule.
 */
export const OPTIONS: APIRoute = async ({ request, clientAddress }) => {
  const parsedOrigin = parseBeaconOrigin(request.headers.get("origin"));

  // No `Origin`, an opaque one, or our own: nothing to preflight. `Vary` still
  // goes out — this response WOULD have differed for a different origin.
  if (!isCrossOriginBeacon(parsedOrigin, request.url) || !parsedOrigin) {
    return new Response(null, {
      status: 204,
      headers: beaconCorsDeniedHeaders()
    });
  }

  // The allow-list lookup is a database read on an anonymous, unauthenticated
  // request, so it sits behind the same per-IP limiter the POST uses — same
  // key, so a preflight and the POST it precedes share one budget rather than
  // doubling it. `Access-Control-Max-Age` keeps that from mattering in practice.
  const preflightBudget = await checkSharedRateLimit(
    `analytics-collect:${resolveClientIp(request, clientAddress)}`,
    {
      maxAttempts:
        Number.isFinite(COLLECT_RATE_LIMIT_MAX) && COLLECT_RATE_LIMIT_MAX > 0
          ? COLLECT_RATE_LIMIT_MAX
          : 120,
      windowMs:
        (Number.isFinite(COLLECT_RATE_LIMIT_WINDOW_SEC) &&
        COLLECT_RATE_LIMIT_WINDOW_SEC > 0
          ? COLLECT_RATE_LIMIT_WINDOW_SEC
          : 60) * 1000
    }
  );

  if (!preflightBudget.allowed) {
    return new Response(null, {
      status: 429,
      headers: {
        ...beaconCorsDeniedHeaders(),
        "retry-after": String(preflightBudget.retryAfterSec)
      }
    });
  }

  const originTenant = await resolvePublicTenantByHost(
    getDatabaseClient(),
    parsedOrigin.hostname
  );

  return new Response(null, {
    status: 204,
    headers: originTenant
      ? beaconPreflightHeaders(parsedOrigin.origin)
      : beaconCorsDeniedHeaders()
  });
};
