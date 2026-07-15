/**
 * Full correlation ID propagation into JSON response *bodies* (Issue #447).
 *
 * `X-Correlation-ID` has been set as a response *header* for every request
 * since Issue 10.1 (`src/middleware.ts`), but `ApiMeta.correlationId` in the
 * JSON body was only ever wired end-to-end for exactly one demo endpoint
 * (`GET /api/v1/logs/audit`) — every other endpoint's handler never passed
 * `{ correlationId }` as `meta` to `ok()`/`fail()`.
 *
 * Every `/api/*` handler responds exclusively through the shared `ok`/`fail`
 * helpers (`src/modules/_shared/api-response.ts`), which always emit a
 * `meta` object (defaulting to `{}`) — so patching it in from this one
 * choke point (`src/middleware.ts`, which already runs for *every*
 * response) covers every current and future endpoint without editing
 * dozens of handler files individually. A handler that already sets
 * `meta.correlationId` itself (e.g. the profile lifecycle endpoints, which
 * also thread it into `recordAuditEvent`) is left untouched — this only
 * *fills in* a missing value, it never overwrites one that's already set.
 *
 * Pure body-merge logic is factored out here (no Astro/DB import) so it's
 * unit-testable without a running server, mirroring how
 * `src/lib/security/security-headers.ts` factors pure header-building logic
 * out of `src/middleware.ts` (Issue #437) — `middleware.ts` stays a thin
 * Astro glue layer, the actual logic lives in `src/lib/`.
 */

const API_PATH_PREFIX = "/api/";

/**
 * Whether a response is a candidate for the `meta.correlationId` body merge:
 * under `/api/*` and served as `application/json`. Everything else (HTML
 * admin pages, redirects, static assets) is left completely untouched.
 */
export function isApiJsonResponseCandidate(
  pathname: string,
  contentType: string | null
): boolean {
  return (
    pathname.startsWith(API_PATH_PREFIX) &&
    (contentType ?? "").toLowerCase().includes("application/json")
  );
}

export type CorrelationMergeResult = {
  changed: boolean;
  payload: unknown;
};

/**
 * Merges `correlationId` into `payload.meta.correlationId` if — and only
 * if — `payload` already has the shape every `ok()`/`fail()` response has
 * (`{ ..., meta: {...} }`) and `meta.correlationId` isn't already set.
 * Returns `{ changed: false, payload }` (the original reference, untouched)
 * for anything that doesn't match, so the caller can skip re-serializing a
 * response it doesn't need to touch.
 */
export function mergeCorrelationIdIntoApiPayload(
  payload: unknown,
  correlationId: string
): CorrelationMergeResult {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return { changed: false, payload };
  }

  const meta = (payload as Record<string, unknown>).meta;

  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return { changed: false, payload };
  }

  if ((meta as Record<string, unknown>).correlationId) {
    return { changed: false, payload };
  }

  return {
    changed: true,
    payload: {
      ...(payload as Record<string, unknown>),
      meta: { ...(meta as Record<string, unknown>), correlationId }
    }
  };
}
