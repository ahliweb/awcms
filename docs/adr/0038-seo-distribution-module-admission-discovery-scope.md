🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0038-seo-distribution-module-admission-discovery-scope.id.md)

# ADR-0038 — Admission of `seo_distribution` (SEO discovery: renderer + sitemap/robots/feed + config) as a domain module

- **Status:** Accepted
- **Date:** 2026-07-24
- **Decision maker:** @ahliweb
- **Adapts:** awcms-micro `src/modules/seo-distribution/` (ADR-0028, epic #261 Wave 1) into the `awcms` base, per the absorption programme of [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) and the map [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) (Wave 1, net-new additive port + the `seo_facts` contribution seam).
- **Related:** ADR-0011 (capability ports), ADR-0015 (per-capability contract versioning), ADR-0026 (modular per-module OpenAPI), ADR-0034 (templates are used directly; modules live directly in `src/modules/`), ADR-0036 (`media_library`, consumed optionally), ADR-0009 (public tenant resolution by host/tenant code).

## Context

The `awcms` base already has public content (`blog_content`, migration `sql/035`) and host-based public tenant resolution (`tenant_domain`, migrations 046-048). What it does not have: one central place to derive public-page SEO metadata (canonical/hreflang/robots/OG/JSON-LD) and search-engine discovery surfaces (robots.txt, sitemap, RSS/Atom/JSON feeds). Without that, each content route derives metadata ad hoc — exactly the drift risk awcms-micro's ADR-0028 named.

awcms-micro already solved this with the `seo_distribution` module covering THREE things: (a) a central metadata renderer + tenant config (#266), (b) the public discovery/syndication surface (#267), and (c) redirect governance + 404 telemetry (#268). This ADR admits **ONLY (a) + (b) — the "discovery scope"** into this base; (c) is deferred to a follow-up PR (see §Deferred).

## Decision

### 1. Admit `seo_distribution` as a domain module (net-new additive, discovery scope)

- Name: **SEO & Distribution** · `key`: `seo_distribution` · `type: domain` · `version: 0.1.0` (discovery scope; redirects follow).
- `dependencies`: `["tenant_admin", "identity_access"]` — the DAG stays acyclic (both are already earlier in the registry). This module is a **CONSUMER/aggregator**, not a provider: no other module is made to depend on it.
- Owned by the module: **one per-tenant config table** `awcms_seo_tenant_settings` (migration `sql/057`, feed columns added in `sql/059`) — site identity, default social/Organization image, Twitter handle, the tenant-wide noindex switch, plus feed/sitemap config. RLS ENABLE+FORCE + `tenant_isolation` (`awcms_app` is a non-owner, so ENABLE alone would be inert). Plus pure renderers/serializers in `domain/` and orchestrators in `application/`.

### 2. The `seo_facts` contribution seam (a capability port, NOT a descriptor field)

`seo_facts` is a **capability port** (`_shared/ports/seo-facts-port.ts`), consumed via `capabilities.consumes` — NOT a new array field on `ModuleDescriptor`. The arrow points inward (ADR-0028 §2): the content module (`blog_content`) PROVIDES `seo_facts`; `seo_distribution` finds its adapter at the route composition root and injects it as an ordinary parameter — `seo_distribution` never imports content module internals, and vice versa. `capabilities.consumes` is a source-level relation (optional, degrades safely), NOT a lifecycle edge, so it does not constrain the DAG.

- `blog_content` becomes the sole `seo_facts` provider in the base (`module-composition.ts`'s `capability_provider_conflict` enforces one provider per capability). `blog_content.capabilities.provides` becomes `["public_content", "seo_facts"]`; its adapter `application/seo-facts-port-adapter.ts` maps `awcms_blog_posts` rows → neutral `SeoResourceFacts` (noindex/non-public/unpublished rows → `sitemap:null`/`feed:null`).
- `CAPABILITY_CONTRACT_VERSIONS["seo_facts"] = "1.1.0"` (ADR-0015): the first number assigned for this base is `1.1.0`, not `1.0.0` — this port ships DIRECTLY with the `summarizePublicResourceFacts` roll-up + the `offset`/`order` list options (awcms-micro's 1.1.0 minor), so declaring 1.0.0 would understate the shape consumers actually bind to. The family manifest (`awcms-family-compatibility.yaml`) is kept in sync (the `family:conformance:check` gate matches key for key).
- `seo_distribution` also `consumes` `media_library` (ADR-0036) for OG/Organization/feed image resolution — optional, degrading to text-only cards/feeds.

### 3. Renderer & serializer safe by construction (contract constraints as teeth, not convention)

Every security-sensitive decision is delegated to a frozen port guard, never re-derived:

- **Host-header poisoning** — the canonical/OG/hreflang host is DERIVED server-side from the verified primary domain (`resolve-canonical-host.ts` → `awcms_tenant_domains.is_primary` + `status='active'`), never from the `Host` header. Without a primary host, canonical degrades to a relative path (it does not invent a host); sitemap/feed **404** (loc/id/guid MUST be absolute).
- **JSON-LD injection** — only `renderControlledJsonLd` emits JSON-LD (closed `@type`/key union validation + escaping of `<>&`/U+2028/U+2029). No JSON-LD is hand-serialized.
- **Unpublished content leakage** — `isPubliclyResolvable`/`isPubliclyIndexable` gate every emission; structured data only for indexable resources; the same eligibility predicate is used by listing AND summarize (they must not drift).
- **Cache poisoning / cross-tenant** — cache key/signature are tenant-first (`buildSeoCacheKey`/`buildDiscoverySignature` throw without tenant+host+locale). The config table is RLS FORCE'd.
- **Sitemap amplification / XML injection** — hard non-configurable ceilings (`discovery-limits.ts`); every text/URL is XML-escaped (`escapeXmlText`, escape-never-reject, stripping XML-illegal C0); the JSON feed uses `content_text` (never tenant HTML).
- **Whole-site `default_robots_noindex`** suppresses ALL discovery surfaces (sitemap index/page + RSS/Atom/JSON feed → 404), not just `robots.txt` (`Disallow: /`) and the per-page `<head>` — so a noindexed staging deployment does not leak URL enumeration to non-compliant scrapers/aggregators (audit MEDIUM-1). This gate mirrors `buildSeoDocument`.
- **The rendered host is self-defending** — `resolve-canonical-host.ts` re-validates the primary host's DNS shape (a `normalizePublicHost` round-trip) at the render boundary before placing it into `https://{host}...`, so a future relaxation of domain-write validation cannot inject CR/LF into robots/sitemap/feed (an out-of-shape host → `null` → 404).

### 4. The public discovery surface is Astro routes, NOT a REST contract

`/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json` are unauthenticated XML/text Astro routes at the host root — **deliberately outside `src/pages/api/v1`**, so they are not part of the OpenAPI contract (the same posture as the public content route `/blog/{tenantCode}`). Tenant/host resolution goes through `withSeoPublicTenant` → the shared resolver `resolvePublicTenantFromRequest` (migration 048; the host is trusted only behind `PUBLIC_TRUST_PROXY`, host lookup is gated by `PUBLIC_TENANT_RESOLUTION_MODE`), and every non-serving outcome collapses into a single latency-normalised generic 404. These routes are NOT under `/admin`, so the middleware login guard does not touch them — `src/middleware.ts` is NOT edited.

Only the **admin config** surface (`GET`/`PUT /api/v1/seo/config`) becomes an OpenAPI contract (fragment `openapi/modules/seo-distribution.openapi.yaml`, tag "SEO & Distribution"): `config.read`/`config.update` (seeded in `sql/058`), tenant-scoped (`withTenant` + RLS), `PUT` is high-risk (it rewrites the public metadata/indexability surface) → requires an `Idempotency-Key` + is audited on every write.

## Deferred (follow-up redirect governance PR)

- **Redirect rules + the redirect hook in `src/middleware.ts`.** awcms-micro's exact-path redirect resolution (a redirect table, resolved in middleware before public content routing) is out of scope — no redirect table/permission/route is created, and `src/middleware.ts` is NOT edited. The redirect guard port (`classifyRedirectTarget`/`assertSafeRedirectTarget`) is deferred too (see the header of `_shared/ports/seo-facts-port.ts`) and comes back as a backward-compatible standalone helper (not a `SeoFactsSource` method).
- **404 telemetry + the `dataLifecycle` descriptor.** awcms-micro's privacy-minimised 404 governance table and the module's `dataLifecycle` descriptor referencing it are DEFERRED — this module therefore does not yet declare `dataLifecycle`, does not seed `redirect.*`/`not_found.*` permissions, and does not grant table access to `awcms_worker`.
- **Host-based public content route (a refinement, not a blocker).** The discovery composition root scopes `blog_content`'s `seo_facts` adapter to the base path `/blog/{tenantCode}` (via `createBlogContentSeoFactsAdapter`), so every `<loc>`/feed link = `/blog/{tenantCode}/{slug}`, which **RESOLVES to the already-shipped content route** `/blog/[tenantCode]/[slug]` (ADR-0009) today — not `/blog/{slug}`, which would 404. When the host-based public content route `/blog/{slug}` (host-resolved, without a tenant-code segment) lands in a follow-up, the base path only needs to change to `/blog`. So the discovery surface is now correct **and** its URLs are resolvable; previously (pre-review) the canonical `/blog/{slug}` pointed at a 404 — that is fixed in this PR.

## Consequences

- Positive: one central SEO renderer + a proven discovery surface, a frozen `seo_facts` seam that lets any content type contribute without `seo_distribution` knowing about it, host-poisoning/JSON-LD/content-leak defences encoded in the port guards, and tenant config that is RLS FORCE'd + audited.
- Cost: two public env vars documented (`PUBLIC_TRUST_PROXY`, `PUBLIC_TENANT_RESOLUTION_MODE`) in `.env.example` (shared with the host resolver); `CAPABILITY_CONTRACT_VERSIONS` gains `seo_facts`; the `escapeXmlText` helper + a `text/plain` error variant are added to `src/lib/html/*` (additive).
- Limitations (see `src/modules/seo-distribution/README.md`): redirect governance + 404 telemetry are deferred; the `seo_facts` adapter maps only the `blog_post` type; canonical is currently `/blog/{tenantCode}/{slug}` (resolvable) until the host-based content route `/blog/{slug}` lands; child-sitemap pagination is still `OFFSET`-based (bounded at 1000 pages + cached with `s-maxage`; migrating to keyset is follow-up hardening for tenants with millions of items — audit LOW-1); per-item feed author + `content_html` are not in the facts contract yet; the permission backfill covers new tenants only.

## Rejected alternatives

- **Making `seo_facts` a new array field on `ModuleDescriptor`** (e.g. `seoFacts`/`searchSources`) — mixes a source-level capability seam with the descriptor seam; `seo_facts` already fits as a capability port (`capabilities.consumes`, single-provider validated by composition). Rejected.
- **Porting redirect governance + 404 in one go** — inflates the PR with middleware edits + redirect/404 tables + `dataLifecycle` + permissions, raising the regression risk on the login/routing path. Rejected; discovery first (purely additive, no middleware edit), redirects follow in their own PR.
- **Exposing the discovery routes as `/api/v1` endpoints** — sitemap/robots/feed are machine-consumable documents at the host root for crawlers, not an authenticated tenant API; making them OpenAPI would mis-model them and force authentication that makes no sense. Rejected (the same posture as `/blog/{tenantCode}`).
