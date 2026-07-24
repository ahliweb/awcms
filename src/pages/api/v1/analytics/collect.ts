import type { APIRoute } from "astro";

import { fail, jsonResponse } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { resolvePublicTenantByCode } from "../../../../lib/tenant/public-tenant-resolver";
import { collectVisitorTelemetry } from "../../../../modules/visitor-analytics/application/collector";
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
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  locals
}) => {
  const config = resolveVisitorAnalyticsConfig();
  const existingVisitorKey = cookies.get(VISITOR_KEY_COOKIE_NAME)?.value;

  // Revoke a lingering anonymous identifier when the module is disabled —
  // before doing anything else, on every request, regardless of body shape.
  if (
    shouldRevokeVisitorKeyCookie({ config, existingValue: existingVisitorKey })
  ) {
    cookies.delete(VISITOR_KEY_COOKIE_NAME, { path: "/" });
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
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
    return fail(
      400,
      "VALIDATION_ERROR",
      "tenantCode (non-empty, <=128 chars) and path (must start with '/', <=2048 chars) are required."
    );
  }

  const accepted = jsonResponse(
    { success: true, data: { accepted: true }, meta: {} },
    { status: 202 }
  );

  // Nothing to record: module off, non-public area, or a non-trackable path.
  // Still 202 (accepted) — never distinguish these cases to the caller.
  if (!config.enabled) {
    return accepted;
  }

  const area = determineArea(path.split("?")[0] ?? path);
  if (area !== "public" || !config.collectPublic || !isTrackablePath(path)) {
    return accepted;
  }

  // Per-IP rate-limit backstop — checked here, AFTER the free (no-DB) filters
  // above but BEFORE any database work (the tenant lookup and the session/event
  // write below). Keyed on the client IP only, so it can never distinguish an
  // existing tenant from an unknown one (no enumeration oracle); a source that
  // exceeds the window is refused with 429 before it can touch the database.
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = checkRateLimit(`analytics-collect:${clientIp}`, {
    maxAttempts:
      Number.isFinite(COLLECT_RATE_LIMIT_MAX) && COLLECT_RATE_LIMIT_MAX > 0
        ? COLLECT_RATE_LIMIT_MAX
        : 120,
    windowMs:
      (Number.isFinite(COLLECT_RATE_LIMIT_WINDOW_SEC) &&
      COLLECT_RATE_LIMIT_WINDOW_SEC > 0
        ? COLLECT_RATE_LIMIT_WINDOW_SEC
        : 60) * 1000
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many analytics beacons from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const sql = getDatabaseClient();
  const tenant = await resolvePublicTenantByCode(sql, tenantCode);

  if (!tenant) {
    return accepted;
  }

  // Anonymous visitor key: reuse a valid existing cookie or mint a fresh one,
  // and (re)set the cookie so it persists for dedup.
  const cookiePlan = planVisitorKeyCookie({
    config,
    existingValue: existingVisitorKey
  });

  if (cookiePlan.shouldSetCookie) {
    cookies.set(VISITOR_KEY_COOKIE_NAME, cookiePlan.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.AUTH_COOKIE_SECURE === "true",
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

  return accepted;
};
