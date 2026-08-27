/**
 * Cross-origin policy for the three anonymous newsletter endpoints (ADR-0103).
 *
 * ## What was actually broken
 *
 * The module shipped on 21 August 2026 with `subscribe`, `confirm` and
 * `unsubscribe`, all anonymous and all built to be called from a public page.
 * When that public page is a statically built `awcms-astro` site on a DIFFERENT
 * origin — the PRD §27.1 scenario, and the only shape this family's public
 * surface takes (ADR-0070) — every one of them was unreachable, in three
 * independent ways that each hid the next:
 *
 * 1. **The preflight was never answered.** The contract is JSON, so a
 *    cross-origin POST is always preflighted, `OPTIONS` is in Astro's
 *    `SAFE_METHODS` and would have passed `security.checkOrigin` — but no route
 *    exported one, so the browser never sent the POST at all.
 * 2. **The answer was unreadable.** No route emitted
 *    `Access-Control-Allow-Origin`, so even an answered preflight would have
 *    left the browser discarding a 200 the server was happy with.
 * 3. **The tenant resolved from the HOST.** `withNewsletterTenant` mirrored the
 *    host-resolved search entry point, and the host of a request from a static
 *    site is this CMS — so a subscription would have landed in whichever tenant
 *    owns this deployment's own hostname, or in the env/setup default. Not a
 *    failure: a WRONG SUCCESS, and FR-NWL-002's isolation defeated by the
 *    request that is supposed to be subject to it.
 *
 * `site_search` had already met all three and solved them (ADR-0107). This
 * module follows that solution rather than inventing a second one, because a
 * second cross-origin policy in one codebase is a second place to get it wrong.
 *
 * ## The difference from the beacon, and why it is deliberate
 *
 * `visitor-analytics` grants `Access-Control-Allow-Credentials: true`, because
 * its anonymous visitor key is an `httpOnly` cookie and without credentials a
 * repeat visitor would look new on every page view.
 *
 * Nothing here needs that. These endpoints read no cookie, set no cookie and
 * authenticate nobody: a subscription is proven by a token that arrives in an
 * email, not by anything the browser carries. A credentialed grant would be a
 * strictly wider one bought for no benefit — and a wider CORS grant on an
 * endpoint that sends mail is the kind of thing that reads as harmless right up
 * until it is not.
 *
 * ## Never `*`
 *
 * The allowed origin is echoed verbatim from a value that already resolved a
 * tenant through `awcms_tenant_domains`. `*` would let any page on the internet
 * post to an endpoint that sends mail on this deployment's behalf.
 *
 * ## `Vary: Origin` on EVERY response
 *
 * Including the refusals, which carry no `Access-Control-Allow-Origin` at all —
 * there is no header that says "no". A cached denial served to an allowed
 * origin is the same defect as a cached grant served to a denied one, and a
 * header whose value depends on the request without saying so is a defect
 * waiting for the next cache change.
 */

/**
 * What the `Origin` on a public newsletter request turned out to be.
 *
 * `same_origin` covers "no `Origin` header" too — `curl`, a server-side call,
 * and anything this repo itself posts take the unchanged host path and pay
 * neither the domain lookup nor the headers.
 */
export type NewsletterOriginDecision =
  | { kind: "same_origin" }
  | { kind: "granted"; origin: string }
  | { kind: "refused" };

/**
 * How long a browser may reuse one preflight result. Ten minutes, matching the
 * beacon: long enough that a reader who subscribes and then confirms pays for
 * the preflight once, short enough that removing a domain from
 * `awcms_tenant_domains` takes effect while somebody is still watching.
 */
export const NEWSLETTER_PREFLIGHT_MAX_AGE_SECONDS = 600;

/**
 * Headers for the ACTUAL request's answer — the POST itself.
 *
 * A refusal is the ABSENCE of `access-control-allow-origin`. That silence is
 * the refusal: the browser simply cannot read the body, and nothing in the
 * response says which of the two happened. It matches the neutral body these
 * endpoints answer with, and it would be undone by a header that announced the
 * decision.
 */
export function newsletterCorsHeaders(
  decision: NewsletterOriginDecision
): Record<string, string> {
  if (decision.kind === "granted") {
    return {
      "access-control-allow-origin": decision.origin,
      vary: "Origin"
    };
  }

  return { vary: "Origin" };
}

/**
 * Headers for a granted preflight: the same grant plus the three things a
 * preflight is actually asking about.
 *
 * `access-control-allow-headers` lists `content-type` and nothing else, and
 * that is the whole point of the path this opens — `application/json` is what
 * keeps the request out of Astro's form-like branch, where `checkOrigin`
 * answers 403. No other header is allowed, so this cannot quietly become a
 * general-purpose cross-origin API.
 */
export function newsletterPreflightHeaders(
  decision: NewsletterOriginDecision
): Record<string, string> {
  const granted = newsletterCorsHeaders(decision);

  if (decision.kind !== "granted") return granted;

  return {
    ...granted,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": String(NEWSLETTER_PREFLIGHT_MAX_AGE_SECONDS)
  };
}
