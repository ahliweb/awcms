🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0061-host-resolved-public-surfaces-are-edge-cacheable.id.md)

# ADR-0061 — Host-resolved public surfaces may be cached at the edge: the route publishes its tenant

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision makers:** @ahliweb
- **Related:** [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (Varnish edge cache, surface allow-list, §8 surrogate keys), [ADR-0009](0009-public-tenant-scoped-routes.md) (path-based public routes `/blog/{tenantCode}`), [ADR-0010](0010-public-host-tenant-routing.md) (tenant resolution from the host), [ADR-0038](0038-seo-distribution-module-admission-discovery-scope.md) (discovery routes at the host root), [ADR-0059](0059-host-resolved-public-content-routes.md) (the `/news/**` content family)

> **One §A premise falls; the rest does not.** [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
> (8 August 2026) makes `/blog/{tenantCode}` the **permanent** vocabulary of this
> repo, not a legacy form. The §A conclusion that "edge cache speeds up the
> legacy form and does not touch the forward form at all" therefore no longer
> holds for the content family: the form being cached is precisely the form
> being kept, and it is path-scoped, so it is already cacheable today. The rest
> of the analysis — the root discovery routes, which stay host-resolved and
> still have no per-host key — is **unchanged**, and this ADR is not superseded.

## Context

### 1. The number-one tenant source never had a writer

ADR-0042 §8 establishes two tenant sources for tagging cached objects, ordered by
priority. `src/lib/edge-cache/tenant-key.ts` writes them out verbatim:

> 1. **Published by the route** (`locals.edgeCacheTenantId`). Preferred, and the
>    only source for host-resolved surfaces.
> 2. **Path-scoped `{tenantCode}`** (ADR-0009 `/blog/{code}/…`).

`src/env.d.ts` declares the field, `src/middleware.ts` reads it and forwards it
to `annotateEdgeCache`, and `resolveEdgeCacheTenantId` prefers it above
everything else. That whole path exists and is correct.

What does not exist: **a single writer.** `grep -rn "edgeCacheTenantId" src/`
returns five lines — the type declaration, the read in the middleware, two
docblocks, and one comment. Zero assignments. That first-priority branch has
never been executable since ADR-0042 landed, so source (2) — the tenant code in
the path — is the only source that is actually alive.

### 2. The consequence: edge cache only speeds up the legacy surface

Because source (1) is dead, every surface that resolves the tenant from the
**request** rather than from the **path** cannot be cached — not because it was
decided that way, but because it has no way of stating its tenant. What is hit:

- **Six root discovery routes** (`/robots.txt`, `/sitemap.xml`,
  `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`, ADR-0038) — the
  best cache candidates in this repo: an identical body for every anonymous
  reader, rebuilt from a content roll-up on **every** request.
- **The `/news/**` content family** (ADR-0059) — index, post detail, category,
  tag.

The `PUBLIC_CACHE_SURFACES` registry declares five surfaces, and all five are
path-scoped: `/blog/{tenantCode}/**` and `/theming/{code}/tokens.css`. So today's
position is exactly the inverse of the direction ADR-0059 set: **edge cache
speeds up the legacy form and does not touch the forward form at all.** A tenant
using its own domain — the case `tenant_domain` exists to serve — gets zero
acceleration.

The `surface-registry.ts` header already records the discovery deferral with the
right reason, and that reason remains right: declaring a matching surface that is
then rejected with `tenant_unresolved` on every request produces a registry entry
that **reads as "cached" while caching nothing**. A dead declaration is worse
than an honest absence. What is missing is not the decision, it is the writer.

### 3. When to publish is a disclosure question, not a style question

This is the part that cannot be read off the code, and it is why this ADR exists.

The host-resolved family deliberately collapses four different outcomes — unknown
host, module disabled, route family disabled, and **resource does not exist** —
into ONE generic 404, then pads their cost
(`padUnresolvedHostRouteLatency`, `padUnresolvedSeoTenantLatency`) so that all
four are indistinguishable in the time domain too. The question being guarded:
_"does this hostname map to a live tenant?"_

**404 is a cacheable status** (`CACHEABLE_STATUSES` includes 404 — deliberately,
because a cached and purgeable 404 is valuable). So the cache annotation is a
**second observation channel onto the same question**. If a route publishes its
tenant as soon as the gate passes:

| Request                         | Status | Annotation                         |
| ------------------------------- | ------ | ---------------------------------- |
| unknown host                    | 404    | `Cache-Control: private, no-store` |
| known host, slug does not exist | 404    | `Surrogate-Control: max-age=300`   |

A prober gets the full answer from **one request**, with no timing analysis at
all — through the very channel that was built to close it. And the mistake takes
the form of one line placed a few lines too high: it still compiles, still serves
the correct HTML, passes every functional test.

The rule is therefore: **publish only on the path that is actually serving the
resource.** For `/news/{slug}`, `/news/category/{slug}`, `/news/tag/{slug}` that
means AFTER the "no post/term" branch. For `/news` there is no missing-resource
branch — the outcome is 200 or a generic 404, already different by status — so
"already gated" and "now serving" are the same instant.

The asymmetry is deliberate: a route that **forgets** to publish loses caching
and nothing more (`requiresTenant` → `tenant_unresolved`); a route that publishes
**too early** leaks. Forgetting is a performance cost, publishing too early is
disclosure.

### 4. `/news/**` prerequisite: the cache key MUST include `Host`

`docs/awcms/edge-cache-architecture.md` held this family back on exactly the
right condition: `/news/hello-world` is a path that is **identical for every
tenant**, so declaring it before the VCL is proven to hash `Host` is the most
direct way to install a cross-tenant leak in a shared cache.

Verified against the file, not assumed — and the condition turns out to be
**two**, not one:

1. `infra/varnish/default.vcl` `vcl_hash` calls `hash_data(req.http.host)`
   explicitly, with a comment stating its multi-tenant reason.
2. That sub does **not** `return (lookup)`. In Varnish, a custom sub that
   `return`s ends the chain, so `builtin.vcl`'s `vcl_hash` — which hashes
   `req.url` — never runs, and **every path on one host collapses into a single
   cache entry**. Adding `return (lookup)` looks like completing the subroutine,
   not like killing URL hashing.

Both are now enforced by a file-level test, because both can disappear in a VCL
diff that reads reasonably and the symptom is not an error but serving another
tenant's content.

## Decision

Host-resolved public surfaces become edge-cacheable, via routes that **publish
the tenant they have already resolved**, with the §3 timing rule as a
test-guarded contract — not as a convention.

### §A — The `/news/**` family (this PR)

1. `src/lib/edge-cache/publish-tenant.ts` — `publishEdgeCacheTenant(locals, tenantId)`,
   one named and greppable publication point, with the timing reason attached
   right there. Tolerant of a missing `locals`/id (the ADR-0042 rule stands: no
   disturbance in the cache layer may turn a public page into a 500).
2. All four `/news/**` routes call it — the three resource-bearing routes
   **after** their respective missing-resource branch.
3. Three registry entries: `news-index` (120s, `?page`), `news-taxonomy` (120s,
   `?page`), `news-post` (300s, no query) — mirroring the TTLs and reasons of
   `blog-index`/`blog-taxonomy`/`blog-post`. Their owner is `blog_content`, which
   **already** emits module purges (create/update/soft-delete/scheduled publish),
   so `findOwnersWithoutPurges` is satisfied with no new wiring and an
   unpublished post disappears from `/news/**` through the same purge that
   already cleans `/blog/**`.
4. A never-cacheable probe for the new family's hostile forms. The form that
   literally satisfies `news-post` is `/news/..`, **not** `/news/../admin` — the
   host-resolved pattern is one segment shorter than its path-scoped counterpart,
   so the `/blog` probe does not carry over.

### §B — Root discovery routes (DONE)

`serveDiscovery` takes an optional `locals` and publishes **after** `build(ctx)`
returns a payload; all six routes forward `locals`. The §3 timing rule applies
identically here and its `null` branches are even MORE numerous — `build` returns
`null` for "sitemap disabled", "feed disabled", and "page out of range", all
three collapsing into the same generic 404 as an unknown host. The side effect is
pleasant: `/sitemap-99999.xml` matches the surface pattern but never publishes a
tenant, so walking page numbers cannot be used to fill the cache.

Three entries: `seo-robots` (600s — configuration-based, the most stable),
`seo-sitemap` (300s, covering the index AND the `-{n}` children), `seo-feed`
(300s, one pattern for RSS/Atom/JSON, `?locale=` the only permitted query and
already validated by `parseDiscoveryLocaleParam`). The never-cacheable probe also
enforces that the child-sitemap pattern rejects forms that `Number()` happily
accepts (`1e3`/`0x10`/`-abc`) — the same list the route file rejects.

#### §B finding: the discovery body has TWO writers

`PUT /api/v1/seo/config` gets a purge call site — `findOwnersWithoutPurges`
demands it as soon as a module owns a surface, and the tenant-wide `noindex`
switch alone already rewrites `/robots.txt`. But that is **only half** of its
triggers.

Sitemap and feed bodies are aggregated from every `seo_facts` provider, so
**publishing a post changes them without touching a single line written by
`seo_distribution`.** Because a module purge tags `t:<tenant>:m:<moduleKey>`,
`blog_content`'s publish purge cannot reach objects tagged `m:seo_distribution`.
What would remain is an asymmetry nothing reports: `/blog/{code}/feed.xml` gets
purged on publish, while `/feed.xml` — the same content, the host-resolved
spelling — stays stale until TTL.

`enqueueModuleContentPurge` therefore **also** purges modules that declare
`consumes` against the changed module **and** own a declared surface. Both
conditions matter:

- **Read from the registry, not hardcoded.** `blog_content` never mentions
  `seo_distribution` anywhere; the consumer's own `capabilities.consumes`
  declaration is the wire. The next `seo_facts` provider inherits this, and the
  next `blog_content` consumer is covered the day it declares itself.
- **Only consumers that own a surface.** A ban for a module key that tags no
  cached object matches nothing while the queue reports success — exactly the
  "ceremony that looks like coverage" the ownership gate already rejected for
  `media_library`. The obligation appears by itself the moment a consumer
  declares its first surface.

Both stay ONE enqueue statement, so the purge commits atomically with its content
change.

## Consequences

**What is gained.** Tenants on their own domain finally get edge acceleration for
their content pages, with invalidation already wired. ADR-0042 §8's
first-priority branch has a writer, so §B just reuses it instead of redesigning.

**What is paid.** One rule that neither types nor functional tests can guarantee,
and that can only be guarded as a contract over the source text
(`tests/news-routes-edge-cache-contract.test.ts`) — including an assertion that
the **fifth** `/news/**` route file that lands later is covered too, because the
list in that test is written by hand and a new route would inherit zero of its
guarantees. That test is mutation-proven: raising the publication above any gate
turns it red.

**What is deliberately NOT done.** There is no "guess from the `Host` header"
fallback in the middleware — the ADR-0042 §8 prohibition stands and this is
precisely why: the host→tenant mapping is configuration-dependent (ADR-0010 has
several modes, including one that disables host routing), and a wrong guess does
not fail loudly but tags one tenant's content with another tenant's key.
`/news/search` and `/news/feed.xml` still do not exist (ADR-0059 §D) — the host
root already serves both host-resolved — so there is no surface for them.

**Zero migrations, zero permissions, zero OpenAPI changes.** The change is
entirely in the presentation layer + the cache registry; an unset `EDGE_CACHE_MODE`
(the default for every deployment today) still makes the whole thing a no-op.
