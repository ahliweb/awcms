import type { APIRoute } from "astro";

import { fail, jsonResponse } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
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
 * recorded (prevents an anonymous client polluting admin/api analytics).
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

  if (tenantCode.length === 0 || !path.startsWith("/")) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "tenantCode (non-empty) and path (must start with '/') are required."
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
