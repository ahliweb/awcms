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
import { getDatabaseClient } from "../../../lib/database/client";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { isRedirectEligiblePath } from "../domain/redirect-eligibility";
import {
  resolvePublicRedirect,
  type NotFoundCaptureContext
} from "../application/redirect-resolution-service";
import { recordNotFoundObservation } from "../application/not-found-directory";
import { extractReferrerDomain } from "../../_shared/referrer";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../lib/security/rate-limit";
import type { RedirectStatusCode } from "../domain/redirect-rule";

export type { NotFoundCaptureContext };

/**
 * Per-IP rate-limit backstop for the 404 observation write (Issue #722).
 *
 * This is a PUBLIC, unauthenticated database write — one `INSERT … ON CONFLICT`
 * per 404 — and its aggregation key is `(tenant, normalized_path,
 * referrer_domain, locale, domain_host)`, of which the caller controls the
 * first two freely: the path is whatever they request (up to the 2048
 * `normalizeRedirectPath` allows) and `referrer_domain` is the hostname of
 * whatever `Referer` header they send. So `/a1`, `/a2`, … `/aN` is N rows, and
 * each one can be multiplied again by varying `Referer`.
 *
 * `POST /api/v1/analytics/collect` is the same kind of endpoint — public,
 * anonymous, one row per request — and it has had exactly this backstop since
 * it shipped, for a threat its own comment states in terms that transfer here
 * word for word: *"anyone holding a public tenantCode could flood the endpoint
 * with unbounded session/event writes and poison a tenant's aggregates."* This
 * path had no equivalent.
 *
 * Keyed on IP ONLY, never the tenant: the decision is driven purely by request
 * volume from one source and reveals nothing about whether any tenant exists.
 * Nothing is refused to the visitor either — the 404 response has already been
 * produced and returned unchanged; only the telemetry write is skipped.
 *
 * 120/min matches the beacon's default. A reader 404s rarely, so this bounds an
 * abusive client while leaving real traffic untouched. A fast crawler after a
 * cutover can exceed it, which is accepted: the first 120 missing rules a
 * minute tell an operator the same thing the next 5,000 would, and
 * `blog:legacy:cutover:verify` is the purpose-built check for that question
 * rather than incidental telemetry.
 */
const NOT_FOUND_RATE_LIMIT_MAX = Number(
  process.env.SEO_NOT_FOUND_RATE_LIMIT_MAX ?? 120
);
const NOT_FOUND_RATE_LIMIT_WINDOW_SEC = Number(
  process.env.SEO_NOT_FOUND_RATE_LIMIT_WINDOW_SEC ?? 60
);

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
 * `locale` is the SERVED locale for a prefixed URL (`/id/…`) and `null` for a
 * bare one. This used to say it was always `null` "for signature parity with a
 * future locale port" — true under ADR-0039, false since ADR-0098's locale
 * routing landed and made the middleware pass a real value. Corrected 22 August
 * 2026; the parameter is live, not vestigial.
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
 *
 * Rate-limited per client IP (`NOT_FOUND_RATE_LIMIT_MAX`) — see that constant
 * for why a public write path needs one. Over budget, the observation is
 * dropped silently: the visitor's 404 has already been produced and is returned
 * unchanged either way, so refusing here would only mean refusing to write
 * telemetry, which is what dropping it already does.
 */
export async function recordPublicNotFound(
  request: Request,
  capture: NotFoundCaptureContext,
  clientAddress?: string
): Promise<void> {
  try {
    const budget = await checkSharedRateLimit(
      `seo-not-found:${resolveClientIp(request, clientAddress)}`,
      {
        maxAttempts:
          Number.isFinite(NOT_FOUND_RATE_LIMIT_MAX) &&
          NOT_FOUND_RATE_LIMIT_MAX > 0
            ? NOT_FOUND_RATE_LIMIT_MAX
            : 120,
        windowMs:
          (Number.isFinite(NOT_FOUND_RATE_LIMIT_WINDOW_SEC) &&
          NOT_FOUND_RATE_LIMIT_WINDOW_SEC > 0
            ? NOT_FOUND_RATE_LIMIT_WINDOW_SEC
            : 60) * 1000
      }
    );

    if (!budget.allowed) {
      // Not a warning: being over budget is the mechanism working, and logging
      // per refused write would hand the same flood a second amplifier.
      return;
    }

    const sql = getDatabaseClient();
    const referrerDomain = extractReferrerDomain(
      request.headers.get("referer")
    );

    // `withTenantOrThrow`, because this result is DISCARDED. `withTenant`
    // would hand back a `503` that a bare `await` throws away, and the 404
    // observation would go unrecorded with nothing said about it — the same
    // silent-drop shape this whole change exists to remove.
    await withTenantOrThrow(sql, capture.tenantId, async (tx) => {
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
