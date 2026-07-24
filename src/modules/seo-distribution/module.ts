import { defineModule } from "../_shared/module-contract";
import {
  SEO_CONFIG_ACTIVITY_CODE,
  SEO_MODULE_KEY
} from "./domain/seo-permissions";

/**
 * `seo_distribution` — admitted by ADR-0038 (adapting awcms-micro ADR-0028), ported
 * additively net-new under the absorb-awcms-micro program (ADR-0035,
 * `docs/awcms/absorb-awcms-micro-roadmap.md` Wave 1). **This is the DISCOVERY
 * scope of that module** — see "Deliberately deferred" below.
 *
 * ## What this module OWNS (discovery scope)
 *
 * The central, tenant/domain/locale-aware SEO metadata renderer for public pages
 * plus the public discovery/syndication surfaces:
 *
 * - The central document builder/renderer (`domain/seo-document.ts` +
 *   `domain/seo-head-rendering.ts`) that turns one resource's `SeoResourceFacts`
 *   (the frozen `_shared/ports/seo-facts-port.ts` contribution contract) plus this
 *   module's per-tenant SEO defaults (`awcms_seo_tenant_settings`, sql/057 + sql/059)
 *   plus the tenant's server-derived primary host (`tenant_domain`, migration 046)
 *   into a single deterministic `<head>`: canonical URL, reciprocal `hreflang`
 *   alternates + `x-default`, title/description/robots meta, Open Graph + Twitter
 *   card, and controlled schema.org JSON-LD.
 * - The public XML/text discovery routes at the host root — `/robots.txt`, the
 *   sitemap index + bounded child sitemaps (`/sitemap.xml`, `/sitemap-{n}.xml`), and
 *   RSS/Atom/JSON feeds (`/feed.xml`, `/atom.xml`, `/feed.json`) — served as public
 *   Astro routes (NOT OpenAPI), aggregating the SAME frozen `seo_facts` contract,
 *   host server-derived from `tenant_domain`, with HTTP cache validators
 *   (ETag/Last-Modified/304) and per-tenant feed config (sql/059).
 * - The tenant SEO config admin surface: `GET`/`PUT /api/v1/seo/config`
 *   (`src/pages/api/v1/seo/config.ts`), ABAC-gated by `config.read`/`config.update`
 *   (sql/058), tenant-scoped (`withTenant` + RLS FORCE), the `PUT` audited.
 *
 * ## Direction of the arrow (ADR-0038 §2) — this module DEPENDS on nothing but Core
 *
 * `seo_distribution` is the CONSUMER/aggregator: content modules PROVIDE
 * `seo_facts`; this module discovers their adapters at the route composition root
 * and injects them. So `consumes` names `seo_facts` (from `blog_content`, the module
 * that owns the public content resources SEO renders) and `media_library`
 * (OG/Twitter/Organization image resolution) — both `optional: true`, degrading
 * safely when a tenant hasn't enabled them. NO existing module is made to depend on
 * `seo_distribution`, and its lifecycle `dependencies` are ONLY the two Core modules
 * (`capabilities.consumes` is not a lifecycle edge — `module-contract.ts`), keeping
 * the DAG acyclic.
 *
 * ## Deliberately deferred (redirect-governance follow-up PR)
 *
 * This module lands the DISCOVERY half of awcms-micro's `seo_distribution`. The
 * REDIRECT-governance half is DEFERRED to a follow-up PR and is intentionally NOT
 * built here:
 *
 * - **Redirect rules + the `src/middleware.ts` redirect hook.** awcms-micro's
 *   exact-path redirect resolution (redirect tables sql/083, resolved in the
 *   middleware before public content routing) is out of scope — no redirect
 *   table/permission/route is created, and `src/middleware.ts` is NOT edited. The
 *   frozen port's redirect guards (`classifyRedirectTarget`/`assertSafeRedirectTarget`)
 *   are likewise deferred (see `_shared/ports/seo-facts-port.ts`'s header).
 * - **404 telemetry + the `dataLifecycle` descriptor.** awcms-micro's
 *   privacy-minimized 404 governance table (sql/083) and the module's
 *   `dataLifecycle` descriptor that references it are DEFERRED — this module
 *   therefore declares NO `dataLifecycle` yet.
 * - **`redirect.*` / `not_found.*` permissions.** Only `config.{read,update}` are
 *   seeded (sql/058); the redirect/404 permissions land with their own tables/routes.
 *
 * `navigation`, `events`, and `jobs` stay undeclared for the same reasons as
 * awcms-micro's #266/#267 slice: the config surface is an API, not an admin screen
 * (a documented follow-up); discovery is live per request; there is no module-owned
 * job in the discovery scope.
 */
