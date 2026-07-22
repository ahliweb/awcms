import { defineModule } from "../_shared/module-contract";

export const blogContentModule = defineModule({
  key: "blog_content",
  name: "Blog Content",
  version: "0.9.0",
  status: "active",
  description:
    "Tenant-scoped blog/content management, ported from awcms-mini (epic #536, issues #537-#543 plus the later #636-#649/#681 hardening lineage — see README.md for the full port-adaptation notes). Admin CRUD + lifecycle for posts/pages (draft -> review -> scheduled/published -> archived, soft delete/restore/purge), hierarchical categories/tags with post-term relations, PostgreSQL full-text search, append-only revision history (restore never overwrites, it appends a new revision), presentation/monetization extensions (templates, hierarchical menus, position-based widgets, advertisements with placement targeting/scheduling, a per-tenant theme override falling back to `awcms_tenants.default_theme`), an optional `translation_group_id` linking locale-variants of one post, a whitelisted `gallery`/`video_news` content_json block type (no raw HTML, no new media table), per-tenant blog settings (title/description/RSS/sitemap flags), and automatic internal tag linking (a pure render-time transform, `domain/internal-tag-linking.ts`, gated by a deployment-wide config plus a per-tenant policy table and a per-post opt-out column). Public (anonymous) routes under `/blog/{tenantCode}/...` per ADR-0009 (index, post detail, category/tag archive, search, RSS feed, sitemap) reuse the `resolvePublicTenantByCode` resolver theming's own public preview route already established in this base. PORT-TIME DROPS (documented in the port PR, not silent): the host-resolved `/news/**` route family (Issue #560/#564, epic `news_portal`) is NOT ported — it requires `lib/tenant/public-host-tenant-resolver.ts` (custom-domain-based tenant resolution) and `PUBLIC_TENANT_RESOLUTION_MODE`/`PUBLIC_TRUST_PROXY` env plumbing that belong to the `tenant_domain` routing module, which is not yet ported to this base; the three `/news`-only settings keys (`publicRouteMode`/`publicBasePath`/`publicLabel`) are dropped from `settings.defaults` for the same reason, keeping only `legacyTenantRouteEnabled` (the `/blog/{tenantCode}` on/off switch). The full-online-R2-only-mode media-reference enforcement (Issue #636/#639/#640/#649, gated by the `news_media` capability below) and the publish-time social-publishing outbox trigger (Issue #643, gated by the `social_publishing` capability below) both consume a REQUIRED port parameter at their call sites; since neither `news_portal` nor `social_publishing` is ported yet, every route/worker call site here injects this module's own no-op adapters (`application/news-media-port-noop-adapter.ts`, `application/social-publishing-port-noop-adapter.ts`) instead of importing an absent module's concrete adapter — R2-only mode always reports inactive (every affected gate/checklist becomes the same no-op it already is for every tenant that hasn't opted into that mode) and the social-publishing hook always reports `{ jobsCreated: 0 }`, both exactly matching the documented base-case behavior. Swapping in the real adapters is a pure composition-root change (no `blog_content` file touched) once those modules are ported.",
  // `module_management` + `logging` are real value imports this module
  // already makes — `application/public-route-settings.ts` calls
  // `module_management`'s tenant-module/settings helpers, and
  // `application/blog-scheduled-publish.ts` calls `logging`'s
  // `recordAuditEvent`. Declaring them keeps `modules:dag:check` acyclic
  // (both are foundation modules that never depend back on `blog_content`).
  dependencies: [
    "tenant_admin",
    "identity_access",
    "module_management",
    "logging"
  ],
  type: "domain",
  // This module PROVIDES the `public_content` capability
  // (`_shared/ports/public-content-port.ts`, implemented by
  // `application/public-content-port-adapter.ts`) for a future `news_portal`
  // port's homepage section composer to consume, and CONSUMES (both
  // `optional: true`) `news_portal`'s `news_media` capability and
  // `social_publishing`'s own `social_publishing` capability. Neither
  // direction is a `dependencies` edge (capabilities document a
  // SOURCE-LEVEL relationship, not a lifecycle-ordering constraint). Since
  // NEITHER `news_portal` NOR `social_publishing` is ported to this base yet,
  // every real call site injects this module's own no-op adapter instead of
  // an absent module's concrete one — see the description field above and
  // `application/news-media-port-noop-adapter.ts`/
  // `application/social-publishing-port-noop-adapter.ts`'s own headers.
  // `optional: true` is exactly what makes that safe: a deployment that
  // never has `news_media`/`social_publishing` provided (every deployment of
  // this base today) must still fully validate/publish articles, just
  // without the extra R2/social-outbox behavior.
  capabilities: {
    provides: ["public_content"],
    consumes: [
      { capability: "news_media", providedBy: "news_portal", optional: true },
      {
        capability: "social_publishing",
        providedBy: "social_publishing",
        optional: true
      }
    ]
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_blog",
      path: "/admin/blog",
      order: 40,
      requiredPermission: "blog_content.posts.read"
    }
  ],
  permissions: [
    { activityCode: "posts", action: "read", description: "Read blog posts" },
    {
      activityCode: "posts",
      action: "create",
      description: "Create blog posts"
    },
    {
      activityCode: "posts",
      action: "update",
      description: "Update blog posts"
    },
    {
      activityCode: "posts",
      action: "publish",
      description: "Publish blog posts"
    },
    {
      activityCode: "posts",
      action: "schedule",
      description: "Schedule blog posts for future publishing"
    },
    {
      activityCode: "posts",
      action: "archive",
      description: "Archive blog posts"
    },
    {
      activityCode: "posts",
      action: "delete",
      description: "Soft delete blog posts"
    },
    {
      activityCode: "posts",
      action: "restore",
      description: "Restore soft-deleted blog posts"
    },
    {
      activityCode: "posts",
      action: "purge",
      description: "Purge soft-deleted blog posts"
    },
    {
      activityCode: "posts",
      action: "export",
      description: "Export blog posts"
    },
    { activityCode: "pages", action: "read", description: "Read blog pages" },
    {
      activityCode: "pages",
      action: "create",
      description: "Create blog pages"
    },
    {
      activityCode: "pages",
      action: "update",
      description: "Update blog pages"
    },
    {
      activityCode: "pages",
      action: "publish",
      description: "Publish blog pages"
    },
    {
      activityCode: "pages",
      action: "archive",
      description: "Archive blog pages"
    },
    {
      activityCode: "pages",
      action: "delete",
      description: "Soft delete blog pages"
    },
    {
      activityCode: "pages",
      action: "restore",
      description: "Restore soft-deleted blog pages"
    },
    {
      activityCode: "pages",
      action: "purge",
      description: "Purge soft-deleted blog pages"
    },
    {
      activityCode: "taxonomies",
      action: "read",
      description: "Read blog categories and tags"
    },
    {
      activityCode: "taxonomies",
      action: "configure",
      description: "Create, update, or delete blog categories and tags"
    },
    {
      activityCode: "revisions",
      action: "read",
      description: "Read blog post/page revision history"
    },
    {
      activityCode: "revisions",
      action: "restore",
      description: "Restore a blog post/page revision"
    },
    {
      activityCode: "settings",
      action: "read",
      description: "Read blog module settings"
    },
    {
      activityCode: "settings",
      action: "configure",
      description: "Update blog module settings"
    },
    {
      activityCode: "seo",
      action: "configure",
      description: "Configure blog SEO metadata defaults"
    },
    {
      activityCode: "search",
      action: "read",
      description: "Search blog posts and pages"
    },
    {
      activityCode: "templates",
      action: "read",
      description: "Read blog presentation templates"
    },
    {
      activityCode: "templates",
      action: "configure",
      description: "Create, update, or delete blog presentation templates"
    },
    {
      activityCode: "menus",
      action: "read",
      description: "Read blog navigation menus"
    },
    {
      activityCode: "menus",
      action: "configure",
      description: "Create, update, or delete blog navigation menus"
    },
    {
      activityCode: "widgets",
      action: "read",
      description: "Read blog widgets"
    },
    {
      activityCode: "widgets",
      action: "configure",
      description: "Create, update, or delete blog widgets"
    },
    {
      activityCode: "ads",
      action: "read",
      description: "Read blog advertisements"
    },
    {
      activityCode: "ads",
      action: "configure",
      description: "Create, update, or delete blog advertisements"
    },
    {
      activityCode: "theme",
      action: "read",
      description: "Read blog theme mode setting"
    },
    {
      activityCode: "theme",
      action: "configure",
      description: "Update blog theme mode setting"
    },
    // Issue #641 — deliberately separate from `settings.*` (see migration
    // 050's header comment for why this policy lives in its own dedicated
    // table/endpoint rather than folded into `awcms_blog_settings`).
    {
      activityCode: "internal_links",
      action: "read",
      description: "Read automatic internal tag linking settings"
    },
    {
      activityCode: "internal_links",
      action: "configure",
      description: "Configure automatic internal tag linking settings"
    },
    {
      activityCode: "internal_links",
      action: "preview",
      description:
        "Preview automatic internal tag links for a post before publishing"
    }
  ],
  api: {
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
    basePath: "/api/v1/blog"
  },
  // Non-secret public-route-behavior preference, read/written through
  // Module Management's existing generic framework (GET/PATCH
  // /api/v1/tenant/modules/blog_content/settings), not a bespoke settings
  // mechanism.
  //
  // PORT-TIME DROP: awcms-mini's equivalent field also carried
  // `publicRouteMode`/`publicBasePath`/`publicLabel` — three knobs that only
  // ever govern the host-resolved `/news/**` route family. That family is
  // not ported (see this module's own `description` field above), so those
  // three keys are dropped here rather than kept as dead configuration for a
  // route family that does not exist in this base. `legacyTenantRouteEnabled`
  // is kept because it independently gates the `/blog/{tenantCode}` family,
  // which IS ported.
  //
  // DELIBERATELY DOES NOT INCLUDE `rssEnabled`/`sitemapEnabled` — those two
  // flags live in, and stay in, `awcms_blog_settings`
  // (`application/blog-settings-directory.ts`'s `fetchBlogSettings`, written
  // via `PATCH /api/v1/blog/settings`). Duplicating them into this second
  // store would create two disconnected, independently-writable sources of
  // truth for the same concept. See `application/public-route-settings.ts`'s
  // header comment for the full reasoning.
  settings: {
    schemaVersion: 1,
    defaults: {
      // Default true = today's behavior unchanged: /blog/{tenantCode}
      // remains fully available (the legacy family is never removed by
      // default). Setting this false disables all 7 /blog/{tenantCode}
      // routes (index/detail/category/tag/search/feed/sitemap) with the
      // same generic 404 shape as an unknown tenant code — a
      // tenant-chosen opt-out, not a removal of the route family itself.
      legacyTenantRouteEnabled: true
    }
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      "awcms.blog-content.post.created",
      "awcms.blog-content.post.updated",
      "awcms.blog-content.post.submitted-for-review",
      "awcms.blog-content.post.published",
      "awcms.blog-content.post.scheduled",
      "awcms.blog-content.post.archived",
      "awcms.blog-content.post.deleted",
      "awcms.blog-content.post.restored",
      "awcms.blog-content.post.purged",
      "awcms.blog-content.revision.created",
      "awcms.blog-content.term.created",
      "awcms.blog-content.term.updated",
      "awcms.blog-content.settings.updated",
      "awcms.blog-content.template.created",
      "awcms.blog-content.template.updated",
      "awcms.blog-content.template.deleted",
      "awcms.blog-content.menu.created",
      "awcms.blog-content.menu.updated",
      "awcms.blog-content.menu.deleted",
      "awcms.blog-content.widget.created",
      "awcms.blog-content.widget.updated",
      "awcms.blog-content.widget.deleted",
      "awcms.blog-content.ad.created",
      "awcms.blog-content.ad.updated",
      "awcms.blog-content.ad.deleted",
      "awcms.blog-content.theme.updated",
      "awcms.blog-content.internal-tag-linking-policy.updated"
    ]
  },
  jobs: [
    {
      command: "bun run blog:publish:scheduled",
      purpose:
        "Publish every due `status='scheduled'` blog post (scheduled_at <= now()) for every active tenant. Idempotent — a post already published, or still in the future, is a no-op on re-run.",
      recommendedSchedule: "Every 1-5 minutes via cron/systemd timer.",
      environmentNotes:
        "No external provider call — pure database transition, safe to run in any deployment profile.",
      safeInOfflineLan: true
    }
  ]
});
