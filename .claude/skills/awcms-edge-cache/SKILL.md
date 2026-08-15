---
name: awcms-edge-cache
description: The Varnish edge cache layer ALREADY EXISTS in this repo (ADR-0042; `src/lib/edge-cache/`, `infra/varnish/`, migration `sql/068`, gate `bun run edge-cache:surfaces:check`, worker `bun run edge-cache:purge`). This is INFRASTRUCTURE under `src/lib/`, NOT a module — no `src/modules/` entry, no permissions, no admin screen. OFF by default (`EDGE_CACHE_MODE` unset) and genuinely a no-op when off. Use when adding a public surface that may be cached, tuning TTL/auto-activation thresholds, wiring purge emission from content events, or debugging stale content / cache MISSes. WARNING: a shared cache in front of a multi-tenant application is a cross-tenant leak machine by default — read §Backbone before touching `cacheability.ts` or the VCL.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Edge cache (Varnish)

Follow [`docs/awcms/edge-cache-architecture.md`](../../../docs/awcms/edge-cache-architecture.md)
and [ADR-0042](../../../docs/adr/0042-varnish-edge-cache-auto-activation.md).

## The first thing to understand

Varnish's **built-in** VCL caches `200` responses without cache directives for
`default_ttl` (120 seconds). In front of a multi-tenant application that means: one
cached `/admin` page = another tenant's data served to the next visitor.

"The application said nothing" does **not** mean "do not cache". That is why
every response leaves the origin with an explicit label — `Surrogate-Control`
(cache) or `Cache-Control: private, no-store` (do not) — and there is no silent
third state.

## Backbone (do not regress it)

1. **Allow-list, not deny-list.** `decideCacheability` denies by default.
   A new route is not cacheable until someone declares its surface. If
   you are tempted to write "cache everything except `/admin`", stop — that is exactly
   the failure mode that makes a shared cache dangerous.
2. **Pressure only changes HOW LONG.** `pressure.ts` is never an
   input to `decideCacheability`. Do not "simplify" by merging the
   two: that separation is what makes it impossible for a load spike to turn a
   private response public.
3. **Three layers of default-deny.** (a) the application labels every response, (b) the VCL only
   caches what has `Surrogate-Control`, (c) `default_ttl=0`. Removing any
   one of them as "redundant" removes precisely the deliberate redundancy.
4. **Identity cookies are matched by the `awcms_` PREFIX,** not by a list of names, so that
   a new identity cookie cannot silently open a hole. There is a test that reads
   `ssr-session.ts` and enforces that the real cookie names still match that prefix.
5. **The surrogate key goes into a REGEX.** It is restricted to `[A-Za-z0-9:._-]` when built AND
   re-validated in the VCL. A key of `.*` = one request dumps the entire cache onto the
   origin. Matching is anchored `(^|[[:space:]])key([[:space:]]|$)` so that a ban on
   `t:abc` does not also dump another tenant's `t:abcdef`. **DO NOT** revert
   to a literal space `(^| )` — see the pitfall below.
6. **An unresolved tenant = not cached.** An object without a tenant key cannot
   be reached by any purge, so it would be stale forever.

## Pitfalls already found (do not repeat them)

