🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](edge-cache-architecture.id.md)

# Edge cache architecture (Varnish)

> Decision: [ADR-0042](../adr/0042-varnish-edge-cache-auto-activation.md).
> Code: [`src/lib/edge-cache/`](../../src/lib/edge-cache/),
> [`infra/varnish/`](../../infra/varnish/), migration `sql/068`.

## Why this exists

Every anonymous reader opening the same public page triggers the same database
work. Feeds, sitemaps, blog indexes, post pages, theme tokens — all of them pure
functions of published content + tenant configuration, identical for every
visitor, yet recomputed per request.

Varnish answers those repeated requests **without waking the application at
all**. That is what separates it from two mechanisms that already exist and do
**not** solve this problem:

| Mechanism                     | Saves                               | DB load                      |
| ----------------------------- | ----------------------------------- | ---------------------------- |
| ETag/Last-Modified (ADR-0038) | bandwidth (304)                     | **still full**               |
| `src/lib/redis/`              | repeated queries inside the process | reduced, the app hop remains |
| Varnish (ADR-0042)            | the entire request                  | **zero on a HIT**            |

## Turning it on: two sides, and the order matters

Turning on only one side is not dangerous, but it is also useless.

1. **Application side first** — set `EDGE_CACHE_MODE=auto`,
   `EDGE_CACHE_PURGE_ENDPOINT`, `EDGE_CACHE_PURGE_TOKEN` (see `.env.example`).
   This is safe because nothing is caching yet; verify that the
   `Surrogate-Control` header appears on public responses.
2. **Schedule `bun run edge-cache:purge`** (every 10–30 seconds). Without it, an
   editor's edit only becomes visible once the TTL expires.
3. **Only then put Varnish in front** —
   `docker compose -f docker-compose.yml -f infra/varnish/docker-compose.varnish.yml up -d`.

The container's `EDGE_CACHE_PURGE_TOKEN` **must match the application's exactly**.
A mismatch = every purge silently rejected with 403 while the site serves stale
content and looks healthy. `bun run security:readiness` reports an
endpoint-without-token as a **critical** finding precisely because this failure
is not noisy.

> **Verify with `X-Cache`, do not trust the exit code.** This whole path has a
> habit of failing while reporting success. Three real bugs proved exactly that
> when this layer was first genuinely run in staging
> (2026-07-25/26) — see §Lessons. The correct acceptance test: warm an object
> until `X-Cache: HIT`, send a purge, confirm the next request is a `MISS`,
> then a `HIT` again. Rejected ban expressions, a method that never got sent, and
> an RLS policy with the wrong GUC all slip past looser checks.

## Modes

| Mode   | Behaviour                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `off`  | Default. The subsystem is inert — no headers, no queries, no behavioural change.                                                  |
| `auto` | TTL 0 while the origin is relaxed; rises gradually as request rate / latency crosses the thresholds, full at twice the threshold. |
| `on`   | Always advertise the declared surface TTL. Pressure is not consulted at all.                                                      |

The mode **never** changes _what_ may be cached — only _for how long_.

### Public surfaces independent of load (`EDGE_CACHE_PUBLIC_SURFACES`)

