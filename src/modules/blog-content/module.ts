import { defineModule } from "../_shared/module-contract";

export const blogContentModule = defineModule({
  key: "blog_content",
  name: "Blog Content",
  version: "0.12.0",
  status: "active",
  description:
    "Tenant-scoped blog/content management, ported from awcms-mini (epic #536, issues #537-#543 plus the later #636-#649/#681 hardening lineage — see README.md for the full port-adaptation notes). Admin CRUD + lifecycle for posts/pages (draft -> review -> scheduled/published -> archived, soft delete/restore/purge), hierarchical categories/tags with post-term relations, PostgreSQL full-text search, append-only revision history (restore never overwrites, it appends a new revision), presentation/monetization extensions (templates, hierarchical menus, position-based widgets, advertisements with placement targeting/scheduling, a per-tenant theme override falling back to `awcms_tenants.default_theme`), an optional `translation_group_id` linking locale-variants of one post, a whitelisted `gallery`/`video_news` content_json block type (no raw HTML, no new media table), per-tenant blog settings (title/description/RSS/sitemap flags), and automatic internal tag linking (a pure render-time transform, `domain/internal-tag-linking.ts`, gated by a deployment-wide config plus a per-tenant policy table and a per-post opt-out column). Public (anonymous) routes under `/blog/{tenantCode}/...` per ADR-0009 (index, post detail, category/tag archive, search, RSS feed, sitemap) reuse the `resolvePublicTenantByCode` resolver theming's own public preview route already established in this base. PORT-TIME DROPS (documented in the port PR, not silent): the host-resolved `/news/**` route family (Issue #560/#564, epic `news_portal`) is NOT ported — it requires `lib/tenant/public-host-tenant-resolver.ts` (custom-domain-based tenant resolution) and `PUBLIC_TENANT_RESOLUTION_MODE`/`PUBLIC_TRUST_PROXY` env plumbing that belong to the `tenant_domain` routing module, which is not yet ported to this base; the three `/news`-only settings keys (`publicRouteMode`/`publicBasePath`/`publicLabel`) are dropped from `settings.defaults` for the same reason, keeping only `legacyTenantRouteEnabled` (the `/blog/{tenantCode}` on/off switch). The managed-media-reference enforcement (Issue #636/#639/#640/#649, gated by the `media_library` capability below — ADR-0036 ownership inversion; formerly `news_media`) and the publish-time social-publishing outbox trigger (Issue #643, gated by the `social_publishing` capability below) both consume a REQUIRED port parameter at their call sites. The media gate now injects `media_library`'s real adapter (`media-library/application/media-library-port-adapter.ts`) at every composition root: managed-media enforcement reports inactive (a safe no-op) for any tenant that has not enabled it, and enabling it no longer requires a news portal. `social_publishing` is still not ported to this base, so its call sites inject this module's own no-op adapter (`application/social-publishing-port-noop-adapter.ts`), which always reports `{ jobsCreated: 0 }`. Swapping in a real social-publishing adapter is a pure composition-root change (no `blog_content` file touched) once that module is ported. ADR-0044 MERGE: the `news_portal` module is retired and its two surviving features are absorbed here — the editorial homepage section composer (`GET/POST /api/v1/news-portal/homepage-sections`, `PATCH/DELETE .../{id}`, `awcms_news_portal_homepage_sections`, migration 044) and R2-only advertisement placements (`GET/POST /api/v1/news-portal/ad-placements`, `PATCH/DELETE .../{id}`, `awcms_news_portal_ad_placements`, migration 045, every row holding a real FK to a verified media object). Table names and API paths are deliberately UNCHANGED (ADR-0044 §3/§6, following ADR-0036's precedent of not renaming `awcms_news_media_objects` when its ownership moved): a rename costs every foreign key, policy, index, and consumer while buying nothing that the descriptor and inventory do not already record. The `public_content` capability this module PROVIDES was `news_portal`'s only reason to consume it, so that consumption is now an internal call; the capability itself stays declared because `seo_distribution` and future consumers still read it. Dropped in the same change, not absorbed: `awcms_news_portal_tenant_state` (migration 043) and its read helper, which had no writer in this base — the preset ACTIVATION path that would have written it was never ported, and managed-media enforcement is turned on per tenant by `media_library`'s `POST /api/v1/media/enforcement` instead (`sql/077` drops the table). The four absorbed permissions (`homepage_sections`/`ad_placements` x `read`/`configure`, seeded under `news_portal` by migrations 044/045) are repointed to this module's key by `sql/076`, which moves every existing role grant before deleting the old catalog rows so no tenant loses the capability. ADR-0044 §4 FASE 2, STEP 1 (`sql/078`): the surviving media-backed ad table gains the targeting the free-URL system had (`target_type` global/widget/post/page + `target_id`), so it can now express everything `awcms_blog_ad_placements` could — the precondition the ADR sets before `awcms_blog_ads` may be dropped. `placement_key` remains the SLOT (where on the page), `target_type`/`target_id` are the SCOPE (which pages); rendering a page returns its own targeted ads UNIONED with every global ad for that slot, which is a deliberate improvement on the retired system's exact-scope match. The pairing rule (`target_id` required for a scoped type, forbidden for `global`) is a database CHECK, not application-only as the retired table left it, and the polymorphic `target_id` is existence-checked at write time by `application/ad-placement-reference-validation.ts` since no foreign key can span three tables. Migration 078 deliberately moves NO data and drops NO table: the ingest of `awcms_blog_ads.image_url` into `media_library` (with a dry-runnable residue report) and the drop of both legacy tables are separate, later steps, in that order.",
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
  // `application/public-content-port-adapter.ts`) for `news_portal`'s homepage
  // section composer to consume, and CONSUMES (both `optional: true`)
  // `media_library`'s `media_library` capability and `social_publishing`'s own
  // `social_publishing` capability. Neither direction is a `dependencies` edge
  // (capabilities document a SOURCE-LEVEL relationship, not a lifecycle-ordering
  // constraint).
  //
  // ADR-0036 ownership inversion: was `news_media` providedBy `news_portal` — the
  // capability is retired and `media_library` provides its successor. Still
  // `optional`, and for the same reason as before: the media gate safely no-ops
  // when managed-media enforcement is not active for the tenant. What changed is
  // that enforcement no longer requires a news portal to exist — the real
  // `media_library` adapter (`media-library/application/media-library-port-adapter.ts`)
  // is injected at every composition root. `social_publishing` is still not
  // ported to this base, so its call sites inject this module's own no-op adapter
  // (`application/social-publishing-port-noop-adapter.ts`); `optional: true` is
  // what keeps that safe.
  capabilities: {
    // `public_content` (consumed by `news_portal`'s homepage composer) and, as of
    // ADR-0038 (`seo_distribution` admission, discovery scope), `seo_facts` — the
    // frozen `_shared/ports/seo-facts-port.ts` contract this module implements in
    // `application/seo-facts-port-adapter.ts`, mapping an `awcms_blog_posts` row
    // to the neutral `SeoResourceFacts` the sitemap/feed/robots aggregator
    // consumes. `blog_content` is the base's single declared `seo_facts` provider
    // (it owns the public post resources SEO renders); `news_portal` composes those
    // posts but owns no standalone public resource, so it is not a second provider.
    provides: ["public_content", "seo_facts"],
    consumes: [
      // ADR-0044 flipped this from `optional: true`. Before the merge, this
      // module's own media handling genuinely degraded safely: managed-media
      // enforcement reports inactive for a tenant that has not enabled it, and
      // everything keeps rendering. That is no longer the whole story. The
      // absorbed ad placements hold a REAL foreign key to a verified media
      // object (`awcms_news_portal_ad_placements.media_object_id`, migration
      // 045), which is exactly why `news_portal` declared this capability
      // non-optional. Absorbing the code has to absorb the constraint too —
      // leaving it `optional` would silently downgrade a declared guarantee to
      // match the weaker of the two merged modules.
      {
        capability: "media_library",
        providedBy: "media_library"
      },
      {
        capability: "social_publishing",
        providedBy: "social_publishing",
        optional: true
      }
    ]
  },
  /**
   * `/admin/blog` is back, in the change that adds the page — which is what
   * the note that stood here promised.
   *
   * The history is worth keeping: this module declared this exact path when it
   * was ported from awcms-mini, where the page exists. It did not exist here —
   * the port brought the API and the public routes, not the authoring screens
   * — and nothing rendered descriptor navigation at the time, so the entry was
   * invisible while `descriptor-sync` published it to
   * `awcms_module_navigation` and `GET /api/v1/modules` as a valid item.
   * `tests/admin-navigation-registry.test.ts` now fails on any entry whose
   * path has no page, in both directions.
   *
   * Two entries for fifteen activity codes: the post lifecycle and the page
   * lifecycle. Taxonomy, presentation, settings and homepage composition are
   * still sibling screens, and each brings its own entry when its page lands —
   * not before.
   *
   * The pages entry is gated on `pages.read` rather than `posts.read`: they
   * are separate permissions, and an operator granted one and not the other
   * must see exactly the screen they can use.
   */
  navigation: [
    {
      labelKey: "admin.layout.nav_blog",
      path: "/admin/blog",
      order: 36,
      requiredPermission: "blog_content.posts.read"
    },
    {
      labelKey: "admin.layout.nav_blog_pages",
      path: "/admin/blog-pages",
      order: 37,
      requiredPermission: "blog_content.pages.read"
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
    // `posts.export` was declared here and seeded by sql/036 with no route, no
    // application function and no export machinery of any kind. REVOKED by
    // ADR-0058 §D + sql/089; a real export feature arrives with its own ADR and
    // its own permission, not on the strength of a row that predates the need.
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
    // `seo.configure` was a SECOND authorisation axis over data
    // `settings.configure` above already governs: blog SEO defaults are
    // `seo_default_title`/`seo_default_description` in `awcms_blog_settings`,
    // written through `PATCH /api/v1/blog/settings`. REVOKED by ADR-0058 §C +
    // sql/089. Nothing about blog SEO itself changed.
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
    },
    // ADR-0044 — absorbed from the retired `news_portal` module. `sql/044`/
    // `sql/045` seeded these under `news_portal`; `sql/076` repoints both the
    // catalog rows and every existing role grant onto this module's key, in
    // the insert -> repoint -> delete order `sql/052` established, so no tenant
    // loses the capability. The descriptions here are byte-identical to that
    // migration's on purpose.
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
      description: "Read advertisement placement configuration"
    },
    {
      activityCode: "ad_placements",
      action: "configure",
      description:
        "Create, update, enable/disable, or delete advertisement placements"
    }
  ],
  api: {
    // ADR-0026: a module points at its OWN fragment, never at the generated
    // bundle. Pointing at the bundle made this module look like it declared
    // every other module's surface too, and left
    // `openapi/modules/blog-content.openapi.yaml` claimed by nobody — which is
    // how a fragment for the retired `news_portal` module survived ADR-0044.
    openApiPath: "openapi/modules/blog-content.openapi.yaml",
    basePath: "/api/v1/blog",
    // The public path-based tenant routes (ADR-0009) are this module's surface
    // too; before Issue #256 no descriptor claimed them at all.
    //
    // ADR-0044 §6: `/api/v1/news-portal` is claimed here because the merge
    // moved OWNERSHIP without renaming the paths. Renaming them in the same
    // change would produce one diff that is reviewable as neither an ownership
    // move nor an API change, and every consumer would have to absorb both at
    // once. Consolidating under `/api/v1/blog` is a separate, redirect-carrying
    // decision.
    routes: ["/api/v1/blog", "/blog", "/api/v1/news-portal"]
  },
  // Public search-source contribution to `site_search` (ADR-0040 §3, ported
  // from awcms-micro Issue #270). Pure DATA — no executable extractor, no SQL:
  // `site_search`'s generic engine reads `awcms_blog_posts` through this
  // declarative column mapping + publication filter. The filter is the EXACT
  // public-visibility predicate this module's own public routes and its
  // `seo_facts` adapter use (published + public + not soft-deleted + a reached
  // `published_at`), enforced at the source->index boundary so a
  // draft/private/deleted/scheduled post is never even read into the index.
  //
  // `urlTemplate` carries `:tenantCode` because this base's public post route is
  // path-tenant-scoped (`/blog/{tenantCode}/{slug}`, ADR-0009) — awcms-micro's
  // descriptor used host-resolved `/news/:slug`, a route family that is NOT
  // ported here (see this module's `description`). Blog PAGES are deliberately
  // NOT contributed: they have no public route in this base, so an indexed page
  // would produce a search hit that 404s.
  //
  // This declaration adds NO dependency edge to `site_search`: the arrow points
  // inward (ADR-0040 §2) — content declares, the aggregator discovers.
  searchSources: [
    {
      key: "blog_content.post",
      ownerModuleKey: "blog_content",
      resourceType: "blog_post",
      tableName: "awcms_blog_posts",
      tenantColumn: "tenant_id",
      idColumn: "id",
      localeColumn: "locale",
      updatedAtColumn: "updated_at",
      titleColumn: "title",
      summaryColumn: "excerpt",
      bodyColumns: ["content_text"],
      tagsColumn: null,
      urlTemplate: "/blog/:tenantCode/:slug",
      slugColumn: "slug",
      publicationFilter: {
        equals: { status: "published", visibility: "public" },
        nullColumns: ["deleted_at"],
        notNullColumns: ["published_at"],
        timeReachedColumns: ["published_at"]
      },
      weight: 1.0,
      privacyClassification: "public"
    }
  ],
  /**
   * Reviewed commentable resource contributed to `comments` (ADR-0041). The
   * publication filter is IDENTICAL to the `searchSources` one above and must
   * stay that way: both answer "is this post public right now?", and letting
   * them drift would mean a post is searchable but not commentable (or worse,
   * commentable while unpublished). `comments` reads this through
   * `listModules()`; nothing here imports `comments`.
   */
  commentableResources: [
    {
      key: "blog_content.post",
      ownerModuleKey: "blog_content",
      resourceType: "blog_post",
      tableName: "awcms_blog_posts",
      tenantColumn: "tenant_id",
      idColumn: "id",
      localeColumn: "locale",
      slugColumn: "slug",
      urlTemplate: "/blog/:tenantCode/:slug",
      publicationFilter: {
        equals: { status: "published", visibility: "public" },
        nullColumns: ["deleted_at"],
        notNullColumns: ["published_at"],
        timeReachedColumns: ["published_at"]
      },
      defaultPolicy: "moderated-anonymous"
    }
  ],
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
    },
    {
      command: "bun run blog:ads:ingest",
      purpose:
        "ADR-0044 §4 Fase 2: migrate the retired free-URL advertisement system (`awcms_blog_ads` + `awcms_blog_ad_placements`) onto the media-backed `awcms_news_portal_ad_placements`, and REPORT every ad it cannot migrate. Preview is the default — the job writes nothing until given `--apply`, which additionally requires `--placement-key=<key>` because the legacy data does not say which of the twelve slots an ad belongs in and this job will not guess. An ad is migrated only when its `image_url` is already the public URL of one of that tenant's registered, publicly-referenceable media objects; a remote, malformed, foreign-key, or unregistered image is residue, printed with its URL for a human to re-upload through the media library. Idempotent via `source_legacy_ad_id` under a partial unique index (migration 079), so the intended preview -> apply -> fix residue -> apply again loop never duplicates a row.",
      recommendedSchedule:
        "NOT scheduled. A one-shot operator-run migration for a planned window — run it, read the residue, resolve it, run it again. It becomes a no-op once every legacy ad has moved or been accepted as residue, and the script is retired with the legacy tables in the step after that.",
      environmentNotes:
        "Reads `NEWS_MEDIA_R2_PUBLIC_BASE_URL` to recognise this deployment's own media URLs; with it unset every ad is reported as residue rather than migrated, which is loud and lossless. Makes no network call of any kind — it never fetches an image, and deliberately so (see `domain/legacy-ad-ingest.ts`).",
      safeInOfflineLan: true
    },
    {
      command: "bun run blog:ads:drop-readiness",
      purpose:
        "ADR-0044 §4 Fase 2: answers whether `awcms_blog_ads` and `awcms_blog_ad_placements` may be dropped yet, and exits non-zero while the answer is no. A legacy ad is accounted for when a successor row names it via `source_legacy_ad_id` (migration 079) or when it is soft-deleted — an operator read the residue report and decided it does not come along. Anything else blocks, and there is deliberately no override flag. Read-only: it issues no INSERT, UPDATE or DELETE, so it is safe to run against production at any time, including before the ingest has ever run.",
      recommendedSchedule:
        "NOT scheduled. Run it by hand before writing the drop migration, and re-run it after each round of `blog:ads:ingest`. Retired together with the legacy tables it inspects.",
      environmentNotes:
        "No configuration and no external call — a pure database read. Answers only 'is there a legacy row whose fate nobody has decided'; whether the successor rows are editorially correct is human judgement it does not pretend to check.",
      safeInOfflineLan: true
    }
  ]
});
