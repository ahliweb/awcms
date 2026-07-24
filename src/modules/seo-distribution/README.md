# seo_distribution

Admitted by ADR-0038 (adapting awcms-micro ADR-0028), ported additively net-new
under the absorb-awcms-micro program (ADR-0035, `docs/awcms/absorb-awcms-micro-roadmap.md`
Wave 1). The DISCOVERY scope shipped in ADR-0038; the **redirect-governance scope
shipped in ADR-0039** (exact-path redirect rules + URL-change capture + 404
telemetry + one fail-open `src/middleware.ts` edit — see "Redirect governance"
below). This module is the **CONSUMER/aggregator of
SEO facts, not a provider** — content modules provide `seo_facts`;
`seo_distribution` composes them into public metadata + discovery surfaces. Nothing
in the base registry depends on it, and its lifecycle `dependencies` are only the
two Core modules (`tenant_admin`, `identity_access`), so the module DAG is
untouched.

## The central renderer (the reason the module exists)

`domain/seo-document.ts` + `domain/seo-head-rendering.ts` turn one resource's
`SeoResourceFacts` (the frozen `_shared/ports/seo-facts-port.ts` contract) plus the
tenant's SEO defaults plus the server-derived primary host into a single,
deterministic `<head>`:

- **canonical URL** — `https://{primary-host}{path}`, host **always** from the
  tenant's verified primary domain (`tenant_domain`, migration 046), never a
  request header; degrades to a relative canonical when there is no primary domain
  (offline-lan safe, no invented host);
- **hreflang alternates** (+ `x-default`) — only reciprocal, published locales;
- **title / description / robots** — resource facts win over tenant defaults;
- **Open Graph + Twitter card** — `og:url` = canonical; `og:image`/`twitter:image`
  resolved through `media_library` (same-tenant, verified), never a raw URL;
- **controlled JSON-LD** — `WebSite`/`Organization` (from tenant config) + provider
  `Article` nodes, emitted **only** through the port's `renderControlledJsonLd`
  guard (injection blocked by a closed `@type`/key schema, not ad-hoc
  sanitization), and **only** for indexable resources.

`application/seo-metadata-service.ts` is the composition point: it injects the
content module's `SeoFactsSource` adapter (provider) and `MediaLibraryPort`,
resolves the host (`application/resolve-canonical-host.ts`) and tenant defaults, and
returns the rendered head plus a tenant-first cache key (`buildSeoCacheKey`). It
imports no content module — the ports are plain parameters wired at the route
composition root.

### Publication-state handling

Every visibility decision delegates to the frozen guards `isPubliclyResolvable` /
`isPubliclyIndexable`. A resource the provider reports as draft / scheduled-future /
archived / deleted / private / unpublished is **not renderable** (the route returns
its usual 404/deny); a resolvable but `noindex` (or tenant-wide `noindex`) resource
renders with `robots: noindex` and carries **no** structured data. There is no code
path that emits an unpublished resource to public output.

### Tenant SEO defaults + admin API

`awcms_seo_tenant_settings` (sql/057, RLS FORCE'd, one row per tenant; feed config
columns added by sql/059) holds site identity, default social/Organization images,
Twitter/X handle, a tenant-wide `noindex` switch, and feed/sitemap config.
`GET`/`PUT /api/v1/seo/config` (`src/pages/api/v1/seo/config.ts`) reads/updates it:

- ABAC-gated (`seo_distribution.config.read` / `.update`, sql/058);
- `PUT` is high-risk — requires an `Idempotency-Key` and records an audit event on
  every write (`application/seo-config-directory.ts`);
- tenant-scoped (`withTenant` + RLS) — tenant A can never read or change tenant B's
  config.

## Public discovery / syndication

Public Astro XML/text routes at the host root (NOT OpenAPI — like the public
`/blog/{tenantCode}` content routes), unauthenticated by design, aggregating the
SAME `seo_facts` contract:

