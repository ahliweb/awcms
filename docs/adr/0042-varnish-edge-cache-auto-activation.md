🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0042-varnish-edge-cache-auto-activation.id.md)

# ADR-0042 — A Varnish edge cache layer with automatic activation driven by origin pressure

- **Status:** Accepted
- **Date:** 2026-07-25
- **Decision maker:** @ahliweb
- **Related:** ADR-0003 (multi-tenant RLS), ADR-0006 (outbox — the enqueue-in-commit pattern is reused here), ADR-0009 (path-scoped public routes `/blog/{tenantCode}`), ADR-0010 (host→tenant routing), ADR-0035 (online-first positioning), ADR-0038 (SEO discovery cache validators), ADR-0039 (redirect/404)

## Context

`awcms` is now online-first (ADR-0035) and targets multi-tenant SaaS with
unlimited subdomains. The consequence: **every anonymous reader opening the same
public page triggers the same database work**. Feeds, sitemaps, blog indexes,
post pages, and theme tokens are pure functions of published content + tenant
configuration — the answer is identical for every visitor, yet today it is
recomputed per request.

What already exists is **not** a solution for this:

- **The `seo_distribution` HTTP validators (ADR-0038 §7).** ETag/Last-Modified
  save _bandwidth_ when the client sends a conditional request. The origin still
  runs the whole query to compute its signature. Database load is not reduced.
- **`src/lib/redis/`.** An in-application value cache. Useful, but the request
  still reaches the application process, still passes through middleware, still
  renders.

What is missing is a layer that **answers without touching the application at
all**.

The constraint that shapes this decision: a shared cache in front of a
multi-tenant application is a **cross-tenant leak machine** by default. Varnish's
built-in VCL caches `200` responses without cache directives for `default_ttl`
(120 seconds). One cached `/admin` page = another tenant's data served to the next
visitor. Not a single Varnish mechanism prevents that out of the box.

## Decision

### 1. Varnish as an optional tier, **off by default, a no-op when off**

The edge cache is an optional infrastructure layer (`src/lib/edge-cache/`, not a
module: no tenant-facing tables, no permissions, no admin screen). Without
`EDGE_CACHE_MODE`, `annotateEdgeCache` returns after one boolean check — no
allocation, no query, no header writing. Adding a subsystem to the hot path of
every public request is only legitimate if "off" is genuinely free.

### 2. Cacheability is a **fail-closed allow-list**, separate from load

`decideCacheability` (pure) denies by default. A response is cacheable only if it
passes EVERY check: registered surface → GET/HEAD method → no `Authorization`
header → no cookie with the `awcms_` prefix → safe status → no `Set-Cookie` → no
`Cache-Control: private/no-store/no-cache` → not `Vary: *` → tenant resolved →
query params within the allow-list.

A new route is **not cacheable until somebody declares it**. Forgetting is safe.

Identity cookies are matched by **prefix** `awcms_`, not by a list of names, so
that a new identity cookie tomorrow does not silently open a hole. There is a test
that reads `ssr-session.ts` and enforces that the actual cookie names still match
that prefix.

### 3. Origin pressure only changes **how long**, never **what**

`auto` mode measures request rate + origin latency in a rolling window. When the
origin is relaxed, the advertised TTL is **0** — visitors get live data, the cache
stays cold. When the threshold is exceeded, the TTL rises gradually up to the full
TTL at twice the threshold, with hysteresis so it does not oscillate.

That is what "activated automatically when needed" means: the cache does not add
staleness when it is not needed, and absorbs repetition exactly when the database
starts to come under pressure.

**Pressure is not an input to `decideCacheability`.** It is structurally
impossible for a load spike to turn a private response into a public one. That
separation is deliberate.

### 4. Layered defence against Varnish's cache-by-default behaviour

Three independent mechanisms have to fail before an unmarked response is cached:

1. The application marks **every** response — `/admin` and `/api` included — with
   either `Surrogate-Control` (cache) or `Cache-Control: private, no-store` (do
   not). There is no silent third state.
2. **Default-deny VCL**: `vcl_backend_response` only caches what carries a
   `Surrogate-Control`.
3. `varnishd -p default_ttl=0`.

### 5. Invalidation via surrogate keys + a durable queue (`sql/068`)

