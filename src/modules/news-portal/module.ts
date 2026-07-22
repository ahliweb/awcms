import { defineModule } from "../_shared/module-contract";
import { NEWS_MEDIA_PERMISSION_ACTIVITY_CODE } from "./domain/news-media-permissions";

export const newsPortalModule = defineModule({
  key: "news_portal",
  name: "News Portal",
  version: "0.4.0",
  status: "active",
  description:
    "Editorial + media layer for a full-online, R2-only news portal, ported from awcms-mini (epic `news_portal` #631-#642/#649/#681/#690). Ships: (1) a tenant-scoped, R2-only media object registry (`awcms_news_media_objects`, migration 041) with a direct-to-R2 presigned upload flow — `POST /api/v1/media/news-images/upload-sessions` (create), `.../{id}/finalize` (real R2 `GET` + magic-byte MIME sniffing + server-side SHA-256 checksum, NOT `HEAD`-only — see `news-media-r2-verification.ts`), `.../{id}/cancel`; (2) the editorial homepage section composer admin surface — `POST/GET /api/v1/news-portal/homepage-sections`, `PATCH/DELETE .../{id}` (migration 044); (3) R2-only advertisement placement presets — `POST/GET /api/v1/news-portal/ad-placements`, `PATCH/DELETE .../{id}` (migration 046 schema; every row references a verified R2 media object by a real FK `media_object_id`, so R2-only-ness holds by construction); and (4) the `news-media:reconcile` background job (`scripts/news-media-r2-reconcile.ts`, migration 045 orphan lifecycle) reconciling registry metadata against real R2 bucket contents. PORT-TIME DROPS (documented, not silent — same lineage `blog_content`'s port already recorded): (a) the host-resolved `/news/**` public route family (index/detail/category/tag/search/feed/sitemap) is NOT ported — it needs `lib/tenant/public-host-tenant-resolver.ts` + `PUBLIC_TENANT_RESOLUTION_MODE` plumbing from the not-yet-ported `tenant_domain` module; the public render helpers that only backed those routes (`application/homepage-section-composer.ts`, `domain/homepage-section-rendering.ts`, `domain/news-share-config.ts`) are dropped with them. (b) The per-module admin `.astro` pages (`admin/news-portal/homepage-sections.astro`, `admin/news-portal/ad-placements.astro`) are dropped — this base ships no per-module admin UI yet; the `navigation` entries below are descriptor metadata only (same convention `blog_content`'s single `/admin/blog` entry uses — the page it points at does not exist here either). (c) `application/apply-news-portal-preset.ts` and the `news_portal_full_online_r2` module-preset ACTIVATION path are dropped because `module_management`'s preset subsystem (`applyModulePreset`/`MODULE_PRESETS`/`planEnableOrder`) is not ported to this base. The `awcms_news_portal_tenant_state` marker table (migration 043) + its read helper `isFullOnlineR2ModeAppliedForTenant` ARE retained (forward-compatible), but with no writer the `news_media` port's `isFullOnlineR2ModeActiveForTenant` always resolves `false` — identical net behavior to `blog_content`'s prior no-op adapter, while the registry/upload/homepage/ads surfaces above all work independently of that mode. This module PROVIDES the `news_media` capability (`_shared/ports/news-media-port.ts`, implemented by `application/news-media-port-adapter.ts`) — now the REAL adapter wired into `blog_content`'s write/render composition roots (route handlers + `blog:publish:scheduled` worker), replacing that module's port-time no-op — and CONSUMES `blog_content`'s `public_content` capability (`_shared/ports/public-content-port.ts`) for homepage-section reference validation, wired at the composition root, never a raw cross-module import inside either module's `application`/`domain` tree.",
  // `module_management` + `logging` are foundation modules that are never
  // disabled per-tenant, so declaring them does not arm the reverse-dependency
  // guard against any optional business module; both keep `modules:dag:check`
  // acyclic. (`blog_content`/`tenant_domain`/`visitor_analytics` are
  // deliberately NOT dependencies — the capability wiring below documents the
  // `blog_content` relationship without a lifecycle-ordering edge.)
  dependencies: [
    "tenant_admin",
    "identity_access",
    "module_management",
    "logging"
  ],
  type: "domain",
  // This module PROVIDES the `news_media` capability
  // (`_shared/ports/news-media-port.ts`, implemented by
  // `application/news-media-port-adapter.ts`) that `blog_content` consumes
  // for R2-only-mode media validation, and CONSUMES `blog_content`'s
  // `public_content` capability (`_shared/ports/public-content-port.ts`) for
  // `application/homepage-section-reference-validation.ts` (validating that a
  // homepage section's referenced posts/categories exist and are public-safe
  // at admin write time). See `blog_content/module.ts`'s mirror note.
  // `public_content` is NOT optional here — every homepage section type is
  // fundamentally built on `blog_content` data, unlike `blog_content`'s
  // optional consumption of `news_media`.
  capabilities: {
    provides: ["news_media"],
    consumes: [{ capability: "public_content", providedBy: "blog_content" }]
  },
  api: {
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
    basePath: "/api/v1/media/news-images"
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_news_portal_homepage_sections",
      path: "/admin/news-portal/homepage-sections",
      order: 80,
      requiredPermission: "news_portal.homepage_sections.read"
    },
    {
      labelKey: "admin.layout.nav_news_portal_ad_placements",
      path: "/admin/news-portal/ad-placements",
      order: 81,
      requiredPermission: "news_portal.ad_placements.read"
    }
  ],
  permissions: [
    {
      activityCode: "homepage_sections",
      action: "read",
      description: "Read editorial homepage section configuration"
    },
    {
      activityCode: "homepage_sections",
      action: "configure",
      description:
        "Create, update, reorder, enable/disable, or delete editorial homepage sections"
    },
    {
      activityCode: "ad_placements",
      action: "read",
      description: "Read news portal advertisement placement configuration"
    },
    {
      activityCode: "ad_placements",
      action: "configure",
      description:
        "Create, update, enable/disable, or delete news portal advertisement placements"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "create",
      description:
        "Create a pending news media object / start a presigned upload session"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "read",
      description: "Read news media object metadata"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "verify",
      description: "Finalize/verify an uploaded news media object"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "attach",
      description: "Attach a verified news media object to an owning resource"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "detach",
      description: "Detach a news media object from its owning resource"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "delete",
      description: "Soft delete news media object metadata"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "restore",
      description: "Restore a soft-deleted news media object"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "purge",
      description: "Hard purge an already soft-deleted news media object"
    },
    {
      activityCode: NEWS_MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "cancel",
      description: "Cancel one's own not-yet-uploaded news media upload session"
    }
  ],
  // Issue #690 (epic #679, platform-hardening): the first background job
  // this module declares (`settings`/`health` remain undeclared — still no
  // per-tenant setting or health check for this module specifically).
  jobs: [
    {
      command: "bun run news-media:reconcile",
      purpose:
        "Reconcile awcms_news_media_objects metadata against the real R2 bucket contents; clean up expired pending uploads and grace-period-expired orphans in bounded, race-safe batches (dry-run supported).",
      recommendedSchedule: "Daily via cron/systemd timer.",
      environmentNotes:
        'No-op when NEWS_MEDIA_R2_ENABLED is not "true". Requires real network egress to the Cloudflare R2 API in addition to PostgreSQL — not a pure database operation.',
      safeInOfflineLan: false
    }
  ]
});
