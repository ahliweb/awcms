---
name: awcms-seo-distribution
description: The seo_distribution module has ALREADY been FULLY ported into this repo — DISCOVERY (ADR-0038; migrations sql/057 schema + sql/058 permissions + sql/059 feed columns) + REDIRECT GOVERNANCE (ADR-0039; migrations sql/060 schema 3 tables + sql/061 6 permissions). A `type: domain` module (v0.2.0, deps `[tenant_admin, identity_access, module_management]` — the last one added in #251) that is a CONSUMER/aggregator: centralised SEO metadata renderer (canonical/hreflang/robots/OG/controlled JSON-LD, host derived server-side from `tenant_domain`) + unauthenticated public discovery routes at the root host (`/robots.txt`, `/sitemap.xml`, `/sitemap-{n}.xml`, `/feed.xml`, `/atom.xml`, `/feed.json`, Astro XML/text routes NOT OpenAPI) + admin config `GET`/`PUT /api/v1/seo/config`. REDIRECT: exact-path redirect rules (`awcms_seo_redirects`), 404 telemetry (`awcms_seo_not_found_observations` + `dataLifecycle` descriptor), policy (`awcms_seo_redirect_settings`), all FORCE RLS; resolved in `src/middleware.ts` on the non-`/admin` branch (FAIL-OPEN) via `src/modules/seo-distribution/presentation/redirect-middleware.ts`; the open-redirect guard is frozen in `domain/redirect-target-classification.ts` (NOT in the `seo_facts` port); admin API `/api/v1/seo/redirects/*` + `/api/v1/seo/not-found/*`. awcms adaptations: host-based-only (path-tenant deferred), `locale=null`. **The legacy redirect `/blog/{tenantCode}` → `/news` is NO LONGER INERT** — ADR-0059 built the `/news/**` family, so that policy now has a real target. The six discovery routes are now also **edge cache surfaces** (ADR-0061 §B: `seo-robots` 600s, `seo-sitemap` 300s, `seo-feed` 300s) and `PUT /api/v1/seo/config` purges them; `resolveEnabledSeoProviders` PICKS the base path from the family that actually serves and contributes ZERO providers when a tenant turns both off (an empty sitemap, not a sitemap full of 404s). Consumes the `seo_facts` capability (`blog_content` provides it, seam `_shared/ports/seo-facts-port.ts`, `CAPABILITY_CONTRACT_VERSIONS["seo_facts"]="1.1.0"`) + `media_library` (optional). Use when changing the SEO renderer/serializer, tenant config, the `seo_facts` seam, discovery routes, or redirect/404 governance.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — SEO & Distribution (Discovery: renderer + sitemap/robots/feed + config)

> **STATUS — this module has ALREADY been FULLY ported into this repo (DISCOVERY ADR-0038 +
> REDIRECT GOVERNANCE ADR-0039).** `seo_distribution` lives in
> `src/modules/seo-distribution/`. Discovery: migrations `sql/057` (schema
> `awcms_seo_tenant_settings`, FORCE RLS) + `sql/058` (config permissions) + `sql/059`
> (feed/sitemap columns). Redirect governance: migrations `sql/060` (3 tables
> `awcms_seo_redirects`/`awcms_seo_not_found_observations`/`awcms_seo_redirect_settings`,
> all FORCE RLS) + `sql/061` (6 permissions `redirect.*`/`not_found.*`). The REAL
> redirect files exist now: `domain/redirect-*.ts` (incl.
> `redirect-target-classification.ts` = frozen guard, housed in the domain NOT in the
> `seo_facts` port), `application/redirect-*.ts`/`not-found-directory.ts`,
> `src/modules/seo-distribution/presentation/redirect-middleware.ts`, routes `src/pages/api/v1/seo/redirects/**` +
> `not-found/**`, and **one edit to `src/middleware.ts`** (non-`/admin` branch,
> FAIL-OPEN). awcms adaptations: host-based-only tenant resolution (path-tenant deferred),
> legacy-blog `/news` INERT (no `/news` route family), `locale=null` (no
> i18n seam).

## Module shape

- `key: seo_distribution`, `type: domain`, `version: 0.2.0`, `dependencies:
[tenant_admin, identity_access, module_management]` (the DAG stays acyclic — `module_management` depends only on the two Core modules). **CONSUMER/aggregator**,
  not a provider — no other module was made to depend on it.
- `capabilities.consumes`: `seo_facts` (providedBy `blog_content`, `optional`) +
  `media_library` (providedBy `media_library`, `optional`). Both `optional: true`
  → safe degradation (no facts/images → no pages/feed).
- `permissions`: `config.{read,update}` (discovery) + `redirect.{read,create,update,delete}`
  - `not_found.{read,update}` (redirect governance, ADR-0039). `dataLifecycle`:
    descriptor `seo_distribution.not_found_observations` (analytics_telemetry, generic
    purge). **There are NO `jobs`/`events`/`navigation`.**

## The `seo_facts` capability seam (THIS is the main extension point)

`seo_facts` is a **capability port** (`_shared/ports/seo-facts-port.ts`),
consumed via `capabilities.consumes` — **NOT** an array field on `ModuleDescriptor`.
The arrow points inward: content modules PROVIDE facts, `seo_distribution`
finds them at the route composition root (`src/modules/seo-distribution/presentation/discovery-providers.ts`) and
injects them as an ordinary parameter. `seo_distribution` never imports a content
module; nor the other way round.

- **`blog_content` = the only provider** (`module-composition.ts`
  `capability_provider_conflict` enforces one-provider-per-capability).
  `blog_content.capabilities.provides = ["public_content", "seo_facts"]`;
  the adapter `blog-content/application/seo-facts-port-adapter.ts` maps
  `awcms_blog_posts` rows → `SeoResourceFacts`.
- **Adding a new content provider**: the content module ships its own
  `<module>/application/seo-facts-port-adapter.ts` + adds `"seo_facts"`
  to its `provides`, then registers the adapter in `discovery-providers.ts`.
  `seo_distribution` does not need to know that content type (resourceType is opaque).
- **Versioning**: `CAPABILITY_CONTRACT_VERSIONS["seo_facts"] = "1.1.0"` (the port shipped
  straight away with `summarizePublicResourceFacts` + `offset`/`order`). The family
  manifest `awcms-family-compatibility.yaml` MUST match key-for-key (gate
  `family:conformance:check`). Raising the port → raise BOTH + semantic tests.
- **Visibility mapping (fail-safe, ADR-0038 §3)**: noindex (unlisted) rows /
  non-public rows (draft/private/archived/deleted) / not-yet-published rows (`published_at` null
  or in the future → reported as `scheduled`) → `sitemap:null`/`feed:null`. This is
  the provider-side defence against leaking unpublished content; the renderer/aggregator
  gates again via `isPubliclyIndexable` (defense in depth).

## Security invariants (frozen port guards — DO NOT re-derive them)

- **Host-header poisoning**: the canonical/OG/hreflang host is DERIVED server-side from
  the verified primary domain (`application/resolve-canonical-host.ts` →
  `awcms_tenant_domains.is_primary AND status='active'`), NEVER from the `Host`
  header. Without a primary host: canonical → relative path; **sitemap/feed → 404 (null)**
  (loc/id/guid MUST be absolute); robots.txt still returns 200 without a `Sitemap:` line.
- **JSON-LD injection**: ONLY `renderControlledJsonLd` (`_shared/ports/seo-facts-port.ts`)
  emits JSON-LD — closed union validation of `@type`/keys + escaping of
  `<>&`/U+2028/U+2029. DO NOT hand-serialize JSON-LD.
- **XML injection**: every sitemap/feed text/URL goes through `escapeXmlText`
  (`src/lib/html/escape.ts`, strips XML-illegal C0 + escapes the 5 entities). The JSON feed
  uses `content_text` (never tenant HTML).
- **Cache poisoning/cross-tenant**: `buildSeoCacheKey`/`buildDiscoverySignature` are
  tenant-first (they throw without tenant+host+locale). `awcms_seo_tenant_settings` is FORCE
  RLS. The signature is NUL-joined (free-text parts cannot merge across boundaries).
- **Sitemap amplification**: hard non-configurable ceilings in
  `domain/discovery-limits.ts` (`SITEMAP_URLS_PER_PAGE`/`SITEMAP_MAX_CHILD_PAGES`);
  the feed is bounded by `feed_item_limit` (≤200). No full content scan per request.

## Public discovery routes = Astro, NOT OpenAPI

`/robots.txt`, `/sitemap.xml`, `/sitemap-[page].xml`, `/feed.xml`, `/atom.xml`,
`/feed.json` in `src/pages/` (root host) — unauthenticated, **outside
`src/pages/api/v1`** so they are not subject to OpenAPI parity and not subject to the
middleware login guard. The pipeline lives in `src/modules/seo-distribution/presentation/discovery-route.ts` (`serveDiscovery`):
`withSeoPublicTenant` (tenant resolution via host, `PUBLIC_TRUST_PROXY`/
`PUBLIC_TENANT_RESOLUTION_MODE`; non-serving → generic latency-normalised 404)
→ `resolveEnabledSeoProviders` → builder → cache validator (304). **Only the admin
config `GET`/`PUT /api/v1/seo/config` is OpenAPI** (fragment
`openapi/modules/seo-distribution.openapi.yaml`, tag "SEO & Distribution");
`PUT` is high-risk → `Idempotency-Key` + audit.

## Port pitfalls

- `escapeXmlText`/`XML_ILLEGAL_C0` in `src/lib/html/escape.ts` and
  `escapeJsonLdText` in the port use **escape sequences** (e.g. the C0 range `\u0000-\u001F` and the separators `\u2028`/`\u2029`), not literal control/separator characters — do not write raw control/separator bytes into a file (Edit/Write can normalise them silently).
- The `blog_content` adapter builds the canonical `/blog/{slug}` (host-relative). The base
  currently only ships the legacy content route `/blog/{tenantCode}/{slug}` (ADR-0009); the
  host-based content route the sitemap/feed URLs point at is a **follow-up** — the
  discovery surface is still correct and safe.
- Adding a migration to these tables → a new sequential migration (≥060); regenerate
  the composition inventory + run the gates `family:conformance:check`,
  `modules:compose:check`, `api:spec:check` + regenerate the OpenAPI bundle.

## Verification

`bun run db:migrate` (057-059 are new), `bun run api:spec:check`,
`bun run family:conformance:check`, `bun run modules:compose:check`, `bun test`
(unit + DB-gated integration `tests/integration/seo-distribution.integration.test.ts`:
FORCE RLS under `awcms_app` LOGIN + discovery build returns published blog facts,
not drafts/private).