| Route              | Content       | Notes                                                                                                                                |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/robots.txt`      | `text/plain`  | Disallows `/admin/` + `/api/`; advertises the absolute sitemap; `Disallow: /` when the tenant-wide `noindex` is on.                  |
| `/sitemap.xml`     | sitemap index | Sizes itself from a bounded `summarize` roll-up; lists `/sitemap-{n}.xml` children (always ≥1, capped at the amplification ceiling). |
| `/sitemap-{n}.xml` | `<urlset>`    | One bounded page (`[(n-1)·perPage, n·perPage)` of the stable order) with reciprocal `hreflang` + published image refs.               |
| `/feed.xml`        | RSS 2.0       | Latest `feed_item_limit` (≤200) items, newest-first, stable permalink GUIDs, enclosure images. `?locale=` narrows.                   |
| `/atom.xml`        | Atom 1.0      | Same item set; Atom `<id>`/`<published>`/`<updated>`.                                                                                |
| `/feed.json`       | JSON Feed 1.1 | Same item set; `content_text` only (never tenant HTML).                                                                              |

- **`<loc>` / feed links are resolvable.** The discovery composition root scopes
  the blog `seo_facts` adapter to `/blog/{tenantCode}`, so every URL is
  `https://{host}/blog/{tenantCode}/{slug}` — resolvable by the shipped
  `/blog/[tenantCode]/[slug]` route today. When a host-based `/blog/{slug}`
  content route lands (follow-up), the base path becomes `/blog`.
- **Tenant-wide `noindex` suppresses ALL discovery surfaces**, not just
  `robots.txt`: with `default_robots_noindex` on, `/sitemap.xml`,
  `/sitemap-{n}.xml`, and the three feeds all return 404 (no machine-readable URL
  enumeration for non-`robots.txt`-respecting scrapers).
- **Tenant/host** resolved by `application/public-seo-tenant-resolution.ts`'s
  `withSeoPublicTenant` (server-controlled host via the shared
  `resolvePublicTenantFromRequest`, migration 048; host trusted only behind a
  trusted proxy, `PUBLIC_TRUST_PROXY`; host lookup gated by
  `PUBLIC_TENANT_RESOLUTION_MODE`), gate on `seo_distribution` enabled; every
  non-serving outcome is one generic, latency-normalized 404
  (`padUnresolvedSeoTenantLatency`).
- **Host is server-derived** from the tenant's verified **primary** domain — the
  arriving request host is NEVER used for URL generation (host-poisoning defense).
  When a tenant has **no** active primary domain, sitemap index/child + all feeds
  **404** (their `<loc>`/`<id>`/`<guid>` MUST be absolute — a relative-URL document
  is invalid), while `/robots.txt` still serves 200 and simply omits its `Sitemap:`
  line.
- **Bounded**: the sitemap index sizes from a single `summarize` aggregate; each
  child page is one bounded window; feeds are capped by `feed_item_limit`. No
  request enumerates all tenant content. Hard ceilings in
  `domain/discovery-limits.ts`.
- **Caching** (`domain/discovery-cache.ts`): a deterministic signature over
  `kind + tenantId + host + locale + contractVersion + configFingerprint +
contentRoll-up` (NUL-joined so the free-text parts cannot merge across their
  boundary; `tenantId` isolates tenants sharing the null-host sentinel) yields a
  strong `ETag` + `Last-Modified`; `If-None-Match`/`If-Modified-Since` → 304;
  `Cache-Control: public, max-age, s-maxage, stale-while-revalidate`. Because the
  validators derive from content/domain/config state, any
  publish/update/archive/delete/domain/locale/config change invalidates the
  affected output.
- **Composition root**: `src/lib/seo/discovery-providers.ts` wires the enabled
  `seo_facts` providers + media port; `src/lib/seo/discovery-route.ts` runs the
  pipeline. The module's own `application`/`domain` import no content module.

## Security posture (ADR-0038 threat model)

| Threat                         | Control                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host-header poisoning          | Canonical/OG/hreflang host is server-derived from `tenant_domain` (`resolve-canonical-host.ts`); the renderer never reads `Host`/`X-Forwarded-Host`.                      |
| JSON-LD injection              | Only `renderControlledJsonLd` emits JSON-LD (validates the controlled `@type`/key schema AND escapes `<>&`/U+2028/U+2029). No hand-serialized JSON-LD anywhere.           |
| Unpublished-content leakage    | `isPubliclyResolvable`/`isPubliclyIndexable` gate every emission; structured data only for indexable resources.                                                           |
| Cache poisoning / cross-tenant | Cache key/signature is tenant-first via `buildSeoCacheKey`/`buildDiscoverySignature` (throws without tenant+host+locale). Config table is RLS FORCE'd.                    |
| Metadata bounds                | Config lengths bounded in `domain/seo-config.ts` and by CHECK constraints in sql/057 + sql/059 (feed limit 1–200, include-list ≤50).                                      |
| Sitemap amplification          | Hard ceilings (`discovery-limits.ts`): `SITEMAP_URLS_PER_PAGE` + `SITEMAP_MAX_CHILD_PAGES`; feed items capped by `feed_item_limit` (≤200). No unbounded per-request scan. |
| XML injection                  | All sitemap/feed text/URL values XML-escaped (`escapeXmlText`, escape-never-reject; strips XML-illegal C0); JSON feed uses `content_text` (never tenant HTML).            |

