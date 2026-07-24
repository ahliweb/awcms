/**
 * Shared serving pipeline for the public SEO discovery routes (ADR-0038) — the
 * one place that ties together tenant resolution + provider wiring + the
 * discovery service + HTTP cache validators, so each Astro route file
 * (robots.txt, sitemap index/child, RSS/Atom/JSON feed) is a thin delegator.
 *
 * The pipeline, in order:
 * 1. `withSeoPublicTenant` — resolve tenant from the request (server-controlled
 *    host, never the raw `Host`) and gate on `seo_distribution` enabled; every
 *    non-serving outcome collapses to the same generic, latency-normalized 404.
 * 2. `resolveEnabledSeoProviders` — inject the enabled `seo_facts` providers +
 *    media port (composition root; the service never imports a content module).
 * 3. `build(ctx)` — the surface-specific builder produces a `DiscoveryPayload`
 *    (body + ETag + Last-Modified) or `null` (surface disabled / out of range).
 * 4. `finalizeDiscoveryResponse` — apply conditional-request semantics
 *    (`If-None-Match`/`If-Modified-Since` → 304) and the cache headers.
 *
 * Errors never leak: a caught exception logs a generic event and returns the
 * fixed generic error body (no message/stack), same discipline as `/blog/{tenantCode}`.
 */
import { getDatabaseClient } from "../database/client";
import { log } from "../logging/logger";
import { withSeoPublicTenant } from "../../modules/seo-distribution/application/public-seo-tenant-resolution";
import {
  buildDiscoveryCacheControl,
  isNotModified,
  toHttpDate
} from "../../modules/seo-distribution/domain/discovery-cache";
import {
  DISCOVERY_CACHE_MAX_AGE_SECONDS,
  DISCOVERY_CACHE_S_MAXAGE_SECONDS,
  DISCOVERY_STALE_WHILE_REVALIDATE_SECONDS
} from "../../modules/seo-distribution/domain/discovery-limits";
import type {
  DiscoveryPayload,
  SeoDiscoveryContext
} from "../../modules/seo-distribution/application/seo-discovery-service";
import { resolveEnabledSeoProviders } from "./discovery-providers";

/** Build one discovery surface's payload from the resolved, provider-wired context. */
export type DiscoveryBuilder = (
  ctx: SeoDiscoveryContext
) => Promise<DiscoveryPayload | null>;

/** Per-surface fallback responses (right content type for robots/text vs xml vs json). */
export type DiscoveryFallbacks = {
  notFound: () => Response;
  serverError: () => Response;
};

/**
 * A conservative BCP-47-ish locale tag: 2–8 letters, optional `-`-joined
 * subtags. Bounds the `?locale=` query param on feeds so it is a safe cache-key
 * component (it flows into `buildDiscoverySignature`) and a safe SQL filter value
 * — anything else is ignored (treated as "all locales").
 */
const LOCALE_PARAM_PATTERN = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;

/** Validate + normalize an optional `?locale=` query param; `null` (all locales) when absent/invalid. */
export function parseDiscoveryLocaleParam(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 35) return null;
  return LOCALE_PARAM_PATTERN.test(trimmed) ? trimmed : null;
}

/** Apply conditional-request + cache headers to a rendered payload — 304 when the client's copy is current, else 200. */
export function finalizeDiscoveryResponse(
  request: Request,
  payload: DiscoveryPayload
): Response {
  const lastModifiedHttp = toHttpDate(payload.lastModified);
  const headers = new Headers({
    "content-type": payload.contentType,
    etag: payload.etag,
    "last-modified": lastModifiedHttp,
    "cache-control": buildDiscoveryCacheControl(
      DISCOVERY_CACHE_MAX_AGE_SECONDS,
      DISCOVERY_CACHE_S_MAXAGE_SECONDS,
      DISCOVERY_STALE_WHILE_REVALIDATE_SECONDS
    )
  });

  if (isNotModified(request.headers, payload.etag, lastModifiedHttp)) {
    // 304 carries the validators + Cache-Control but no body (RFC 7232 §4.1).
    return new Response(null, { status: 304, headers });
  }

  return new Response(payload.body, { status: 200, headers });
}

/** Run the full discovery pipeline for one surface and return its Response. */
export async function serveDiscovery(
  request: Request,
  logEvent: string,
  build: DiscoveryBuilder,
  fallbacks: DiscoveryFallbacks
): Promise<Response> {
  try {
    const sql = getDatabaseClient();

    const payload = await withSeoPublicTenant(
      sql,
      request,
      async (tx, tenant) => {
        const { providers, mediaLibrary } = await resolveEnabledSeoProviders(
          tx,
          tenant.tenantId
        );

        const ctx: SeoDiscoveryContext = {
          tx,
          tenantId: tenant.tenantId,
          tenantDisplayName: tenant.tenantName,
          defaultLocale: tenant.defaultLocale,
          providers,
          mediaLibrary
        };

        return build(ctx);
      }
    );

    if (!payload) {
      return fallbacks.notFound();
    }

    return finalizeDiscoveryResponse(request, payload);
  } catch (error) {
    log("error", logEvent, {
      moduleKey: "seo_distribution",
      error: error instanceof Error ? error.message : String(error)
    });
    return fallbacks.serverError();
  }
}