Responses are tagged with `Surrogate-Key` (`t:<tenant>`, `t:<tenant>:m:<module>`,
`t:<tenant>:s:<surface>`, `t:<tenant>:r:<type>:<id>`). Invalidation = a `ban()`
regex over that header.

Because keys go into a **regex**, keys are restricted to `[A-Za-z0-9:._-]` when
built AND re-validated in the VCL: a key of `.*` would turn one invalidation into
"dump the entire cache onto the origin" — a one-request denial-of-service. The
match is also anchored `(^|[[:space:]])key([[:space:]]|$)` so that a ban on
`t:abc` does not also dump another tenant's `t:abcdef`.

`[[:space:]]` is not a style choice. Varnish splits a ban expression on
**whitespace** into `<field> <operator> <argument>`; a literal space inside the
regex — exactly what the first version wrote, `(^| )` — makes the token count
wrong and the ban is rejected with `Wrong number of arguments`. The BAN handler
still replies `200`, so the origin records the purge as sent, the queue row is
marked done, and the object stays cached until its TTL expires: **invalidation
never worked at all**. Found only after Varnish was actually placed in front of
staging and `X-Cache` stayed `HIT` after a purge. Quoting the regex does not help
— the token split happens first.

Enqueue happens in the **same content transaction** (the ADR-0006 outbox
pattern), not an HTTP call inside a transaction. Delivery is performed by
`bun run edge-cache:purge` with lease + retry, so a restarting Varnish does not
mean permanently stale content.

### 6. Bounding the cache key space

The edge keys on the full URL including the query string, so unbounded queries =
unbounded cache entries: anyone can evict hot objects with repeated cheap
requests. Every surface declares `allowedQueryParams`; a parameter outside that
list makes the request non-cacheable.

## Consequences

- **A new gate** `bun run edge-cache:surfaces:check` (pure, no DB) in the
  `bun run check` chain. It checks unique & safe keys, anchored patterns without
  greedy wildcards, bounded TTLs, and **probes 16 paths that must never be
  cacheable** (including `/admin`, `/api/v1/*`, and traversal shapes). Proven to
  go red when drifted.
- **Migration `sql/068`** — `awcms_edge_cache_purges`, ENABLE + FORCE RLS, worker
  grants `SELECT, UPDATE, DELETE` (DELETE is genuinely used for pruning; not a
  speculative grant) and identical entries in `WORKER_ROLE_GRANTS`.
- **`security:readiness`** gains `checkEdgeCacheConfigured`. Its only `critical`
  finding is a purge endpoint without a token — the combination that makes every
  invalidation fail 403 silently.
- **Middleware** now funnels every branch through a single exit point. The
  behaviour of `/admin`, Turnstile, CSP, SEO redirects, and 404 capture is
  unchanged.
- **Not yet covered, and named explicitly** (not an oversight): the host-resolved
  discovery surfaces (`/robots.txt`, `/sitemap.xml`, `/feed.xml`, `/atom.xml`,
  `/feed.json`) — the best cache candidates in the repo, but their tenant is
  established inside `withSeoPublicTenant` while `serveDiscovery(request, …)` does
  not receive `locals`, so the route cannot publish `edgeCacheTenantId`. Declaring
  them anyway would produce a surface that matches, fails to resolve, and is then
  denied on every request — a registry entry that reads as "cached" while it is
  not. A dead declaration is worse than an honest omission.
- **Not yet covered:** purge emission from content events (post/theme publish) is
  not wired up; `enqueueEdgeCachePurge` is ready to be called, its caller does not
  exist yet. Until it does, invalidation depends on the TTL. Surface TTLs are
  deliberately short (120–600 seconds) precisely because of that.

## Rejected alternatives

- **Nginx `proxy_cache`.** No tagged invalidation; `proxy_cache_purge` lives in
  the commercial variant. Per-tag invalidation is a requirement, not an extra.
- **CDN only.** Hands tenant isolation to a third party's configuration and does
  not help the LAN/on-prem deployments ADR-0035 still supports.
- **Extending `src/lib/redis/`.** Does not remove the application hop; the whole
  point is to answer without waking the application.
- **A deny-list ("cache everything except `/admin`").** Exactly the failure mode
  that makes a shared cache dangerous: a new private route is cached by default.
