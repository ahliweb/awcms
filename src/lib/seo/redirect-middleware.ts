/**
 * Middleware composition root for public redirect resolution + 404 governance
 * (ADR-0039; adapted from awcms-micro ADR-0028 §8). `src/middleware.ts` cannot be
 * unit-tested (it imports the `astro:middleware` virtual module), so the wiring lives
 * HERE — a plain, importable module that assembles the `seo_distribution` resolution
 * service with the DB client and turns its plain data outcome into a real `Response`.
 *
 * The eligibility gate (`isRedirectEligiblePath`) is applied HERE, first — a tenant
 * redirect can never intercept admin/API/auth/static/system/discovery paths, and
 * this module is where that guarantee is enforced before any tenant/rule lookup
 * happens.
 *
 * `src/lib/seo/` importing a module's application code is the established pattern for
 * SEO composition roots (`discovery-route.ts` / `discovery-providers.ts`).
 */
import { getDatabaseClient } from "../database/client";
import { withTenant } from "../database/tenant-context";
import { log } from "../logging/logger";
import { isRedirectEligiblePath } from "../../modules/seo-distribution/domain/redirect-eligibility";
import {
  resolvePublicRedirect,
  type NotFoundCaptureContext
} from "../../modules/seo-distribution/application/redirect-resolution-service";
import { recordNotFoundObservation } from "../../modules/seo-distribution/application/not-found-directory";
import { extractReferrerDomain } from "../../modules/visitor-analytics/domain/referrer";
import type { RedirectStatusCode } from "../../modules/seo-distribution/domain/redirect-rule";

export type { NotFoundCaptureContext };

export type MiddlewareRedirectResult =
  { redirect: Response } | { capture: NotFoundCaptureContext } | null;

const isPermanent = (status: RedirectStatusCode): boolean =>
  status === 301 || status === 308;

/**
 * Build the redirect `Response` (no body). Permanent redirects (301/308) are
 * cacheable for an hour; temporary redirects (302/307) are `no-store` so a client
 * or CDN never caches a redirect that is meant to change. The middleware layers its
 * standard correlation-id + security headers on top afterwards.
 */
export function buildRedirectResponse(
  status: RedirectStatusCode,
  location: string
): Response {
  return new Response(null, {
    status,
    headers: {
      location,
      "cache-control": isPermanent(status) ? "public, max-age=3600" : "no-store"
    }
  });
}

/**
 * Resolve a public redirect for a request. Returns `{ redirect }` to send, or
 * `{ capture }` (tenant resolved, no redirect) so the caller can observe a
 * subsequent 404, or `null` (not eligible / no tenant / error). Never throws.
 *
 * awcms has NO i18n/locale seam (ADR-0039), so `locale` is always `null` here — the
 * parameter is kept for signature parity with awcms-micro and a future locale port.
 */
export async function resolvePublicRedirectForRequest(
  request: Request,
  url: URL,
  locale: string | null
): Promise<MiddlewareRedirectResult> {
  if (!isRedirectEligiblePath(url.pathname)) {
    return null;
  }

  // Perf note: `resolvePublicRedirect` runs a full `withTenant` transaction
  // (module-enabled + allowedHosts + primaryHost + a chain point lookup) on EVERY
  // eligible public request, even for tenants with zero active rules. A cheap "does
  // this tenant have any live rule?" short-circuit is deliberately NOT applied here
  // because it is not correctness-safe: the passthrough branch still needs the
  // server-derived host to attribute a 404 observation, and the legacy-blog
  // auto-redirect fires from settings, not a rule row. Deferred as a tracked perf
  // follow-up rather than risk missing a live rule / serving a deleted one.
  try {
    const sql = getDatabaseClient();
    const resolution = await resolvePublicRedirect(sql, request, {
      pathname: url.pathname,
      search: url.search,
      locale
    });

    if (resolution.kind === "redirect") {
      return {
        redirect: buildRedirectResponse(resolution.status, resolution.location)
      };
    }

    if (resolution.kind === "passthrough" && resolution.capture) {
      return { capture: resolution.capture };
    }

    return null;
  } catch (error) {
    log("warning", "seo_distribution.redirect.middleware_failed", {
      moduleKey: "seo_distribution",
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Record a privacy-minimized 404 observation for a request that resolved to a
 * tenant but 404'd. Only a sanitized path (already query-free) and a bare referrer
 * DOMAIN are stored. Best-effort: never throws, never delays the response beyond
 * its own await (called after the response is already produced).
 */
export async function recordPublicNotFound(
  request: Request,
  capture: NotFoundCaptureContext
): Promise<void> {
  try {
    const sql = getDatabaseClient();
    const referrerDomain = extractReferrerDomain(
      request.headers.get("referer")
    );

    await withTenant(sql, capture.tenantId, async (tx) => {
      await recordNotFoundObservation(tx, capture.tenantId, {
        normalizedPath: capture.normalizedPath,
        referrerDomain,
        locale: capture.locale,
        domainHost: capture.domainHost,
        at: new Date()
      });
    });
  } catch (error) {
    log("warning", "seo_distribution.not_found.capture_failed", {
      moduleKey: "seo_distribution",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
