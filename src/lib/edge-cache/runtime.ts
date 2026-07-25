/**
 * Edge-cache composition root — the one function `src/middleware.ts` calls.
 *
 * Wires the pure pieces together: config → surface match → tenant resolution →
 * `decideCacheability` → headers, plus feeding the auto-activation tracker.
 *
 * ## The disabled fast path is a hard requirement, not an optimization
 *
 * With `EDGE_CACHE_MODE` unset (the default, and what every existing deployment
 * has), `annotateEdgeCache` returns the response untouched after one boolean
 * check — no allocation, no surface matching, no tenant query, no header
 * writes. ADR-0042 adds a subsystem to the hot path of every public request, so
 * "off" must cost nothing measurable, or the feature is a regression for every
 * operator who has not opted in.
 *
 * ## Memoization
 *
 * Config and the pressure tracker are process singletons. The tracker MUST be a
 * singleton — a per-request tracker observes exactly one request and would never
 * detect sustained load, silently disabling auto mode. `resetEdgeCacheRuntime()`
 * exists for tests, which otherwise leak pressure state between cases.
 */
import {
  isEdgeCacheActive,
  loadEdgeCacheConfig,
  type EdgeCacheConfig,
  type EdgeCacheEnvironment
} from "./config";
import { decideCacheability, type CacheDecision } from "./cacheability";
import { createPressureTracker, type PressureTracker } from "./pressure";
import { applyEdgeCacheHeaders } from "./response-headers";
import { matchPublicCacheSurface } from "./surface-registry";
import { resolveEdgeCacheTenantId } from "./tenant-key";

let cachedConfig: EdgeCacheConfig | null = null;
let cachedTracker: PressureTracker | null = null;

export function getEdgeCacheConfig(
  env?: EdgeCacheEnvironment
): EdgeCacheConfig {
  if (!cachedConfig || env) {
    cachedConfig = loadEdgeCacheConfig(env);
  }

  return cachedConfig;
}

export function getPressureTracker(): PressureTracker {
  if (!cachedTracker) {
    cachedTracker = createPressureTracker(getEdgeCacheConfig());
  }

  return cachedTracker;
}

/** Test seam — drops memoized config and all pressure observations. */
export function resetEdgeCacheRuntime(): void {
  cachedConfig = null;
  cachedTracker = null;
}

export type AnnotateEdgeCacheInput = {
  request: Request;
  pathname: string;
  searchParams: URLSearchParams;
  response: Response;
  /** `locals.edgeCacheTenantId`, published by routes that already resolved it. */
  publishedTenantId: string | null | undefined;
  /** Origin handling time in ms — the auto-activation latency signal. */
  originLatencyMs: number;
  nowMs: number;
};

/**
 * Annotate a public response with edge-cache headers. Returns the same
 * `Response` instance.
 *
 * Never throws: a fault in cache annotation must not break a page that would
 * otherwise have served correctly, so the whole body is guarded and any error
 * leaves the response exactly as the route produced it.
 */
export async function annotateEdgeCache(
  input: AnnotateEdgeCacheInput
): Promise<Response> {
  const config = getEdgeCacheConfig();

  if (!isEdgeCacheActive(config)) {
    return input.response;
  }

  try {
    const tracker = getPressureTracker();

    tracker.record(input.originLatencyMs, input.nowMs);

    const surface = matchPublicCacheSurface(input.pathname);

    // Resolve the tenant only for a path we would actually cache. Doing it
    // before the surface match would put a query in front of every public
    // request, including the ones that are never cacheable.
    const tenantId = surface
      ? await resolveEdgeCacheTenantId(input.pathname, input.publishedTenantId)
      : null;

    const decision: CacheDecision = decideCacheability({
      config,
      method: input.request.method,
      requestHeaders: input.request.headers,
      responseStatus: input.response.status,
      responseHeaders: input.response.headers,
      surface,
      tenantId,
      searchParams: input.searchParams,
      effectiveTtlSeconds: surface
        ? tracker.effectiveTtlSeconds(surface.ttlSeconds, input.nowMs)
        : 0
    });

    return applyEdgeCacheHeaders(input.response, decision);
  } catch {
    // Intentionally silent and non-fatal. Logging here would run on the hot
    // path of every public request and, in the failure mode this guards (a
    // misconfigured or unavailable dependency), would emit one line per
    // request. The subsystem's health is reported by `security:readiness`
    // instead.
    return input.response;
  }
}
