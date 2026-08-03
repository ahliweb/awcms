---
"awcms": minor
---

Add the host-resolved public content family `/news/**` (ADR-0059), and make the SEO discovery base path follow the route family that actually serves.

`tenant_domain` has mapped hosts to tenants since #219 and the discovery surfaces (`robots.txt`, sitemaps, feeds) and `/search` have been host-resolved since #223/#231 — but the content those surfaces point at could only be read through `/blog/{tenantCode}/{slug}`. A tenant on its own domain therefore published URLs carrying the very identifier the domain exists to remove. Four routes close that: `/news`, `/news/{slug}`, `/news/category/{slug}`, `/news/tag/{slug}`, resolving the tenant from the request through `withHostResolvedBlogTenant` — the same shape as `site_search`/`comments`, including the latency padding that keeps "unknown host" and "live tenant" indistinguishable in time as well as in body. The family has its own per-tenant switch, `publicRouteMode`, symmetric with the legacy family's `legacyTenantRouteEnabled`.

The backlog asked for `/blog/{slug}`, and that shape was refused with evidence: probed in this repo, Astro reports the route "is defined in both" `src/pages/blog/[slug].ts` and `src/pages/blog/[tenantCode]/index.ts`, still builds, and lets one silently shadow the other — "a collision will result in a hard error in following versions of Astro". Resolving the ambiguity at runtime would be worse: whoever can write a post slug could shadow another tenant's listing URL. The archived `publicBasePath`/`publicLabel` settings are not adopted either, because they move a page's links without moving the route that serves them.

`seo_distribution` now chooses its base path instead of assuming one: `/news` while the host-resolved family is live, `/blog/{tenantCode}` when a tenant switched that off but kept the legacy family, and **no provider at all** when both are off — an empty sitemap rather than one full of certain 404s. That invariant is mutation-proven against a real database.

Also corrected, because it was recorded as a decision: the "every sitemap `<loc>` 404s for host-resolved tenants" defect in `docs/PROJECT_STATE.md` never existed. `discovery-providers.ts` has scoped the adapter to `/blog/{tenantCode}` since the module landed (#223), and the `/blog` default it was blamed on has zero callers in `src/`.

Zero migrations, zero permissions, zero OpenAPI change. `/news/**` is deliberately not yet a declared edge-cache surface: its path is identical for every tenant, so the cache key has to carry the host first.
