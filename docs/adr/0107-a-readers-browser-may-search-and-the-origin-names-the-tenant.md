🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0107-a-readers-browser-may-search-and-the-origin-names-the-tenant.id.md)

# ADR-0107 — A reader's browser may search, and the `Origin` names the tenant

- **Status:** Accepted
- **Date:** 2026-08-23
- **Decision maker:** ahliweb
- **Related:** Issue #597 item 3; Issue #607; ADR-0040 §5 (the public search surfaces); Issue #637 (the beacon's cross-origin policy, whose parser this reuses); ADR-0065 (the consumer contract); ADR-0009 / epic #555 (public tenant resolution); PRD LenteraKalteng §27.1, FR-DSC-002

## Context

`site_search` has been complete for months: weighted `tsvector` indexing behind a GIN index, `ts_rank` ordering, escaped snippets, keyset pagination, content-type facets (#632) and term facets (#633), a bounded trigram typeahead, all inside the same RLS boundary as the data. Two anonymous endpoints serve it — `GET /api/v1/site-search/query` and `GET /api/v1/site-search/suggest`.

**No reader can reach them.** The reader surface lives in `ahliweb/awcms-astro`, which is a STATIC build on its own origin, and Issue #597's own status table records why item 3 stayed blocked while items 1, 2, 5, 6 and 7 shipped: "the static site never talks to `awcms` at runtime, and a search box means the READER's browser calling it. That is CORS, `connect-src`, and an ADR."

The CORS half is the smaller problem. The larger one is only visible when you follow the request:

`withSiteSearchTenant` resolves the tenant from the **request host**. A reader on `https://news.example` sends the request to `https://cms.example`, so the host is the CMS's own. Host resolution then falls through the documented chain — `PUBLIC_DEFAULT_TENANT_ID` -> `PUBLIC_DEFAULT_TENANT_CODE` -> `awcms_setup_state.tenant_id` — and lands on the deployment's **default tenant**. On a single-tenant LAN deployment that fallback is exactly right; applied to a cross-origin caller it means one tenant's public site displaying another tenant's articles as its own search results, with a 200, a populated list, and nothing anywhere reporting a problem.

So "add CORS headers" is not the decision. The decision is what a cross-origin request's tenant IS.

## Decision

**A cross-origin search request resolves its tenant from the `Origin` header, against `awcms_tenant_domains`, and from nothing else. Same-origin requests are untouched.**

### The `Origin` is the tenant, and the fallback chain does not run

`resolvePublicTenantByHost` is the only resolver on the cross-origin path. No env default, no setup-state default. An origin this deployment does not serve resolves to nothing and the request is answered with the neutral empty payload — never with the default tenant's content.

This is not a CORS nicety. A caller that ignores CORS entirely (`curl`, a crawler, a proxy) gets the same empty answer, because the refusal happens in tenant resolution rather than in a header. Had it been done with headers alone, the default tenant's articles would still have been in the response body; the browser would merely have declined to show them.

`Origin` is safe to resolve from precisely because a browser sets it and a page cannot forge it. And what it is compared against — an `active` domain of an `active` tenant, through the same SECURITY DEFINER lookup the public host router uses — is the same predicate that decides whether this deployment answers for that hostname at all. **Registering and verifying the domain IS the opt-in**, so there is no second switch that can disagree with the first, and ADR-0106's work is what makes that predicate mean something.

### CORS is not authorization, again

The grant decides whether a browser may READ our answer. It does not decide what the answer contains — that is tenant resolution, above. The two are kept apart here for the same reason Issue #637's beacon keeps them apart, and the failure of merging them is concrete: a header-only design leaks the body to anything that is not a browser.

### No credentials, and no preflight handler

`Access-Control-Allow-Credentials` is **absent**. Search carries no session and needs no cookie, and a response without that header cannot be read by a credentialed request at all — so this surface can never become a confused-deputy path to something a reader's cookies would unlock.

There is deliberately **no `OPTIONS` handler**. A `GET` carrying only CORS-safelisted headers is a simple request: the browser sends it directly and no preflight exists. Answering preflights would cost a correct consumer nothing and would quietly turn this into a general-purpose cross-origin API; a consumer that adds a custom header finds out immediately instead.

### The refusal is silent, the metric is not

A refused origin gets the same neutral payload a disabled tenant gets, byte for byte — the endpoints' existing "never leak WHY" rule, unchanged. It also pays `padUnresolvedSearchTenantLatency`, so "this origin is a tenant here" is not readable from response time either.

An operator still needs to be able to tell "the site's search box is pointed at an unregistered domain" from "this tenant turned search off", so the two are separate values of the existing `site_search_queries_total` counter (`origin_refused` vs `disabled`). A server-side counter is not a disclosure to the caller.

### `Vary: Origin` on every answer, including the 429

The body is identical for a grant and a refusal; the HEADERS are what differ, so a cache that does not know the response depends on `Origin` will serve one origin's grant to another. These endpoints are not edge-cached today. The header states the dependency now rather than after some future cache change makes it matter — and it goes on the rate-limit 429 too, which is answered before the origin is ever classified.

### The `Origin` parser is shared, not copied

`parseRequestOrigin` / `isCrossOriginRequest` move from `visitor-analytics/domain/beacon-cors.ts` to `lib/security/request-origin.ts`, unchanged and with their reasoning. Two hardened copies of a security parser is the arrangement where the copy nobody hardens is the one an attacker finds; this repo has already paid for that shape four times over with `stripComments`.

### The freeze order stands

`/api/v1/site-search/query` and `/api/v1/site-search/suggest` enter `COMMITTED_PATHS` here and move to `CONSUMED_PATHS` when `ahliweb/awcms-astro` calls them, proved by that repo's own gate — the same three-step order ADR-0102, ADR-0104 and ADR-0105 followed.

## Consequences

- **Positive:** Issue #597 item 3 and the remaining half of #607 are unblocked on this side; a reader gets search, facets and typeahead from a statically built site with no BFF in between.
- **Positive:** the cross-tenant fallback is closed by CONSTRUCTION rather than by a header, so it holds for non-browser callers too.
- **Positive:** one origin parser instead of two.
- **Negative / trade-off:** the consumer must send its requests with `fetch` and **no custom headers**. Adding one turns a simple request into a preflighted one, which nothing answers, and the failure is a browser-side CORS error rather than a server log entry.
- **Negative / trade-off:** a tenant whose static site's origin is not a registered, verified domain gets an empty search box that reports nothing. That is the same fail-closed posture the rest of public resolution has, and it is why the refusal has its own counter.
- **Negative / trade-off:** the cross-origin path costs one extra query (the domain lookup) per search request. It lands only on cross-origin requests, after the per-IP rate limiter, and it is the same lookup the beacon's preflight already pays.
- **Neutral:** the `/search` HTML page keeps the unchanged host-resolved path. A top-level navigation sends no `Origin`.

## Alternatives considered

- **An explicit `?tenantCode=` parameter, following the beacon's shape.** Rejected. The beacon needs it because a preflight carries no body and a POST's tenant must be decided by the writer; a search request has an `Origin` that already names the tenant unforgeably. Adding the parameter would put a public identifier in every query string and let any caller search any tenant's index by naming it — a fallback with a wider surface, chosen for symmetry with an endpoint whose constraint does not apply here.
- **Allowing `*`.** Rejected outright. The answer is per-tenant; `*` would mean every page on the internet reads whichever tenant the request resolved to, and it would remove the only mechanism that ties the answer to a registered domain.
- **A separate env allow-list of permitted origins.** Rejected: a second list that can disagree with `awcms_tenant_domains`, needing to be edited every time a tenant is added, in a file no tenant administrator can reach.
- **A BFF in `awcms-astro` proxying search server-side.** Rejected for this issue, not on merit — that repo's build is static and has no server at runtime (ADR-0050's BFF is not built). Reaching for it would block a shipped engine behind an unbuilt component.
- **Leaving the host chain in place and adding only the headers.** Rejected: it answers the CORS question and leaves the cross-tenant one open, in the direction where the body is already on the wire.
