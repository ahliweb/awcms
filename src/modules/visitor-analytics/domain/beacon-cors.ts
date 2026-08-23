/**
 * Cross-origin policy for the PUBLIC visit-ingest beacon (Issue #637).
 *
 * ## What was actually broken
 *
 * `POST /api/v1/analytics/collect` is anonymous, rate-limited and always
 * answers `202`. It was built to be called from a public page. When that public
 * page is a static `awcms-astro` build on a DIFFERENT origin — the PRD §27.1
 * scenario — all three ways of calling it were blocked, and none of the
 * failures appeared in this repo's logs:
 *
 * 1. `navigator.sendBeacon(url, blob)` — the canonical beacon call. Its blob
 *    carries `text/plain`, which IS in Astro's `FORM_CONTENT_TYPES`, so a
 *    cross-origin call is answered `403 Cross-site POST form submissions are
 *    forbidden` by `security.checkOrigin`.
 * 2. `fetch` with NO `content-type` — falls into `return !isSameOrigin`. Also
 *    403.
 * 3. `fetch` with `application/json` — passes `checkOrigin` (not form-like),
 *    but the browser sends a preflight `OPTIONS` first, and nothing here
 *    answered it.
 *
 * This module closes **path 3**, deliberately and only path 3. Paths 1 and 2
 * stay blocked: `security.checkOrigin` protects every other write in this repo,
 * Astro installs it AHEAD of `src/middleware.ts`
 * (`core/middleware/load.js` unshifts it), so it cannot be exempted per-route
 * from inside the app, and turning it off globally to rescue `sendBeacon` would
 * trade a repo-wide guarantee for one endpoint's convenience.
 *
 * The consequence is a real constraint on the caller and is stated in the
 * endpoint's docblock: the beacon must be sent as JSON, which means `fetch`,
 * not `sendBeacon`.
 *
 * ## CORS is not authorization
 *
 * A preflight carries NO BODY, so an `OPTIONS` handler cannot know which
 * `tenantCode` the eventual POST will name. It therefore answers a narrower
 * question — "is this `Origin` an active, verified domain of SOME tenant on
 * this deployment" — and the POST goes on validating `tenantCode` exactly as it
 * did before. Neither check substitutes for the other: this one decides whether
 * a browser may read our answer, that one decides whose analytics a row belongs
 * to.
 *
 * That distinction is easy to lose later, which is why it is written here
 * rather than inferred from the code.
 *
 * ## Never `*`
 *
 * The allowed origin is always echoed verbatim from a value that resolved
 * against `awcms_tenant_domains`. `*` would let any page on the internet write
 * to the beacon with a public tenant code, and — because the beacon needs its
 * anonymous visitor cookie — `*` is not even legal alongside
 * `Access-Control-Allow-Credentials: true`.
 *
 * ## `Vary: Origin` on EVERY response
 *
 * Including the ones that carry no `Access-Control-Allow-Origin`. A cached
 * denial served to an allowed origin is the same defect as a cached grant
 * served to a denied one. This endpoint is not cached today; a header whose
 * value depends on the request and does not say so is a defect waiting for the
 * next cache change.
 *
 * ## Where the `Origin` parser went
 *
 * `parseBeaconOrigin`/`isCrossOriginBeacon` used to live here. ADR-0107 gave
 * the public search endpoints the same cross-origin need, so the two pure
 * functions moved to `lib/security/request-origin.ts` — unchanged, and with
 * their reasoning — rather than being copied. A security parser is the worst
 * place in a codebase to keep two of: the copy nobody hardens is the one an
 * attacker finds. What stays here is what is genuinely the BEACON's:
 * credentials, a preflight, and a cookie `SameSite`.
 */

/**
 * How long a browser may reuse one preflight result. Ten minutes: long enough
 * that a reader clicking through a news site pays for the preflight once, short
 * enough that removing a domain from `awcms_tenant_domains` takes effect while
 * somebody is still watching.
 */
export const BEACON_PREFLIGHT_MAX_AGE_SECONDS = 600;

/**
 * Headers for a granted cross-origin ACTUAL request (the POST itself).
 *
 * `Access-Control-Allow-Credentials` is on because the beacon's anonymous
 * visitor key is an `httpOnly` cookie: without credentials the browser would
 * neither send the existing cookie nor store the new one, and every page view
 * from every reader would look like a first-ever visit.
 */
export function beaconCorsResponseHeaders(
  allowedOrigin: string
): Record<string, string> {
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-credentials": "true",
    vary: "Origin"
  };
}

/**
 * Headers for a granted preflight, which is the same grant plus the three
 * things a preflight is actually asking about.
 *
 * `access-control-allow-headers` lists `content-type` alone, and that is the
 * whole point of the path this module opens: `content-type: application/json`
 * is what keeps the request out of Astro's form-like branch. No other header is
 * allowed, so this cannot quietly become a general-purpose cross-origin API.
 */
export function beaconPreflightHeaders(
  allowedOrigin: string
): Record<string, string> {
  return {
    ...beaconCorsResponseHeaders(allowedOrigin),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": String(BEACON_PREFLIGHT_MAX_AGE_SECONDS)
  };
}

/**
 * Headers for a REFUSED cross-origin request, and for one that never asked.
 *
 * There is no `Access-Control-Allow-Origin` here — that is the refusal — but
 * `Vary: Origin` still is, because the refusal is as origin-dependent as the
 * grant.
 */
export function beaconCorsDeniedHeaders(): Record<string, string> {
  return { vary: "Origin" };
}

/**
 * `SameSite` for the anonymous visitor-key cookie.
 *
 * A `SameSite=Lax` cookie is neither sent nor stored on a cross-site request,
 * so a cross-origin beacon would mint a fresh visitor key on every single page
 * view and unique-visitor counts would climb with page views. `None` is what
 * makes the key persist — and browsers refuse `SameSite=None` without `Secure`,
 * so over plain `http` this falls back to `Lax` rather than emitting a cookie
 * the browser will drop.
 *
 * What this does NOT promise: a browser that blocks third-party cookies
 * outright (Safari's ITP, and Chrome by default for many users) will drop this
 * cookie regardless. Cross-origin visitor keys are best-effort, page-view
 * counts are not. The honest alternative — letting the client send its own
 * identifier in the body — is deliberately refused: every identifier this
 * endpoint stores is derived server-side, and a body-supplied one would be a
 * value the reporter chooses.
 */
export function resolveVisitorCookieSameSite(input: {
  crossOrigin: boolean;
  secure: boolean;
}): "lax" | "none" {
  return input.crossOrigin && input.secure ? "none" : "lax";
}
