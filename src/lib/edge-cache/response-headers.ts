/**
 * Translate a `CacheDecision` into response headers — ADR-0042 §7.
 *
 * ## The non-obvious half: marking the NEGATIVE case
 *
 * The interesting work here is not tagging cacheable responses — it is
 * explicitly marking the uncacheable ones. Varnish's built-in VCL caches a `200`
 * that carries no cache directives for `default_ttl` (120s out of the box).
 * So "the app said nothing" does not mean "do not cache"; it means "cache it for
 * two minutes", which for an admin or per-visitor response is a cross-tenant
 * disclosure.
 *
 * Every response that flows through an active edge-cache deployment therefore
 * leaves the origin explicitly labelled: either `Surrogate-Control` (cache this,
 * this long, under these keys) or `Cache-Control: private, no-store` (never).
 * There is no third, silent state.
 *
 * The bundled VCL independently refuses to cache anything without
 * `Surrogate-Control`, so the guarantee survives a bug in this file. Two
 * independent mechanisms, because one of them being wrong is a disclosure.
 *
 * ## Why `Surrogate-Control` and not just `s-maxage`
 *
 * `Surrogate-Control` is consumed and stripped by the cache, so the edge TTL is
 * invisible to browsers and to any downstream CDN. That matters here because the
 * auto-activation ramp makes the edge TTL vary with origin load: leaking a
 * load-dependent number into browser caches would produce visitors holding
 * wildly different copies with no way to invalidate them. Browsers get a
 * separate, stable, conservative directive.
 */
import type { CacheDecision } from "./cacheability";
import { buildSurrogateKeyHeader } from "./surrogate-keys";

export const SURROGATE_CONTROL_HEADER = "Surrogate-Control";
export const SURROGATE_KEY_HEADER = "Surrogate-Key";
/** Debug-only: why a response was not cached. Stripped by the VCL before it reaches a client. */
export const EDGE_CACHE_SKIP_HEADER = "X-Edge-Cache-Skip";

/**
 * What browsers are told when the edge is allowed to cache. `max-age=0,
 * must-revalidate` keeps the *shared* copy hot while making each browser
 * revalidate, so an editor who publishes a change and hard-refreshes sees it as
 * soon as the purge lands rather than waiting out a private browser TTL.
 */
const BROWSER_CACHE_CONTROL = "public, max-age=0, must-revalidate";

/** What browsers and caches are told when the response must never be reused. */
const PRIVATE_CACHE_CONTROL = "private, no-store";

/**
 * Apply the decision to a response, mutating its headers in place and returning
 * it. Mutation (rather than reconstruction) is deliberate: rebuilding a
 * `Response` here would consume and re-wrap the body stream on every public
 * request, which is exactly the overhead this subsystem exists to avoid.
 */
export function applyEdgeCacheHeaders(
  response: Response,
  decision: CacheDecision
): Response {
  if (!decision.cacheable) {
    // Only stamp `private, no-store` when the route has not already expressed
    // its own policy. A route that deliberately set, say, `public, max-age=60`
    // on an asset knows more than this generic guard does — and if it set
    // something private, that is what got us here in the first place.
    if (!response.headers.has("cache-control")) {
      response.headers.set("Cache-Control", PRIVATE_CACHE_CONTROL);
    }

    response.headers.set(EDGE_CACHE_SKIP_HEADER, decision.reason);

    return response;
  }

  // A zero TTL is the resting state of `auto` mode: the surface is legitimately
  // cacheable, the origin simply is not under enough load to want it cached
  // yet. Advertise nothing, and do not mark it private either — the next
  // request may well get a real TTL.
  if (decision.ttlSeconds <= 0) {
    response.headers.set(EDGE_CACHE_SKIP_HEADER, "auto_not_engaged");

    return response;
  }

  response.headers.set(
    SURROGATE_CONTROL_HEADER,
    `max-age=${decision.ttlSeconds}, stale-while-revalidate=${decision.staleWhileRevalidateSeconds}`
  );

  if (decision.surrogateKeys.length > 0) {
    response.headers.set(
      SURROGATE_KEY_HEADER,
      buildSurrogateKeyHeader(decision.surrogateKeys)
    );
  }

  if (!response.headers.has("cache-control")) {
    response.headers.set("Cache-Control", BROWSER_CACHE_CONTROL);
  }

  // Compression negotiation must be part of the cache key or a gzip body can be
  // served to a client that did not ask for one. Appended rather than
  // overwritten so a route's own `Vary` (e.g. on `Accept`) survives.
  appendVary(response.headers, "Accept-Encoding");

  return response;
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("vary");

  if (!existing) {
    headers.set("Vary", value);

    return;
  }

  const present = existing
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (present.includes(value.toLowerCase())) {
    return;
  }

  headers.set("Vary", `${existing}, ${value}`);
}
