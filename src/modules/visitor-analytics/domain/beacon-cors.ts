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
 */

/**
 * How long a browser may reuse one preflight result. Ten minutes: long enough
 * that a reader clicking through a news site pays for the preflight once, short
 * enough that removing a domain from `awcms_tenant_domains` takes effect while
 * somebody is still watching.
 */
export const BEACON_PREFLIGHT_MAX_AGE_SECONDS = 600;

export type BeaconOrigin = {
  /** The origin exactly as it will be echoed back, e.g. `https://news.example`. */
  origin: string;
  /** Its hostname, lowercased and port-free — the `awcms_tenant_domains` key. */
  hostname: string;
};

/**
 * Parses an `Origin` request header into something safe to look up and echo.
 *
 * Returns `null` — never a partially-trusted value — for everything that is not
 * a plain `http(s)://host[:port]` origin. In particular:
 *
 * - **the literal string `null`**, which is what a sandboxed iframe, a
 *   `file://` document and some redirect chains send. It is an opaque origin,
 *   and echoing it back would hand a document with no origin the same access a
 *   verified tenant domain has;
 * - any non-`http(s)` scheme, so a `chrome-extension://` or `moz-extension://`
 *   page cannot be granted access to a tenant's analytics endpoint;
 * - anything carrying a path, query, fragment or userinfo. A real `Origin`
 *   header has none of those, so rather than strip them, this requires the
 *   header to be EQUAL to the parsed origin — one comparison that rejects every
 *   such shape at once, including the ones nobody has thought of yet.
 */
export function parseBeaconOrigin(
  originHeader: string | null | undefined
): BeaconOrigin | null {
  if (typeof originHeader !== "string") {
    return null;
  }

  const trimmed = originHeader.trim();

  if (trimmed.length === 0 || trimmed === "null") {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  // A well-formed `Origin` serializes back to itself. Anything that does not —
  // a trailing slash, a path, credentials, a query — is not an origin.
  //
  // The comparison is against the LOWERCASED header because scheme and host are
  // case-insensitive and `new URL()` has already normalized them; a browser
  // sends them lowercase anyway, and refusing `https://News.Example` would be
  // strictness that protects nothing. What is echoed back is `url.origin`, the
  // normalized form — which is also the form the browser compares against.
  if (url.origin !== trimmed.toLowerCase()) {
    return null;
  }

  if (url.hostname.length === 0) {
    return null;
  }

  return { origin: url.origin, hostname: url.hostname.toLowerCase() };
}

/**
 * True when this request came from a different origin than the one serving it.
 *
 * Same-origin callers — this repo's own `/blog/{tenantCode}` pages — take the
 * unchanged path: no allow-list lookup, no CORS headers, not one extra query.
 * The cost of the cross-origin surface lands only on the cross-origin surface.
 */
export function isCrossOriginBeacon(
  parsedOrigin: BeaconOrigin | null,
  requestUrl: string
): boolean {
  if (!parsedOrigin) {
    return false;
  }

  try {
    return parsedOrigin.origin !== new URL(requestUrl).origin;
  } catch {
    // An unparseable request URL cannot be shown to be same-origin, and the
    // safe reading of "cannot be shown same-origin" is cross-origin: it leads
    // to the allow-list check rather than around it.
    return true;
  }
}

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