- **A purge for a module WITHOUT a declared surface matches nothing.**
  Cached objects only carry the key of the module that OWNS the surface — today
  `blog_content`, `theming`, and `seo_distribution` (ADR-0061 §B; `news_portal`
  was MERGED into `blog_content` — ADR-0044/#300). Enqueuing `m:media_library`
  produces a ban that matches no object at all while the queue
  reports `sent=1`. Do not add one "just in case".
  The `edge-cache:surfaces:check` gate demands purge emission from every module that
  OWNS a surface, so the obligation appears automatically on the day its surface
  is declared — and not one second earlier.

- **A surface can have TWO writers, and `moduleKey` only holds one**
  (ADR-0061 §B). The bodies of `/sitemap.xml` and `/feed.xml` are owned by
  `seo_distribution` but are FILLED by every `seo_facts` provider, so publishing
  a post changes them without touching a single line belonging to their owner.
  `enqueueModuleContentPurge` therefore also purges modules that
  declare `consumes` against the changed module AND own a surface —
  read from the REGISTRY (`resolveDerivedSurfaceModuleKeys`), so `blog_content`
  never names `seo_distribution`. When adding a new aggregate surface,
  ask "who else writes this body?" before choosing the `moduleKey`.

- **When a tenant is published is a DISCLOSURE question** (ADR-0061 §3).
  404s may be cached, so a host-resolved route that publishes
  `locals.edgeCacheTenantId` BEFORE the "resource does not exist" branch makes a
  missing-resource 404 carry `Surrogate-Control` while an unknown-host 404
  carries `private, no-store` — answering "is this hostname a live tenant?" from
  ONE request. Publish ONLY on the serving path; guarded by
  `tests/discovery-routes-edge-cache-contract.test.ts`. (Its `/news/**` counterpart
  was deleted together with its route by ADR-0071 — the rule was not.)

- **Bun does NOT send non-standard HTTP methods.** `fetch`/`node:http` with
  `method: "BAN"` arrives at Varnish as **`GET`** (verified on Bun 1.3.14 via
  `varnishlog -i ReqMethod`; the same bytes over a raw socket are logged as `BAN` and
  answered `200 Banned`). The consequence is that every purge escapes the VCL ban branch,
  falls through to the origin, and 404s. This repo is Bun-only (ADR-0002) — there is no configuration
  that makes the `BAN` method work. The wire protocol is now
  **`POST /__edge-cache-purge`**; the VCL still accepts a real `BAN` for
  a manual `curl -X BAN`. The method was never a security control — the ACL, the token,
  and the key charset validation are what guard it, and all three apply at both doors.
- **A mock `fetchImpl` CANNOT catch this class of bug.** It inspects arguments,
  not the wire, so it will assert `method === "BAN"` and pass forever.
  `tests/edge-cache-purge-client.test.ts` enforces `request.method` as
  **RECEIVED** by a real `Bun.serve`. Write transport tests with a real
  server.
- **A misnamed RLS GUC = a DEAD write path, not merely a stale cache.** `sql/068`
  used `awcms.tenant_id` while `withTenant()` sets
  `app.current_tenant_id` (108 other policies use the correct one). `WITH CHECK`
  became NULL → INSERT rejected → and because `enqueueModuleContentPurge` was `await`ed
  INSIDE the content transaction without a guard, publishing a blog post also failed with a 500. Fixed by
  `sql/070`; guarded by `tests/migration-tenant-guc-consistency.test.ts` (a text gate,
  no DB, running in the `quality` job).

- **A literal space in a ban expression makes invalidation NEVER work.**
  Varnish splits a ban expression on whitespace into
  `<field> <operator> <argument>`. The first form that was sent, `(^| )key( |$)`,
  has a space inside the regex → the wrong number of tokens → the ban is rejected with
  `Wrong number of arguments`. What makes it dangerous: the BAN handler still
  replies **200**, so `sendEdgeCachePurge` records success, the queue row is
  marked done, and the content stays stale until the TTL expires. No test,
  log, or metric goes red. Found only by putting Varnish in front of
  staging and seeing `X-Cache` stay `HIT` after a purge. The correct form:
  `(^|[[:space:]])key([[:space:]]|$)`. **Quoting the regex does not help** —
  token splitting happens before quote handling (verified on Varnish 7.5).
  Guarded by `tests/edge-cache.test.ts`, which reads `infra/varnish/default.vcl`
  directly; a pure unit test cannot catch this because the expression is built
  in the VCL, not in TypeScript.
- **`varnishcache/varnish` is not a Docker Hub repository.** The initial compose overlay
  named it and failed with `pull access denied` for anyone who tried
  to use it. The correct image: `varnish:7.5` (Docker Official Image).
- **`/blog/{code}/search` is THREE segments** and therefore matches the
  `blog-post` pattern — even though the documentation states that query-driven surfaces are excluded.
  Caught by the gate's probe, not by review. Any new reserved sub-route under
  `/blog/{code}/` must be added to `RESERVED_SEGMENTS`.
- **`/blog/../admin` is also three segments.** `new URL()` normalizes dot-segments
  before the middleware sees them, but that is a property of the current pipeline, not an
  invariant of the function. The traversal guard lives in `matchPublicCacheSurface`.
- **An unbounded query string = unbounded cache entries.** The edge keys on the full
  URL. Without `allowedQueryParams`, `?x=1..N` evicts hot objects with
  cheap requests. Keep the allow-list small (the gate rejects >4).
- **The auto-activation latch is set by `sample()`, not by `record()`.** The serving path
  calls it on every request, so production is fine; in tests, a burst without
  `sample()` in the middle will not engage the latch.
- **The `sql/068` worker grants must have an identical entry in `WORKER_ROLE_GRANTS`**
  (`scripts/security-readiness.ts`). There is a test that reads the migration text and
  compares them.
- **Do not add grants that are not used.** DELETE was granted because the worker
  really does prune `done` rows. `failed` rows are deliberately NOT pruned — that is
  the only trace that an invalidation never landed.

## The tier ABOVE Varnish (Cloudflare)

The deployed topology puts Cloudflare (proxied) in front:
`Cloudflare -> Traefik -> Varnish -> app`. `EDGE_CACHE_PURGE_ENDPOINT` only
reaches **Varnish** — a purge/ban does not touch the Cloudflare cache, even though
the one answering readers is Cloudflare (`cf-cache-status: HIT` even when the
application marks skip). This is gap C14 in
[`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md) §9.
The consequence: when debugging stale content, measure `cf-cache-status`/`age` from
the Cloudflare side, not just Varnish's `X-Cache`; and staleness at that tier is bounded
only by `s-maxage`, not by a purge. Full debugging material: the `awcms-deploy` skill,
item "cf-cache-status".

## Commands

```bash
bun run edge-cache:surfaces:check   # registry gate (part of `bun run check`), pure, no DB
bun run edge-cache:purge            # send BANs from the queue; a no-op when mode is off / no endpoint
bun run security:readiness          # checkEdgeCacheConfigured: endpoint-without-token = CRITICAL
```

## Not there yet (do not claim it is)

- ~~Purge emission from content events.~~ **DONE** — `blog_content`
  (create/update/soft-delete/scheduled publish), `theming`
  (publish/rollback/retire), `seo_distribution` (`PUT /api/v1/seo/config`).
- ~~Host-resolved discovery surfaces~~ **DONE** (ADR-0061 §B):
  `seo-robots` (600s), `seo-sitemap` (300s, index + `-{n}` children), `seo-feed`
  (300s, RSS/Atom/JSON, `?locale=`). The `/news/**` family too (ADR-0061 §A:
  `news-index`/`news-taxonomy`/`news-post`). **11 surfaces** declared.
- **The public comment list** (`GET /api/v1/comments`) — a legitimate candidate, deferred.
- **Purge through the admin UI or an HTTP endpoint.** Queue + worker only.

## Related skills

`awcms-new-migration` (worker grants + RLS FORCE), `awcms-new-endpoint`,
`awcms-seo-distribution` (ETag validator — a different mechanism, see the table in
the docs), `awcms-blog-content`, `awcms-theming` and `awcms-seo-distribution` (the three owners of the cached surfaces).