## Contribution contract (`seo_facts`)

`blog_content` is the base's single declared `seo_facts` provider
(`blog-content/application/seo-facts-port-adapter.ts`) — it owns the public blog
post resources SEO renders (`awcms_blog_posts`, sql/035). A future content type
flows through the identical contract by shipping its own
`<module>/application/seo-facts-port-adapter.ts`; `seo_distribution` never learns
that type exists. Only one module may declare `provides: ["seo_facts"]` at a time
(`module-composition.ts`'s `capability_provider_conflict`). The port version is
registered at `1.1.0` in `_shared/capability-contract-versions.ts` (ADR-0015 rule).

## Redirect governance (ADR-0039)

The redirect-governance scope completes the module (migrations `sql/060` schema +
`sql/061` permissions):

- **Exact-path redirect rules** (`awcms_seo_redirects`, RLS FORCE'd) — 301/302/307/308,
  optional locale/host scope, effective window, `preserve_query`, soft-delete/restore/
  purge lifecycle. Resolved in `src/middleware.ts` on the non-`/admin` branch BEFORE
  content routing, EXCLUDING admin/API/auth/static/system/discovery paths
  (`domain/redirect-eligibility.ts`, enforced at resolve AND write time). Every target
  is routed through the frozen open-redirect guard
  (`domain/redirect-target-classification.ts` — re-homed as a standalone domain helper,
  NOT re-added to the `seo_facts` port) on write AND every resolve; chains are bounded +
  non-recursive and fail CLOSED on loop/over-cap.
- **URL-change capture** (`POST /api/v1/seo/redirects/capture-url-change`) turns an
  old→new path change into an audited redirect proposal (inactive) or active rule per
  the tenant's `url_change_auto_policy`.
- **Privacy-minimized 404 telemetry** (`awcms_seo_not_found_observations`, RLS FORCE'd)
  — aggregate rows (sanitized path + bare referrer domain only), a `dataLifecycle`
  analytics_telemetry descriptor (`seo_distribution.not_found_observations`, generic
  purge, 30d default) with a `SELECT, DELETE ... TO awcms_worker` grant.
- **The one invasive edit** `src/middleware.ts` is FAIL-OPEN: the resolver swallows all
  faults to null (never a 500), the 404 capture never throws; the `/admin` guard and
  API body-ceiling are untouched.

**awcms adaptations (ADR-0039):** tenant resolution is host-based-only first cut
(path-tenant deferred); the legacy `/blog/{tenantCode}` → `/news` rewrite is INERT (no
`/news` route family, policy off by default); `locale` is always null (no i18n seam).

## Documented follow-ups (out of discovery scope)

- **Host-based public content route.** The `blog_content` `seo_facts` adapter builds
  canonical paths under `/blog/{slug}` (host-relative, tenant-code-free) — the
  natural shape for a host-resolved tenant on its own domain. The base currently
  ships only the legacy `/blog/{tenantCode}/{slug}` content route (ADR-0009); a
  host-based content route that these sitemap/feed URLs point at is a follow-up
  (the same relationship awcms-micro's `/news` route had). The discovery surfaces
  are correct and secure regardless; only the resolvability of the exact canonical
  page depends on that route landing.
- **Resource-type coverage.** The `blog_content` adapter maps the `blog_post`
  resource type only. A generic `blog_page`, homepage/website identity, and
  `BreadcrumbList` facts are not yet produced by a provider — the contract is
  generic and the renderer/aggregator support them, but no adapter emits them yet.
- **Per-item feed author + full content.** The Atom feed carries a MANDATORY
  feed-level `<author>` (named for the publication — RFC 4287 §4.1.1); per-ENTRY
  author and full-body `content_html` are not in `SeoResourceFacts` yet (feeds use
  the summary as `content_text`).
- **Permission backfill.** `sql/058` seeds `seo_distribution.config.{read,update}`
  into the global catalog, so only tenants created AFTER that migration get them —
  a functional (not security) release step.
- **CDN/edge cache.** The discovery routes ship HTTP-level validators only; an
  opt-in, full-online-only CDN/edge integration is out of scope and must not
  degrade the offline-lan profile.