export const seoDistributionModule = defineModule({
  key: SEO_MODULE_KEY,
  name: "SEO & Distribution",
  version: "0.1.0",
  status: "active",
  description:
    "Central tenant/domain/locale-aware SEO metadata renderer for public pages plus the public discovery/syndication surfaces (ADR-0038, discovery scope; adapts awcms-micro ADR-0028). Owns `awcms_seo_tenant_settings` (sql/057 + sql/059 — per-tenant SEO defaults: site identity, default social image, Twitter handle, Organization identity, a tenant-wide noindex switch, and feed/sitemap discovery config, RLS FORCE'd) and the central document builder/renderer (`domain/seo-document.ts` + `domain/seo-head-rendering.ts`) that emits canonical URL, reciprocal hreflang alternates + x-default, title/description/robots meta, Open Graph + Twitter card, and controlled schema.org JSON-LD. It is the CONSUMER/aggregator of the frozen `seo_facts` contribution contract (`_shared/ports/seo-facts-port.ts`): content modules (`blog_content`, and any future content type) PROVIDE `SeoResourceFacts`; this module discovers their adapters at the route composition root and never imports a content module's internals. The canonical host is server-derived from the tenant's verified primary domain (`tenant_domain`), NEVER a request header (host-header-poisoning defense); OG/Organization images resolve through `media_library` (same-tenant, verified); JSON-LD is emitted only through the port's `renderControlledJsonLd` guard (injection blocked by a controlled `@type`/key schema, not ad-hoc sanitization); publication state is honored via the port's `isPubliclyResolvable`/`isPubliclyIndexable` (draft/scheduled/archived/deleted/private/unpublished/noindex never reach public output); and the render/discovery cache keys are tenant-first (`buildSeoCacheKey`/`buildDiscoverySignature`). The public discovery surfaces — robots.txt, the sitemap index + bounded child sitemaps, and RSS/Atom/JSON feeds — are public Astro XML/text routes aggregating the same `seo_facts` contract, with tenant/domain/locale-specific ETag/Last-Modified caching and per-tenant feed config (sql/059). DEFERRED to a redirect-governance follow-up PR (NOT built here): exact-path redirect rules, the `src/middleware.ts` redirect hook, the privacy-minimized 404 telemetry table, this module's `dataLifecycle` descriptor for it, and the `redirect.*`/`not_found.*` permissions.",
  dependencies: ["tenant_admin", "identity_access"],
  type: "domain",
  capabilities: {
    consumes: [
      // `seo_facts` — the contribution contract this module aggregates. Provided
      // by `blog_content` (which owns the public post/page resources SEO renders).
      // Optional: a tenant with no content module enabled simply contributes no
      // resource facts, and the aggregator degrades (no page/feed to render).
      { capability: "seo_facts", providedBy: "blog_content", optional: true },
      // `media_library` — OG/Twitter/Organization/feed image resolution
      // (same-tenant, verified). Optional: absent → text-only social cards / feeds
      // without enclosure images.
      {
        capability: "media_library",
        providedBy: "media_library",
        optional: true
      }
    ]
  },
  api: {
    openApiPath: "openapi/modules/seo-distribution.openapi.yaml",
    basePath: "/api/v1/seo"
  },
  permissions: [
    {
      activityCode: SEO_CONFIG_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's SEO defaults (site identity, default social image, robots policy, feed/sitemap config)"
    },
    {
      activityCode: SEO_CONFIG_ACTIVITY_CODE,
      action: "update",
      description:
        "Update this tenant's SEO defaults — changes the public metadata/indexability/discovery surface (high-risk, audited)"
    }
  ]
});
