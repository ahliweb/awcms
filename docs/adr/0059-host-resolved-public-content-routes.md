🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0059-host-resolved-public-content-routes.id.md)

# ADR-0059 — Host-resolved public content routes: the `/news/**` family, not `/blog/{slug}`

- **Status:** Superseded by [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
- **Date:** 2026-08-03
- **Decision makers:** @ahliweb
- **Related:** [ADR-0009](0009-public-tenant-scoped-routes.md) (path-based public routes `/blog/{tenantCode}`), [ADR-0010](0010-public-host-tenant-routing.md) (tenant resolution from host + `PUBLIC_TENANT_RESOLUTION_MODE`), [ADR-0038](0038-seo-distribution-module-admission-discovery-scope.md) (discovery routes + `seo_facts` seam), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (edge cache surfaces), [ADR-0044](0044-merge-news-portal-into-blog-content.md) (precedent: ownership moves, surface names do not), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (capabilities are built here, not ported)

> **Read this as history.** [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
> (8 August 2026) splits the family's public URL vocabulary: `/blog/**` belongs to this
> repo, `/news/**` belongs to `awcms-astro`. The route family this ADR landed is
> therefore **not built here** — what was revoked is its address, not its capability.
> Two decisions below **still hold** and are restated in ADR-0071 §3
> so they do not fall with it: the §C invariant ("never advertise a URL we do
> not serve") and the §E refusal to declare a host-resolved edge cache surface
> before the per-host key is verified. The sentences of this ADR are deliberately
> not rewritten (ADR index Rule 2).
>
> The routes still exist under `src/pages/news/` at the time this banner was written; ADR-0071 §4
> schedules their removal and `tests/url-vocabulary-split.test.ts`
> enforces that schedule in both directions.

## Context

### 1. The defect recorded in the backlog turned out NOT to be that defect

`docs/PROJECT_STATE.md` §4 (3 August 2026) records, as a finding "sharper than
the follow-up":

> `createBlogContentSeoFactsAdapter` uses `DEFAULT_PUBLIC_BASE_PATH` `/blog`,
> so every canonical/`<loc>`/feed link emitted by `seo_distribution`
> points at `/blog/{slug}` … for a host-resolved tenant, **every URL in the sitemap
> and feed points at a page that 404s**.

Verified against the code, that claim is **wrong**. The discovery routes never used
that default. The only composition root that builds the adapter for them —
`src/modules/seo-distribution/presentation/discovery-providers.ts` — calls

```ts
providers.push(createBlogContentSeoFactsAdapter(`/blog/${tenantCode}`));
```

and `git log -S` shows that line has been there **since the module landed** (#223).
The function's docblock even spells out why: "there is no host-based
`/blog/{slug}` route in this base yet … Advertising `/blog/{slug}` would 404 for
crawlers." The default value `/blog` on `createBlogContentSeoFactsAdapter` is only
used by the `blogContentSeoFactsAdapter` singleton, which has **zero callers in
`src/`** (tests only). Six discovery routes pass through a single choke point,
`serveDiscovery` → `resolveEnabledSeoProviders`, so there is no second path that
could bypass it.

This is an error class this repo already knows (see ADR-0058 §1: two "findings"
written straight down as decisions when the routes contradicted them). Recorded
here so the correction has a reference, and so the next backlog item is read
as a claim that must be verified.

### 2. The defect that ACTUALLY exists: host-resolved mode has no content routes

What is genuinely missing is not the correctness of sitemap URLs but the route family
itself. `tenant_domain` (#219) maps host → tenant, `seo_distribution`
(#223/#224) serves `/robots.txt`, `/sitemap*.xml`, `/feed.*` at the host root,
`site_search` (#231) serves `/search` at the host root, `comments` (ADR-0041)
serves its public comment API host-resolved. But **the content all those surfaces
point at can only be read via `/blog/{tenantCode}/{slug}`**.

The consequence is that a tenant with its own domain — precisely the case `tenant_domain`
exists to serve — publishes a sitemap at `https://acme.com/sitemap.xml` in which
every `<loc>` has the form `https://acme.com/blog/acme/hello-world`: correct,
resolvable, and carrying the very identifier the decision to use its own domain
removed. The ADR-0010 promise ("clean URLs without a tenant code") never reached
the content layer.

### 3. `/blog/{slug}` cannot be its shape — proven, not assumed

The shape the backlog named (`/blog/{slug}`) **collides** with the ADR-0009 listing
route (`/blog/{tenantCode}`): both are a single dynamic segment under `/blog`,
so `/blog/anything` is ambiguous — post slug or tenant code?

Tested directly in this repo (probe file `src/pages/blog/[slug].ts`, then
`bun run build`, then deleted):

```
[WARN] [router] The route "/blog/[slug]" is defined in both "src/pages/blog/[slug].ts"
and "src/pages/blog/[tenantCode]/index.ts" using SSR mode. A dynamic SSR route
cannot be defined more than once.
[WARN] [router] A collision will result in a hard error in following versions of Astro.
```

The build **still succeeds**. So the cost is not a visible failure but one route
silently shadowing another today, and a hard build failure on the next Astro
version. Resolving it at runtime (one file guessing "is this a slug or a tenant code?")
merely moves the ambiguity somewhere worse: anyone allowed to write a post slug
could shadow another tenant's listing URL, or conversely a new tenant code kills
an already-indexed post URL — two failure directions, both silent.

### 4. The archive's `publicBasePath` is a factory for the same defect

`awcms-micro` (archive, ADR-0055) solved this with a physical route family
`/news/**` plus per-tenant settings `publicBasePath`/`publicLabel`. Its own
documentation states the limit: that setting **only changes self-referential URLs**
(canonical, `<loc>`, internal links) and does **not** move the file-based route
that actually serves. That means setting it to any value other than the physical
path produces exactly the defect this ADR closes — a surface that
advertises URLs which 404 — only per-tenant and without a gate. That setting is
**not** adopted.

## Decision

### A. The host-resolved route family lives at `/news/**`, four routes

`/news` (index), `/news/{slug}` (detail), `/news/category/{slug}`,
`/news/tag/{slug}`. Without a `tenantCode` segment: the tenant is resolved from the request
(`resolvePublicTenantFromRequest`, ADR-0010) exactly like `/search` and the
discovery routes.

Why `/news` and not new vocabulary: it is the only name this repo **already**
uses for the same surface (`awcms_news_portal_*`,
`/api/v1/news-portal/*`, `NEWS_MEDIA_R2_*`, OpenAPI tag `News Media`), and
`blog_content/module.ts` plus its README already describe `/news/**` as a family
that is **deliberately absent** ("PORT-TIME DROPS"). This decision
activates a design that is already written down, it does not add a third design. Its
naming precedent is ADR-0044 §3/§6 and ADR-0036: ownership moves, surface names do
not.

**What is deliberately NOT included**: `/news/feed.xml`, `/news/sitemap-news.xml`,
`/news/search`. All three are already served host-resolved at the host root
(`/feed.xml`, `/atom.xml`, `/feed.json`, `/sitemap.xml`, `/sitemap-{n}.xml`,
`/search`). Duplicating them means one host has two sitemaps and two enforcement
points for `rssEnabled` — an SEO cost and a source of divergence, with no new capability.

The legacy `/blog/{tenantCode}` family is **unchanged and not retired**
(ADR-0009 still holds): the two live side by side, each with its own per-tenant
switch.

### B. One shared gate, the same shape as `site_search` and `comments`

`withHostResolvedBlogTenant` (`blog-content/application/public-host-route-tenant-resolution.ts`):
host resolution → check `blog_content` module enabled → check the tenant's `publicRouteMode` →
run the handler inside a single `withTenantOrThrow`. Every non-serving outcome
collapses to the same `null` (generic 404) — never leaking which one — and
the "tenant not resolved" branch pays the same round-trip shape via
`padUnresolvedHostRouteLatency` (`withSiteSearchTenant`/`withCommentsTenant`
already set the pattern; without padding, latency answers "this hostname maps
to an active tenant").

The new switch is `publicRouteMode` (`domain_default` | `disabled`, default
`domain_default`) in the descriptor's `settings.defaults` — an existing store, not a
third store, and symmetric with the legacy family's `legacyTenantRouteEnabled`.
Fail-safe normalization on the read side (the module-settings framework does not
validate per-field types).

### C. The SEO base path follows the family that actually serves

`resolveEnabledSeoProviders` now reads the tenant's public route settings and chooses:

| `publicRouteMode` | `legacyTenantRouteEnabled` | canonical/`<loc>`/feed base path |
| ----------------- | -------------------------- | -------------------------------- |
| `domain_default`  | anything                   | `/news`                          |
| `disabled`        | `true`                     | `/blog/{tenantCode}`             |
| `disabled`        | `false`                    | **zero providers** — no URLs     |

The third row is the heart of the rule: if a tenant turns BOTH families off, there is
no content URL that can be advertised, so its sitemap/feed is empty instead of
carrying links that are certain to 404. The invariant "never advertise a URL we do
not serve" is enforced by tests, not just prose.

The discovery routes are resolved with the same host resolver as the `/news`
family, so the two always agree about which tenant is meant.

### D. Zero migrations, zero new permissions, zero OpenAPI changes

Anonymous public routes have no permission guard and — following the precedent of
`/blog/{tenantCode}` and the discovery routes (ADR-0038 §4) — sit outside the
OpenAPI contract. Route ownership is declared by adding `"/news"` to
`blog_content.api.routes` (`modules:routes:check`).

### E. Edge cache: no surface is declared yet, and that is a decision

`/news/**` is a **host-resolved** surface: its path is identical for every
tenant, so its cache key must include the host. `surface-registry.ts` already
holds back the root discovery surfaces for its neighbour's reason (the tenant cannot
be derived from the path) and states "a dead declaration is worse than an honest
omission". Declaring `/news/**` before the per-host key is verified in the VCL
is the most direct way to install a cross-tenant leak in a shared cache.
So: not declared → `surface_not_declared` → `Cache-Control: private,
no-store`. The same follow-up as root discovery (thread `locals`, per-host
key), recorded in `docs/awcms/edge-cache-architecture.md`.

## Consequences

- Host-resolved deployments finally have content URLs without a tenant code, and
  their sitemap/feed/canonical point at them.
- A tenant can now switch off its entire public content surface (both
  families `disabled`/`false`) — and its sitemap goes empty with it, rather than broken.
- Two route families for the same content means two URLs for one post on a
  deployment that enables both. That is **controlled duplication**, not
  ambiguity: the canonical is always exactly one (table §C), so search engines are given one
  answer. A tenant that does not want it switches one of them off.
- `/news` becomes a reserved word on any host. Consistent with the edge-cache
  `RESERVED_SEGMENTS` and with `/search`; recorded in the module README.
- `/news/**` routes are not edge-cached until the §E follow-up lands.

## Rejected alternatives

1. **`/blog/{slug}` (the shape the backlog named)** — the route collision
   proven in §3; silent today, hard failure later.
2. **One file that guesses slug-or-tenant-code at runtime** — moves the
   ambiguity into a de-facto authorization layer: a content author could shadow another
   tenant's URL, or a new tenant code kills an indexed post URL.
3. **A slug at the host root (`/{slug}`)** — swallows every single-segment path, collides with
   `/[...path]` (which runs redirect resolution and `seo_distribution` 404
   logging), and pre-empts `awcms_blog_pages`, which is the natural owner
   of root slugs.
4. **A per-tenant `publicBasePath` setting (the archive's version)** — §4: changing links
   without moving routes = producing 404 URLs per tenant, without a gate.
5. **Retiring `/blog/{tenantCode}`** — ADR-0009 is the only shape
   that works with no DNS/TLS at all (LAN/offline deployments, doc 18).
