import { defineModule } from "../_shared/module-contract";

export const newsPortalModule = defineModule({
  key: "news_portal",
  name: "News Portal",
  version: "0.4.0",
  status: "active",
  description:
    "Editorial layer for a full-online, R2-only news portal, ported from awcms-mini (epic `news_portal` #631-#642/#649/#681/#690). Ships: (1) the editorial homepage section composer admin surface — `POST/GET /api/v1/news-portal/homepage-sections`, `PATCH/DELETE .../{id}` (migration 044); and (2) R2-only advertisement placement presets — `POST/GET /api/v1/news-portal/ad-placements`, `PATCH/DELETE .../{id}` (migration 045 schema; every row references a verified R2 media object by a real FK `media_object_id`, so R2-only-ness holds by construction). ADR-0036 OWNERSHIP INVERSION: the tenant media object registry (`awcms_news_media_objects`, migration 041) with its direct-to-R2 presigned upload flow, MIME sniffing, R2 config/client, verification, and the `news-media:reconcile` background job were EXTRACTED out of this module into `media_library` (`_shared/ports/media-library-port.ts`). This module no longer PROVIDES `news_media` (retired); it now CONSUMES `media_library` (required — its ad placements hold a real FK to a media object) plus `blog_content`'s `public_content` capability for homepage-section reference validation. `public_content` is wired at the composition root via `PublicContentPort`; `media_library`, by contrast, is read by DIRECT source import of its registry (`fetchNewsMediaObjectById`/`isNewsMediaObjectSafeForPublicReference`, `media_library/application/media-object-directory`) and readiness (`evaluateManagedMediaReadiness`) from this module's ad-placement/homepage-section reference validators and `domain/news-portal-preset-readiness.ts` — a deliberate divergence from the port, because those FK-holding resources need the media object's own fields (status/MIME), not the port's safe/unsafe boolean. The dependency direction stays legal (domain → System Foundation; `media_library` never imports back, proven by the port-ownership test). PORT-TIME DROPS (documented, not silent — same lineage `blog_content`'s port already recorded): (a) the host-resolved `/news/**` public route family (index/detail/category/tag/search/feed/sitemap) is NOT ported — it needs `lib/tenant/public-host-tenant-resolver.ts` + `PUBLIC_TENANT_RESOLUTION_MODE` plumbing from the `tenant_domain` module; the public render helpers that only backed those routes (`application/homepage-section-composer.ts`, `domain/homepage-section-rendering.ts`, `domain/news-share-config.ts`) are dropped with them. (b) The per-module admin `.astro` pages (`admin/news-portal/homepage-sections.astro`, `admin/news-portal/ad-placements.astro`) are dropped — this base ships no per-module admin UI yet; the `navigation` entries below are descriptor metadata only. (c) `application/apply-news-portal-preset.ts` and the `news_portal_full_online_r2` module-preset ACTIVATION path are dropped because `module_management`'s preset subsystem is not ported to this base. The `awcms_news_portal_tenant_state` marker table (migration 043) + its read helper `isFullOnlineR2ModeAppliedForTenant` ARE retained (forward-compatible), but with no writer they are inert; managed-media enforcement in this base is turned on per-tenant by `media_library`'s own `POST /api/v1/media/enforcement` switch instead. `domain/news-portal-preset-readiness.ts` still COMPOSES `media_library`'s `evaluateManagedMediaReadiness` for the same reason codes.",
  // `module_management` + `logging` are foundation modules that are never
  // disabled per-tenant, so declaring them does not arm the reverse-dependency
  // guard against any optional business module; both keep `modules:dag:check`
  // acyclic. (`blog_content`/`media_library`/`tenant_domain`/`visitor_analytics`
  // are deliberately NOT dependencies — the capability wiring below documents the
  // relationships without a lifecycle-ordering edge.)
  dependencies: [
    "tenant_admin",
    "identity_access",
    "module_management",
    "logging"
  ],
  type: "domain",
  // ADR-0036 — this module no longer PROVIDES anything. It used to provide
  // `news_media` (retired), but only because the media registry happened to be
  // born inside it; two of that port's three methods were pure registry reads,
  // and the third (`isFullOnlineR2ModeActiveForTenant`) leaked this module's
  // editorial policy into a contract every website module had to consume.
  // `media_library` now provides `media_library` (`_shared/ports/media-library-port.ts`),
  // and this module is a CONSUMER of it — but its ad-placement/homepage-section
  // validators read `media_library`'s registry by DIRECT source import (they need
  // the object's status/MIME fields, not the port's safe/unsafe boolean), whereas
  // `blog_content` uses the injected `MediaLibraryPort`. Either way `media_library`
  // owns the registry; `news_portal` no longer does.
  //
  // Neither consumed capability is optional. `public_content`: every homepage
  // section type is fundamentally built on `blog_content` data. `media_library`:
  // ad placements reference a verified media object by real foreign key
  // (`media_object_id`, migration 045), so this module cannot render without it.
  // Contrast `blog_content`, which marks `media_library` optional because its
  // media handling safely no-ops when enforcement isn't active.
  capabilities: {
    consumes: [
      { capability: "public_content", providedBy: "blog_content" },
      { capability: "media_library", providedBy: "media_library" }
    ]
  },
  // ADR-0036: `basePath` moved to `media_library` along with the media registry
  // and its presigned-upload routes. What remains here
  // (`/api/v1/news-portal/homepage-sections`, `/ad-placements`) is genuinely this
  // module's own, so this module keeps declaring an api surface for it.
  api: {
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
    basePath: "/api/v1/news-portal"
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
    }
  ]
  // `jobs`/`settings`/`health` are deliberately undeclared: this module has no
  // per-tenant setting, background job, or health check of its own. The
  // `news-media:reconcile` job that Issue #690 first declared here was MOVED to
  // `media_library` by ADR-0036: it reconciles `awcms_news_media_objects` — the
  // media registry the inversion extracted into `media_library` — through that
  // module's own code. The job belongs to whoever owns the table it reconciles.
});
