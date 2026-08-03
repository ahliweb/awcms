---
"awcms": minor
---

The root discovery surfaces are edge-cacheable, and aggregate surfaces are now
invalidated by the modules that author them (ADR-0061 §B).

`serveDiscovery` accepts Astro's `locals` and publishes the resolved tenant after
`build(ctx)` produces a payload; all six routes (`/robots.txt`, `/sitemap.xml`,
`/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`) forward it. Three
registry entries follow: `seo-robots` (600s, config-derived and the most stable),
`seo-sitemap` (300s, index and child pages), `seo-feed` (300s, RSS/Atom/JSON with
`?locale=` as the only permitted parameter).

Publishing after the payload check matters here even more than it did for
`/news/**`: `build` returns `null` for "sitemaps disabled", "feeds disabled" and
"page out of range", all of which collapse into the same generic 404 as an
unknown host. It also means `/sitemap-99999.xml` matches the surface but never
publishes a tenant, so walking page numbers cannot fill the cache.

Discovery bodies turn out to have two authors, and only one of them owned the
surface. `PUT /api/v1/seo/config` now enqueues a purge — the tenant-wide
`noindex` switch alone rewrites `/robots.txt`. But the bodies are aggregated from
every `seo_facts` provider, so publishing a post changes `/sitemap.xml` without
touching anything `seo_distribution` writes, and a module purge tags
`t:<tenant>:m:<moduleKey>`, so `blog_content`'s purge could not reach it. Left
alone that would have purged `/blog/{code}/feed.xml` on publish while `/feed.xml`
— the same content — sat stale until TTL, with nothing reporting it.

`enqueueModuleContentPurge` therefore also covers modules that declare a
`consumes` dependency on the changing module and own a declared surface. It is
read from the module registry, so `blog_content` never names `seo_distribution`;
and it is limited to surface owners, because a ban on a key that tags no cached
object matches nothing while the queue reports success.

No migration, no permission, no OpenAPI change. With `EDGE_CACHE_MODE` unset the
subsystem remains a no-op.
