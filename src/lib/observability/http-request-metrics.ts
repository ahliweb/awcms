/**
 * HTTP request count and latency (Issue #1287) — the single recording point.
 *
 * `http_requests_total` and `http_request_duration_ms` were declared in
 * `METRIC_DEFINITIONS` but nothing recorded them, so the p95 targets in the
 * performance NFRs could not be measured. `src/middleware.ts` now wraps its whole
 * request handler in `instrumentHttpRequest`, which is the one chokepoint every
 * response (rendered, redirected, rejected early, or thrown) passes through.
 *
 * ## Labels are bounded here, not trusted
 *
 * - `method` is one of the nine standard methods, else `OTHER`.
 * - `routePattern` is Astro's static route pattern (`/blog/[tenantCode]/[slug]`),
 *   never the request URL. It is still screened: anything that is not an
 *   absolute pattern, carries a query or fragment, or has an id-shaped segment (a
 *   UUID or a long digit run) collapses to `unmatched`, so a bug upstream cannot
 *   turn a tenant id or a user id into a label. A request that matched no route
 *   has no pattern and is also `unmatched`.
 * - `statusCode` is the numeric HTTP status as a string; a thrown error that
 *   escaped the handler is recorded as `500` and rethrown unchanged.
 *
 * The default metrics port is a no-op, so a deployment that registers no adapter
 * pays only for building two small label objects.
 */
import { recordCounter, recordHistogram } from "./metrics-port";

const STANDARD_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE"
]);

export const UNMATCHED_ROUTE_PATTERN = "unmatched";

const MAX_PATTERN_LENGTH = 200;
const UUID_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-/i;
const LONG_DIGIT_RUN = /\d{6,}/;

export function normalizeMethodLabel(method: string): string {
  const upper = method.toUpperCase();

  return STANDARD_METHODS.has(upper) ? upper : "OTHER";
}

export function normalizeRoutePatternLabel(
  routePattern: string | null | undefined
): string {
  if (
    !routePattern ||
    !routePattern.startsWith("/") ||
    routePattern.length > MAX_PATTERN_LENGTH ||
    /[?#\s]/.test(routePattern) ||
    UUID_SEGMENT.test(routePattern) ||
    LONG_DIGIT_RUN.test(routePattern)
  ) {
    return UNMATCHED_ROUTE_PATTERN;
  }

  return routePattern;
}

export function normalizeStatusLabel(status: number): string {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? String(status)
    : "500";
}

export type HttpRequestMetricInput = {
  method: string;
  routePattern: string | null | undefined;
  status: number;
  durationMs: number;
};

export function recordHttpRequestMetrics(input: HttpRequestMetricInput): void {
  const method = normalizeMethodLabel(input.method);
  const routePattern = normalizeRoutePatternLabel(input.routePattern);

  recordCounter("http_requests_total", {
    method,
    routePattern,
    statusCode: normalizeStatusLabel(input.status)
  });
  recordHistogram("http_request_duration_ms", input.durationMs, {
    method,
    routePattern
  });
}

/**
 * Run a request handler and record its outcome. A response of any status is
 * recorded with its own status; a thrown error is recorded as 500 and rethrown
 * so the framework's error handling is unchanged.
 */
export async function instrumentHttpRequest(
  request: { method: string; routePattern: string | null | undefined },
  run: () => Promise<Response>,
  now: () => number = () => performance.now()
): Promise<Response> {
  const startedAt = now();

  try {
    const response = await run();

    recordHttpRequestMetrics({
      method: request.method,
      routePattern: request.routePattern,
      status: response.status,
      durationMs: now() - startedAt
    });

    return response;
  } catch (error) {
    recordHttpRequestMetrics({
      method: request.method,
      routePattern: request.routePattern,
      status: 500,
      durationMs: now() - startedAt
    });

    throw error;
  }
}
