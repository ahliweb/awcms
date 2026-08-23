---
"awcms": minor
---

feat(site-search): a reader's browser may search, and the `Origin` names the tenant (ADR-0107)

`site_search` has been complete for months — weighted `tsvector` indexing,
`ts_rank` ordering, escaped snippets, keyset pagination, content-type facets,
term facets, a bounded trigram typeahead — and no reader could reach any of it.
The reader surface is a static `awcms-astro` build on its own origin, so Issue
#597 item 3 stayed blocked on "CORS, `connect-src`, and an ADR".

**The CORS half was the smaller problem.** `withSiteSearchTenant` resolves the
tenant from the request HOST. A reader on `https://news.example` calling
`https://cms.example` is resolved through the documented fallback chain
(`PUBLIC_DEFAULT_TENANT_ID` -> `PUBLIC_DEFAULT_TENANT_CODE` ->
`awcms_setup_state`) and lands on the deployment's **default tenant** — correct
on a single-tenant LAN box, and on a shared deployment one tenant's site
displaying ANOTHER tenant's articles as its own results, with a 200, a populated
list, and nothing reporting a problem.

So the change is not "add headers". A cross-origin search request now resolves
its tenant from the `Origin`, against `awcms_tenant_domains`, and from nothing
else — no env default, no setup-state default. That closes it by construction
rather than by a header, which matters because a header-only design leaves the
default tenant's content in the response body for anything that is not a browser
(`curl`, a crawler, a proxy).

- `Access-Control-Allow-Origin` is echoed verbatim, never `*`, and only for an
  `active` domain of an `active` tenant — registering and verifying the domain
  IS the opt-in, so no second switch can disagree with the first.
- `Access-Control-Allow-Credentials` is **absent**: search needs no cookie, and
  a response without it cannot be read by a credentialed request at all.
- There is deliberately **no `OPTIONS` handler**. A `GET` with only
  CORS-safelisted headers is a simple request; answering preflights would
  quietly turn this into a general-purpose cross-origin API.
- A refused origin gets the neutral empty payload, byte-identical to "no
  results", and pays the same latency pad. Only a server-side counter
  (`origin_refused` vs `disabled`) can tell them apart.
- `Vary: Origin` goes on every answer, including the rate-limit 429 the limiter
  returns before the origin is ever classified.

`parseRequestOrigin`/`isCrossOriginRequest` move out of
`visitor-analytics/domain/beacon-cors.ts` into `lib/security/request-origin.ts`
— shared, not copied. Two hardened copies of a security parser is the
arrangement where the un-hardened one is what an attacker finds.

`/api/v1/site-search/query` and `/suggest` enter `COMMITTED_PATHS` in the
`awcms-astro` consumer contract and move to `CONSUMED_PATHS` when that repo
calls them.
