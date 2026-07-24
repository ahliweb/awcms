import { defineModule } from "../_shared/module-contract";
import {
  SEO_CONFIG_ACTIVITY_CODE,
  SEO_MODULE_KEY,
  SEO_NOT_FOUND_ACTIVITY_CODE,
  SEO_REDIRECT_ACTIVITY_CODE
} from "./domain/seo-permissions";

/** data_lifecycle registry key for the privacy-minimized 404 governance table (ADR-0039). */
export const SEO_NOT_FOUND_LIFECYCLE_KEY =
  "seo_distribution.not_found_observations";

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
 * ## Landed in ADR-0039 (redirect-governance scope — companion to ADR-0038)
 *
 * Controlled, tenant-contained redirect governance + broken-link telemetry:
 * exact-path redirect rules (`awcms_seo_redirects`, sql/060, RLS FORCE'd) resolved in
 * `src/middleware.ts` on the non-`/admin` branch BEFORE public content routing and
 * EXCLUDING admin/API/auth/static/system/discovery paths
 * (`domain/redirect-eligibility.ts`, enforced at BOTH resolve and write time); the
 * policy-gated legacy `/blog/{tenantCode}` → `/news` auto-redirect (INERT in awcms —
 * no `/news` route family); audited URL-change capture; bounded non-recursive
 * chain/loop prevention (`domain/redirect-chain.ts`, every `verified_external` target
 * on the tenant's own hosts folded back into loop detection); privacy-minimized 404
 * governance (`awcms_seo_not_found_observations`, sql/060, aggregate + retention-bound
 * via the `dataLifecycle` descriptor below); and the admin API under
 * `/api/v1/seo/redirects/*` + `/api/v1/seo/not-found/*`. EVERY redirect target — on
 * write AND on every resolve — flows through the frozen `assertSafeRedirectTarget`
 * open-redirect guard (`domain/redirect-target-classification.ts`); normalization
 * (`domain/redirect-path.ts`) rejects CRLF/traversal/Unicode-confusion/protocol-
 * relative; there is no pattern engine → no ReDoS. Tenant resolution is
 * host-based-only first cut (ADR-0039); a path-tenant strategy is a documented
 * deferred follow-up. awcms has NO i18n/locale seam, so `locale` is always `null`.
 *
 * `navigation`, `events`, and `jobs` stay undeclared: the redirect/404 surface is an
 * API, not an admin screen (a documented follow-up); resolution is live per request
 * (bounded); URL-change capture is an audited synchronous hook, not yet a published
 * domain event; and 404 retention rides the generic data_lifecycle purge engine
 * (declared below), not a module-owned job.
 */
export const seoDistributionModule = defineModule({
  key: SEO_MODULE_KEY,
  name: "SEO & Distribution",
  version: "0.2.0",
  status: "active",
  description:
    "Central tenant/domain/locale-aware SEO metadata renderer for public pages plus the public discovery/syndication surfaces (ADR-0038, discovery scope; adapts awcms-micro ADR-0028). Owns `awcms_seo_tenant_settings` (sql/057 + sql/059 — per-tenant SEO defaults: site identity, default social image, Twitter handle, Organization identity, a tenant-wide noindex switch, and feed/sitemap discovery config, RLS FORCE'd) and the central document builder/renderer (`domain/seo-document.ts` + `domain/seo-head-rendering.ts`) that emits canonical URL, reciprocal hreflang alternates + x-default, title/description/robots meta, Open Graph + Twitter card, and controlled schema.org JSON-LD. It is the CONSUMER/aggregator of the frozen `seo_facts` contribution contract (`_shared/ports/seo-facts-port.ts`): content modules (`blog_content`, and any future content type) PROVIDE `SeoResourceFacts`; this module discovers their adapters at the route composition root and never imports a content module's internals. The canonical host is server-derived from the tenant's verified primary domain (`tenant_domain`), NEVER a request header (host-header-poisoning defense); OG/Organization images resolve through `media_library` (same-tenant, verified); JSON-LD is emitted only through the port's `renderControlledJsonLd` guard (injection blocked by a controlled `@type`/key schema, not ad-hoc sanitization); publication state is honored via the port's `isPubliclyResolvable`/`isPubliclyIndexable` (draft/scheduled/archived/deleted/private/unpublished/noindex never reach public output); and the render/discovery cache keys are tenant-first (`buildSeoCacheKey`/`buildDiscoverySignature`). The public discovery surfaces — robots.txt, the sitemap index + bounded child sitemaps, and RSS/Atom/JSON feeds — are public Astro XML/text routes aggregating the same `seo_facts` contract, with tenant/domain/locale-specific ETag/Last-Modified caching and per-tenant feed config (sql/059). ADR-0039 adds the redirect-governance scope: controlled tenant-contained exact-path redirect rules (`awcms_seo_redirects`, sql/060, RLS FORCE'd) resolved in `src/middleware.ts` before public content routing and EXCLUDING admin/API/auth/static/system/discovery paths (`domain/redirect-eligibility.ts`, enforced at BOTH resolve and write time), the policy-gated legacy `/blog/{tenantCode}` → `/news` auto-redirect (INERT in awcms — no `/news` route family), audited URL-change capture, bounded non-recursive chain/loop prevention, privacy-minimized 404 telemetry (`awcms_seo_not_found_observations`, sql/060, with a `dataLifecycle` analytics_telemetry descriptor + `awcms_worker` purge grant), and the admin API under `/api/v1/seo/redirects/*` + `/api/v1/seo/not-found/*` — every redirect target routed through the frozen `assertSafeRedirectTarget` open-redirect guard on write AND resolve. Tenant resolution is host-based-only first cut (path-tenant strategy deferred); `locale` is always null (no i18n seam).",
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
    },
    {
      activityCode: SEO_REDIRECT_ACTIVITY_CODE,
      action: "read",
      description:
        "List/search redirect rules, preview redirect chains, and explain conflicts (404 governance data requires not_found.read)"
    },
    {
      activityCode: SEO_REDIRECT_ACTIVITY_CODE,
      action: "create",
      description:
        "Create redirect rules, bulk-import, and capture URL changes into rules (high-risk, idempotency-keyed, audited)"
    },
    {
      activityCode: SEO_REDIRECT_ACTIVITY_CODE,
      action: "update",
      description:
        "Edit/activate/deactivate/archive redirect rules and change per-tenant redirect policy (high-risk, audited)"
    },
    {
      activityCode: SEO_REDIRECT_ACTIVITY_CODE,
      action: "delete",
      description: "Soft-delete, restore, or purge redirect rules (audited)"
    },
    {
      activityCode: SEO_NOT_FOUND_ACTIVITY_CODE,
      action: "read",
      description:
        "Read the privacy-minimized 404/broken-link governance dashboard"
    },
    {
      activityCode: SEO_NOT_FOUND_ACTIVITY_CODE,
      action: "update",
      description:
        "Resolve, dismiss, or attach a suggested redirect to a 404 observation (audited)"
    }
  ],
  dataLifecycle: [
    {
      key: SEO_NOT_FOUND_LIFECYCLE_KEY,
      tableName: "awcms_seo_not_found_observations",
      ownerModuleKey: SEO_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "last_seen_at",
      retentionClass: "analytics_telemetry",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "Aggregate table (one upsert row per distinct tenant+path+referrer+locale+host, not one row per hit), so cardinality is bounded by distinct 404 paths, not by traffic — the volume that would justify range-partitioning is already collapsed by the upsert. A short retention window (30d default) plus the tenant+last_seen_at index keeps the age-based purge cheap without partitioning."
      },
      archive: {
        archivable: false,
        rationale:
          "Privacy-first, minimized telemetry (sanitized path + bare referrer domain only, never full URLs/queries/secrets). Retaining it longer via an archive would work against the module's own privacy posture (same reasoning as visitor_analytics.visit_events); it is simply purged when stale."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "A straight age-based DELETE of stale observations — there is no soft-delete lifecycle for 404 telemetry, and nothing references these rows once purged."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "last_seen_at"],
          purpose:
            "awcms_seo_not_found_tenant_last_seen_idx (sql/060) — the exact (tenant, cursor) composite the generic purge engine filters + orders by for its bounded age-based DELETE."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "No special backup/restore implications: derived, purgeable, privacy-minimized telemetry. A restore that omits this table loses only historical 404 aggregates (regenerated from live traffic), never any source-of-truth data.",
      executionMode: "generic"
    }
  ]
});