`auto` leaves a public page uncached below the activation threshold, so the
first spike pays full origin cost. `EDGE_CACHE_PUBLIC_SURFACES=always` (issue
#1284, ADR-0161)
removes that dependency for the surfaces already declared in
`surface-registry.ts`:

| Setting              | Effect                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pressure` (default) | Today's behaviour: the mode decides the TTL.                                                                                                                                                                                                                        |
| `always`             | A declared surface advertises its declared TTL (clamped to `EDGE_CACHE_MAX_TTL_SECONDS`) in `Surrogate-Control` **and** `Cache-Control: public, max-age=0, s-maxage=<ttl>, must-revalidate`, which is what the CDN tier reads (Varnish strips `Surrogate-Control`). |

It does nothing while `EDGE_CACHE_MODE=off`, and an unrecognised value means
`pressure`. A route's own `Cache-Control` is still never overwritten.

**Decision table.** "Always" applies to every entry of the allow-list and to
nothing else; the allow-list itself did not change.

| Surface (registry key)                                                                                                                                                                                                     | Always safe?                      | Why                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `blog-index`, `blog-post`, `blog-taxonomy`, `blog-page`, `blog-discovery`, `seo-robots`, `seo-sitemap`, `seo-feed`, `theming-tokens`                                                                                       | Yes, on the same checks as before | Anonymous, tenant-keyed, a function of published content; every per-request exclusion still runs |
| Anything not in the registry, `/admin/**`, `/api/v1/**`, `/search`, preview-token URLs, `/login`, the catch-all                                                                                                            | Never (not on the allow-list)     | Unchanged from ADR-0042                                                                          |
| Any request with `Authorization` or an `awcms_*` cookie; any response with `Set-Cookie`, `private`/`no-store`/`no-cache`, `Vary: *`/`Cookie`/`Accept-Language`; non-GET/HEAD; unlisted query parameters; unresolved tenant | Never                             | Per-request checks in `cacheability.ts` run before the TTL, in every setting                     |

Cache key, `Vary` and the locale-in-path rule (ADR-0098) are untouched.

**Staleness bound.** While purge does not reach the CDN (see the next section,
C14), a CDN copy can be at most `s-maxage` old. With the default
`EDGE_CACHE_MAX_TTL_SECONDS=300` that is the **≤300 seconds** already accepted;
`validate-env` warns (`edge_cache_cdn_ttl_exceeds_accepted_bound`) when `always`
is combined with a larger ceiling. Raising the ceiling needs the CDN purge
decision (#1282) first.

## Adding a cacheable surface

One entry in `PUBLIC_CACHE_SURFACES`
([`surface-registry.ts`](../../src/lib/edge-cache/surface-registry.ts)):

```ts
{
  key: "blog-post",
  moduleKey: "blog_content",
  pattern: /^\/blog\/[^/]+\/[^/]+$/,   // anchored, [^/]+ not .*
  ttlSeconds: 300,
  requiresTenant: true,
  allowedQueryParams: [],
  rationale: "…why it is safe to cache this in a shared cache…"
}
```

`bun run edge-cache:surfaces:check` rejects unanchored patterns, greedy
wildcards, duplicate keys, empty rationales, a bloated query allow-list, and —
most importantly — it **probes 16 paths that must never be cacheable**. This gate
has already caught one real bug: `/blog/{code}/search` is three segments and so
matched the `blog-post` pattern, even though the documentation stated that search
is excluded.

Routes that resolve their own tenant (not from a `{tenantCode}` path) must
publish `Astro.locals.edgeCacheTenantId`, or their response will not be cached —
never mis-tagged.

## Invalidation

```
t:<tenantId>                          the whole tenant
t:<tenantId>:m:<moduleKey>            one module
t:<tenantId>:s:<surface>              one surface
t:<tenantId>:r:<type>:<id>            one resource
```

Content modules call `enqueueEdgeCachePurge(tx, tenantId, scopes, reason)`
**inside the same content transaction** (the ADR-0006 outbox pattern). Delivery is
done by a worker with a lease + retry.

The wire protocol: **`POST /__edge-cache-purge`** with the headers
`X-Edge-Purge-Token` + `X-Edge-Purge-Key`. The VCL also still accepts the real
`BAN` method, so `curl -X BAN` still works for operators; the application
**cannot** use it because Bun does not send non-standard HTTP methods (see
§Lessons).

Keys are restricted to `[A-Za-z0-9:._-]` when built **and** re-validated in the
VCL: the key goes into a regex, so a `.*` would turn a single invalidation into
"dump the entire cache back to the origin".

## Lessons — three bugs that only appeared when it was actually run

This layer passed review, passed `bun run check`, and was still wrong in three
places. All three only became visible once Varnish was genuinely put in front of
staging, and all three **reported success** while not working. The same pattern
will recur on the next layer if it is not remembered.

1. **Literal spaces in the ban expression.** `(^| )key( |$)` — Varnish splits ban
   expressions on whitespace, so the token count was wrong and every ban was
   rejected with `Wrong number of arguments`. The handler still replied 200. Fix:
   `(^|[[:space:]])key([[:space:]]|$)`.
2. **The `BAN` method was never sent.** Bun sends non-standard methods as `GET`
   (both `fetch` and `node:http`, verified on 1.3.14 via
   `varnishlog -i ReqMethod`). Every purge fell through to the origin and 404'd.
3. **The purge queue's RLS policy used a GUC that is never set.** `sql/068`
   writes `awcms.tenant_id`; `withTenant()` sets `app.current_tenant_id`.
   This is **not** a cache bug — `WITH CHECK` became NULL, the INSERT was
   rejected, and because the enqueue is `await`ed inside the content transaction
   without a guard, **publishing a blog post failed with a 500 too** the moment
   the cache was switched on. Fixed by `sql/070`.

The common thread: `sendEdgeCachePurge` had **no test at all**, and the
`fetchImpl` mock genuinely cannot catch bug class (2) — it inspects arguments,
not the wire. It is now guarded by `tests/edge-cache-purge-client.test.ts`
(a real `Bun.serve`, asserting `request.method` as RECEIVED),
`tests/migration-tenant-guc-consistency.test.ts`, and two file-level assertions
over `default.vcl`.

## The reach limit of purging

> **Since Issue #1282** the CDN tier can be purged too, behind the default-off
> `EDGE_CACHE_CDN_PURGE` flag (next section). Everything in this section
> describes the deployment **with the flag off**, which is the default.

The purge queue reaches **Varnish, and only Varnish** —
`EDGE_CACHE_PURGE_ENDPOINT` points at the Varnish listener, and the BAN the
worker sends stops there. In the real deployed topology, the tier that actually
serves readers is **Cloudflare**: both hosts are proxied
(`Cloudflare (proxied) → Traefik :443 → varnish:80 → app`, see
[`environments.md`](environments.md)), proven by a staging probe on 4 August 2026
(`cf-cache-status: HIT` plus an `age:` header). The consequence is that a purge
reporting `done` and a `MISS` in Varnish does **not** mean readers see fresh
content. The staleness readers see is bounded by the advertised `s-maxage`,
clamped by `EDGE_CACHE_MAX_TTL_SECONDS` (**≤300 seconds** in the staging
configuration) — so the bound is time, not invalidation. An acceptance test that
only reads Varnish's `X-Cache` is measuring a tier that is not the one answering;
read `cf-cache-status`/`age` as well. This gap is recorded as **C14** in
[`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md) §9.

## CDN purge (`EDGE_CACHE_CDN_PURGE`, off by default)

Issue #1282 revisits C14 with the owner's decision of 12 November 2026:
implemented, **behind a flag that is off by default**. Nothing below happens
until the owner fills the credentials and turns the flag on; until then the
section above is the whole truth and the ≤300-second bound is the acceptance.

**Flow.** The queue row is unchanged (one surrogate key). With the flag on the
worker (`bun run edge-cache:purge`) sends the Varnish BAN first, then purges the
**same key as a CDN tag** (`POST <api base>/zones/<zone>/purge_cache`, body
`{"tags":[...]}`, `Authorization: Bearer <token>`). The row is `done` only when
both succeeded. The app also emits `Cache-Tag: <keys, comma-separated>` next to
`Surrogate-Key`, only while the flag is on (the CDN strips it; Varnish passes it
through, unlike `Surrogate-Key`).

**Design decisions** (from Cloudflare's public purge documentation: purge by URL,
hostname, tag, prefix and everything is available on every plan; at most 100
operations per request; account-wide token bucket for tag/hostname/prefix purge of
5 requests/minute on Free, 5/s Pro, 10/s Business, 50/s Enterprise):

| Decision            | Choice                                                                                                                                                                                                 | Why                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Purge unit          | **Tag** (the existing surrogate key), not URL                                                                                                                                                          | The queue holds keys; the app cannot enumerate the URLs behind a module. Tags are on every plan and kill every object with that key. |
| Batching            | Distinct tags per claimed batch, **100 per request**                                                                                                                                                   | The documented maximum; a burst of thousands of rows becomes tens of requests against a 5-per-minute (Free) to 50-per-second bucket. |
| Rate limit          | HTTP 429 stops CDN calls for the rest of the run; rows are **released** (back to `pending`, attempt not counted). The limit is account-wide, so the next scheduled run resumes                         | Retrying inside the run only deepens the limit; a limit is not the row's fault, so it must not walk the row to the dead-letter.      |
| Backoff and retry   | Transient (5xx, timeout, network, `success` not true): 3 inline attempts, 250 ms then 1 s; then the run stops calling the CDN (`unavailable`) and the row returns to `pending` counting an attempt     | An outage must not be drained into the dead-letter inside one run; later scheduled runs keep the queue's existing 5-attempt budget.  |
| Dead-letter         | Other 4xx (request is wrong) parks the rows in `failed` with the reason; retries exhausted do the same after 5 attempts. `failed` is the existing dead-letter (180-day retention, ADR-0076)            | Nothing is dropped; an operator sees the cause.                                                                                      |
| Rejected credential | HTTP 401/403: rows **released**, run stops, exit code 1                                                                                                                                                | A bad or expired token is configuration, not a verdict on the rows; fixing it loses nothing.                                         |
| Missing credentials | Flag on and any of the three settings missing or unusable: the worker **refuses to run** (exit 1) before touching the queue; `security:readiness` reports CRITICAL                                     | Fail closed: never BAN in Varnish and quietly leave the CDN behind, never drop rows.                                                 |
| Metrics             | Summary line and `job_run_item_count{jobName="edge-cache:purge",itemName=cdnPurged\|cdnFailed\|cdnReleased\|cdnMaxLagSeconds}`; lag = completion time minus enqueue time of the slowest row in the run | No new metric name, no tenant label (#698 privacy rules). A job process only exports when the deployment registers a metrics port.   |

**Settings** (environment only; none is ever committed or logged):
`EDGE_CACHE_CDN_PURGE` (`on` enables; anything else is off),
`EDGE_CACHE_CDN_ZONE_ID`, `EDGE_CACHE_CDN_API_TOKEN` (job-scoped to
`edge-cache:purge`), optional `EDGE_CACHE_CDN_API_BASE` (https, or http on
loopback only). Give the token only the cache-purge permission for the one zone.
Tags are case-insensitive at the CDN; keys built from lower-case ids are
unaffected.

**What it does not do.** It does not configure the CDN account or zone, does not
widen the allow-list, and does not make a purge instantaneous: the CDN accepts
the request and propagates it, so verify with `cf-cache-status`/`age` after a
publish. Enabling it also lifts the reason to keep `EDGE_CACHE_MAX_TTL_SECONDS`
at or below 300 for staleness (ADR-0161), but that decision is separate.

## What is not wired up yet (do not claim it exists)

- ~~Purge emission from content events.~~ **DONE** for both modules that own a
  declared surface: `blog_content` (create, update, soft-delete, scheduled
  publish) and `theming` (publish, rollback, retire — the owner of
  `theming-tokens`). Both call `enqueueModuleContentPurge` in the same
  transaction.

  `media_library` **deliberately does not** call it (and neither did
  `news_portal`, before
  [ADR-0044](../adr/0044-merge-news-portal-into-blog-content.md) merged it into
  `blog_content`). It owns no declared surface, so no cached object is tagged
  `m:media_library` — a ban for that key **matches nothing** while the queue
  reports success. Adding it now would add ceremony that looks like coverage but
  is zero. The obligation appears on its own the moment the module declares a
  surface: `bun run edge-cache:surfaces:check` demands purge emission from
  **every module that owns a surface**, and fails if one does not.

- ~~**Host-resolved discovery surfaces**~~ **DONE** (ADR-0061 §B). Three entries
  — `seo-robots` (600s), `seo-sitemap` (300s, index + `-{n}` children), `seo-feed`
  (300s, RSS/Atom/JSON, `?locale=` the only query param). `serveDiscovery` accepts
  an optional `locals` and publishes the tenant AFTER `build(ctx)` returns a
  payload; all six of its routes forward `locals`.

  **What was found while wiring it up, and this applies to every future aggregate
  surface: the discovery body has TWO writers.** Its configuration belongs to
  `seo_distribution` (`PUT /api/v1/seo/config` now purges), but its CONTENT is
  aggregated from every `seo_facts` provider — so publishing a post changes
  `/sitemap.xml` without touching a single line owned by `seo_distribution`.
  Because a module purge tags `t:<tenant>:m:<moduleKey>`, a `blog_content` purge
  does not reach it, and the result would be an asymmetry nothing reports:
  `/blog/{code}/feed.xml` purged on publish, `/feed.xml` stale until the TTL.
  `enqueueModuleContentPurge` now also purges modules that declare `consumes` on
  the changed module AND own a surface — read from the registry (so `blog_content`
  never names `seo_distribution`), and restricted to surface owners (a ban for a
  key that tags nothing = ceremony that looks like coverage).

- ~~**The host-resolved content family `/news/**`**~~ — **REVOKED**
  ([ADR-0071](../adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)).
  ADR-0061 §A added three entries (`news-index`/`news-taxonomy`/`news-post`);
  ADR-0071 then removed that route family from this repo, and those three entries
  **outlived their routes by several days**.

  They were **inert**, not dangerous — nothing serves those paths, and
  `requiresTenant` makes an unresolved tenant fail closed. But an inert entry is
  worse than no entry: it is a standing statement that a SHARED cache may store a
  path, complete with a `rationale` arguing that it is safe, for a route nobody
  can read — and an `edge-cache:surfaces:check` reporting OK over 11 surfaces
  reads as coverage of 11 things, not 8.

  Since then **`edge-cache:surfaces:check` rejects a surface whose owning module
  declares no serving route** (`findSurfacesWithoutServingRoutes`, read from
  `api.routes` in the registry — the same authority `modules:routes:check` binds
  to the filesystem). Of yesterday's eleven entries: 8 passed, exactly 3 failed.

  Two things that still hold for the NEXT host-resolved surface — today the six
  root discovery routes are the only family of that kind:

  - **The host-hash prerequisite is TWO properties, not one.** `vcl_hash` does
    call `hash_data(req.http.host)` — but that sub must also NOT
    `return (lookup)`, because a custom sub that `return`s terminates the chain so
    `builtin.vcl`'s own `vcl_hash` (which hashes `req.url`) never runs and every
    path on one host collapses into a single entry. Both are now enforced by
    `tests/edge-cache.test.ts`.
  - **When the tenant is published is a disclosure question.** A 404 may be
    cached, so publishing the tenant before the "post/term does not exist" branch
    makes a resource-missing 404 carry `Surrogate-Control` while an unknown-host
    404 carries `private, no-store` — answering "is this hostname a live tenant?"
    from a SINGLE request, through the very channel `padUnresolvedHostRouteLatency`
    was built to close. The rule: publish only on the serving path, guarded by
    `tests/discovery-routes-edge-cache-contract.test.ts` (mutation-proven).
    Its counterpart for `/news/**` was removed along with the routes (ADR-0071);
    the disclosure rule was NOT revoked with it — it applies to every future
    host-resolved surface.

- **The public comments list** (`GET /api/v1/comments`) — a legitimate candidate,
  deferred.
- **Purging from the admin UI.** Only via the queue and the worker.
