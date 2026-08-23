/**
 * Cross-origin policy for the two PUBLIC search endpoints — ADR-0107.
 *
 * ## What this opens, and what it deliberately does not
 *
 * `GET /api/v1/site-search/query` and `/suggest` are anonymous, per-IP
 * rate-limited and host-resolved. That last part is what stopped a reader on a
 * statically-built `awcms-astro` site from ever using them: the browser sends
 * the request to the CMS host, so the tenant the CMS resolves is the CMS's own
 * default — not the site the reader is standing on — and without CORS the
 * browser would not let the page read the answer anyway.
 *
 * So a cross-origin search request resolves its tenant from the **`Origin`**
 * header instead, against `awcms_tenant_domains`, and the answer is readable
 * only by that same origin. Two consequences worth stating rather than
 * inferring:
 *
 * 1. **A cross-origin request never falls back to the default tenant.** The
 *    host chain (`PUBLIC_DEFAULT_TENANT_ID` -> `PUBLIC_DEFAULT_TENANT_CODE` ->
 *    `awcms_setup_state`) exists so a LAN deployment with one tenant answers
 *    on any hostname. Applied to a cross-origin caller it would mean tenant
 *    A's site displaying the default tenant's articles as its own search
 *    results — a cross-tenant content leak produced by a fallback that is
 *    correct everywhere else. `resolvePublicTenantByHost` is the ONLY resolver
 *    on this path.
 * 2. **The allow-list is the tenant-domain table, not a new env var.** An
 *    origin is granted when it is an `active` domain of an `active` tenant —
 *    the same predicate that decides whether this deployment answers for that
 *    hostname at all. Registering the domain IS the opt-in, so there is no
 *    second switch that can disagree with the first.
 *
 * ## No credentials, and that is load-bearing
 *
 * Search carries no session and needs no cookie, so `Access-Control-Allow-
 * Credentials` is absent. A response without it cannot be read by a
 * credentialed request at all, which means this surface can never become a
 * confused-deputy path to something a reader's cookies would unlock.
 *
 * ## No preflight handler, on purpose
 *
 * A `GET` with only CORS-safelisted headers (`accept`, `accept-language`) is a
 * simple request: the browser sends it directly and no `OPTIONS` is involved.
 * Not answering preflights therefore costs a correct caller nothing, and it
 * keeps the endpoint from quietly acquiring a general-purpose cross-origin
 * surface — a consumer that adds a custom header will find out immediately,
 * rather than having the header silently allowed.
 *
 * ## `Vary: Origin` on every response
 *
 * Including refusals. The body is deliberately identical for a granted and a
 * refused request (the neutral empty payload), but the HEADERS differ, and a
 * cache that does not know that would serve one origin's grant to another.
 * These endpoints are not edge-cached today; the header states the dependency
 * before some future change makes it matter.
 */

/**
 * What the `Origin` on a public search request turned out to be.
 *
 * `same_origin` covers "no `Origin` header" too — a plain navigation, `curl`,
 * and this repo's own `/search` page all take the unchanged host path and pay
 * neither the lookup nor the headers.
 */
export type PublicSearchOriginDecision =
  | { kind: "same_origin" }
  | { kind: "granted"; origin: string }
  | { kind: "refused" };

/**
 * The response headers for a decision.
 *
 * A refusal is the ABSENCE of `access-control-allow-origin` — there is no
 * header that says "no", so the refusal has to be silent to the browser and
 * visible only in that the page cannot read the body. `Vary` goes out either
 * way.
 */
export function publicSearchCorsHeaders(
  decision: PublicSearchOriginDecision
): Record<string, string> {
  if (decision.kind === "granted") {
    return {
      "access-control-allow-origin": decision.origin,
      vary: "Origin"
    };
  }

  return { vary: "Origin" };
}
