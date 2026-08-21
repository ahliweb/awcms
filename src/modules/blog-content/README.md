🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# Blog Content

Implementation of Issue #537, #538, #539, #540, #541, #542, and #543 (epic #536 — `blog_content`, `docs/adr/0009-public-tenant-scoped-routes.md`). **The first domain module registered directly in this base repo** — previously `AGENTS.md` §Module map only listed generic base modules; see the note there for context. This epic is **done** — every acceptance criterion of issues #537-#543 is met; `module.ts`'s `status` is already `active` (no longer `experimental`).

## Scope per issue

Issue #537: module descriptor, domain validation, read-only application placeholder, and the database schema (migration 026/027) — see §Tables and §Permission seed.

Issue #538: admin CRUD + lifecycle API for blog posts at `/api/v1/blog/posts` (see §Admin API — Blog Posts).

Issue #539: admin CRUD API for static pages (`/api/v1/blog/pages`, see §Admin API — Blog Pages), categories/tags (`/api/v1/blog/terms`, see §Admin API — Blog Taxonomies), post-term relation assignment (through `termIds` in the post payload, see §Post-term relation handling), and PostgreSQL full-text search (`/api/v1/blog/search` admin + a public-safe helper, see §Search). Migration `028` turns `search_vector` into `GENERATED ALWAYS ... STORED`.

Issue #540: anonymous public routes (no session) under `/blog/{tenantCode}/...` per ADR-0009 — index, post detail, category/tag archives, search, RSS feed, and sitemap. See §Public routes.

Issue #541: append-only revision history for posts/pages, revision restore (explicit permission + Idempotency-Key), the scheduled-publishing job (`bun run blog:publish:scheduled`), and the full AsyncAPI domain event contract for this module's lifecycle. See §Revisions and §Scheduled publishing.

Issue #542: presentation/monetization extensions — templates, hierarchical menus, widgets, ads with placement/scheduling, per-tenant theme override, `translation_group_id` for multilingual, and a new `gallery` block in `content_json` for public images/video. Migration `029`/`030`. See §Presentation extensions.

Issue #543 (final hardening): a full admin UI under `/admin/blog` (dashboard, posts, pages, categories, tags, settings, and optional advanced screens templates/widgets/menus/ads — all of them using the existing `AdminLayout`/design tokens, Astro + vanilla JS only, no new framework), the `blog_content.settings.*` endpoints (`/api/v1/blog/settings`, finally activating `awcms_blog_settings`, which had existed since migration 026 but had no route), `module.ts`'s `permissions`/`navigation` arrays (previously empty even though its 36 permissions had been in the DB since migration 027/030), and the final documentation/testing/hardening. See §Admin UI and §Settings API.

ADR-0071 (superseding ADR-0059): the host-resolved public route family `/news/**` is **REMOVED** from this repo — `/blog/**` is the permanent public vocabulary here, `/news/**` belongs to `ahliweb/awcms-astro`. What went with it: all four route files, the `withHostResolvedBlogTenant` gate, and the `publicRouteMode` setting. What is left in the descriptor's `settings.defaults` is only `legacyTenantRouteEnabled` (the `/blog/{tenantCode}` family switch) — **not** `rssEnabled`/`sitemapEnabled`, which stay in `awcms_blog_settings`. `publicBasePath`/`publicLabel` are deliberately NOT adopted. See §The retired `/news` family and §Public route settings.

## Tables (migration `026_awcms_blog_content_schema.sql`)

Seven tables exactly as in the issue #537 doc §Database Tables, all tenant-scoped (`ENABLE` + `FORCE ROW LEVEL SECURITY`, one `tenant_isolation` policy per table):

1. **`awcms_blog_posts`** — `status`: `draft → review → scheduled → published → archived` (`domain/post-status.ts` `isValidStatusTransition`), `visibility`: `public | private | unlisted`. Slug unique per `(tenant_id, locale)` while `deleted_at IS NULL` (partial unique index). `search_vector tsvector` — since migration `028` (Issue #539) this column is `GENERATED ALWAYS ... STORED` (weighted `title` 'A' / `excerpt` 'B' / `content_text` 'C', text search config `simple`), PostgreSQL itself keeps it in sync; the GIN index is still there.
2. **`awcms_blog_pages`** — the same core structure as posts (including the same generated STORED `search_vector` since migration `028`), plus `page_type` (`standard | landing | legal | system`), `parent_page_id` (self-FK), `menu_order`.
3. **`awcms_blog_terms`** — categories (`taxonomy_type = 'category'`, may have a `parent_id`) and tags (`taxonomy_type = 'tag'`, a `CHECK` rejects `parent_id` — see also `domain/taxonomy-policy.ts` for the application-level pre-insert check). Slug unique per `(tenant_id, taxonomy_type)`.
4. **`awcms_blog_post_terms`** — many-to-many post↔term relation, still carrying its own `tenant_id` (not only through the FK) so RLS can isolate this join row directly, the same convention as the other relation tables in this base.
5. **`awcms_blog_revisions`** — **append-only**, never `UPDATE`d by the application (same pattern as `awcms_workflow_decisions`/`awcms_audit_events`). "Restoring a revision" means creating a new revision holding the old content, not overwriting any row — its restore code path was implemented by Issue #541, see §Revisions. There is no `slug` column.
6. **`awcms_blog_redirects`** — soft-deletable (not append-only), unique per `(tenant_id, from_path)` while active.
7. **`awcms_blog_settings`** — one row per tenant, `tenant_id` itself is the primary key (same pattern as `awcms_tenant_settings`, migration 002), not soft-deletable (it is configured, not deleted).

There is no explicit `GRANT` to `awcms_app` in migration 026 — migration 013 already installed `ALTER DEFAULT PRIVILEGES`, which automatically grants any new table created by the owner role (reused by migration 025 for the same reason).

## Presentation tables (migration `029_awcms_blog_content_presentation_schema.sql`, Issue #542)

Eight schema additions, all tenant-scoped RLS FORCE like migration 026, per the issue #542 doc §Important Scope Control (it does not rebuild the base media library/tenant/RBAC/audit/theme engine):

1. **`awcms_blog_templates`** — `layout_json` is **whitelisted**, not free-form JSON (`{ columns: 1|2|3, sidebarPosition: 'left'|'right'|'none' }`, validated by `domain/template-policy.ts`). Unique per `(tenant_id, key)` while `deleted_at IS NULL`.
2. **`awcms_blog_menus`** + **`awcms_blog_menu_items`** — hierarchical, **one level** of nesting only (the same limit as the category/tag parent). `menu_items.link_type` (`post|page|url`) gates which field is meaningful (`target_id` for post/page, `url` for url — validated as absolute http(s), `isAbsoluteHttpUrl`).
3. **`awcms_blog_widgets`** — `position` (`header|sidebar|footer|content_before|content_after`), `body_text` is plain text (escaped at render time, there is no raw-HTML field).
4. **`awcms_blog_ads`** + **`awcms_blog_ad_placements`** — `image_url`/`link_url` must be absolute http(s). `ad_placements.placement_type` (`global|widget|post|page`) gates `target_id` (`NULL` for `global`, a UUID required for the rest).
5. **`awcms_blog_theme_settings`** — one row per tenant (`tenant_id` = PK, the same pattern as `awcms_blog_settings`), `mode` (`light|dark|system`) is an **override** of `awcms_tenants.default_theme` (migration 002) — no row means "inherit the tenant default", not a hardcoded `'light'`.
6. `awcms_blog_posts`/`awcms_blog_pages` get a new column `translation_group_id uuid` (nullable, self-grouping, no trigger) — see §Presentation extensions §Multilingual.

There is no new table for media galleries — see §Presentation extensions §Media/Gallery for why.

## Permission seed (migration `027_awcms_blog_content_permissions.sql`, `030_awcms_blog_content_presentation_permissions.sql`, `052_awcms_blog_content_internal_tag_links_permissions.sql`)

26 permissions from migration 027, exactly as in the issue #537 doc §Permission Seed (`blog_content.posts.*`, `.pages.*`, `.taxonomies.*`, `.revisions.*`, `.settings.*`, `.seo.configure`, `.search.read`). Migration 030 (Issue #542) adds 10 more permissions: `templates.{read,configure}`, `menus.{read,configure}`, `widgets.{read,configure}`, `ads.{read,configure}`, `theme.{read,configure}` — one `read` + one `configure` per resource, the same granularity pattern as `taxonomies.{read,configure}` (admin master/config data, not content with a lifecycle). There is no implicit role grant — they are only assignable through the existing Access & Users.

Up to Issue #543 these 36 permissions existed in the database but `module.ts`'s `permissions` array was empty — Module Management's permission-sync report (`fetchModulePermissionSyncReport`, used by `admin/modules/[moduleKey].astro`'s Permissions panel) therefore had nothing to compare against the DB. Issue #543 declares all 36 permissions in `module.ts` (mirroring migration 027+030 exactly, not adding new permissions) so that sync report finally works for this module, and adds `navigation: [{ path: "/admin/blog", ... }]` so `/admin/blog` shows up in the admin sidebar (see §Admin UI).

Migration 052 (Issue #641, epic `news_portal`) adds 3 more permissions: `internal_links.{read,configure,preview}` — for the automatic internal tag linking feature (a render-time transform that links matching tag names in the body of published posts to their tag archive page, `domain/internal-tag-linking.ts`). This module's permission total is now **39** (26 + 10 + 3), all of them declared in `module.ts`'s `permissions` array. The real endpoints: `GET/PATCH /api/v1/blog/internal-tag-links/settings` (`internal_links.read`/`internal_links.configure`) and `GET /api/v1/blog/posts/{id}/internal-links/preview` (`internal_links.preview`).

## Domain validation (`domain/`)

- `content-validation.ts` — `validateBlogContentCore`: the core fields shared by post & page (`title`, `slug`, `excerpt`, `contentJson`, `contentText`, `locale`), plus individual field-level validators (`validateTitleField`, etc.) reused by the partial update of page/post, and `validateDeleteReasonInput` (`{ reason: string }`) reused by the soft-delete of post/page/term.
- `post-status.ts` — the status/visibility enums + `isValidStatusTransition` (one source of truth reused by the Issue #538 lifecycle endpoints and Issue #541 scheduled-publishing), plus `canRestorePost`/`canPurgePost`.
- `page-type.ts` (Issue #539) — the `PageType` enum (`standard | landing | legal | system`) + `isPageType`.
- `slug-policy.ts` — `isValidSlug` (format) + `slugify` (derived from the title; the caller must still check uniqueness itself).
- `seo-validation.ts` — `validateSeoFields` (`seoTitle` ≤70 chars, `metaDescription` ≤160 chars, `canonicalUrl` must be an absolute http(s) URL).
- `taxonomy-policy.ts` — `validateTermParent` (a FLAT vocabulary — `tag` or `topic` — may not have a parent, and a term may not be its own parent) — an application pre-check before the DB constraint `awcms_blog_terms_flat_taxonomy_no_parent_check` is ever touched. Since sql/131 the vocabulary is `category | tag | channel | topic` (PRD LenteraKalteng §8.5).
- `content-access-policy.ts` (Issue #539) — `evaluateContentUpdateAccess`, the generic ABAC ownership override (see §ABAC below) extracted from Issue #538's `post-access-policy.ts` so `page-access-policy.ts` can reuse exactly the same logic rather than duplicate it. `post-access-policy.ts`/`page-access-policy.ts` are now thin wrappers that pin their respective `updateGuard` (`blog_content.posts.update` / `.pages.update`).
- `blog-post-validation.ts` — `validateCreateBlogPostInput`/`validateUpdateBlogPostInput`/`validateScheduleBlogPostInput`/`validateSoftDeleteBlogPostInput`. Issue #539 adds `termIds?: string[]` (shape validation only — a UUID array, deduplicated; per-tenant existence is checked in the application layer).
- `blog-page-validation.ts` (Issue #539) — structurally the same as `blog-post-validation.ts`, plus `pageType`/`parentPageId` (rejects itself as parent)/`menuOrder` (integer ≥0).
- `blog-term-validation.ts` (Issue #539) — `validateCreateBlogTermInput`/`validateUpdateBlogTermInput`/`validateSoftDeleteBlogTermInput`. An update cannot re-check the tag-has-no-parent rule against the existing row (a pure validator, it does not query the DB) — it is the endpoint (`PATCH /api/v1/blog/terms/{id}`) that merges the new fields with the existing row before calling `validateTermParent` again.
- `template-policy.ts` (Issue #542) — `validateTemplateLayout` (whitelist `{ columns, sidebarPosition }`), `validateCreateTemplateInput`/`validateUpdateTemplateInput` (key format = `isValidSlug`).
- `menu-policy.ts` (Issue #542) — `validateMenuItemsInput`: cross-item validation within one batch (unique ids, `parentItemId` must reference another item in the same batch, at most one level of nesting) — see §Presentation extensions §Menus for why `id` must be client-supplied.
- `widget-policy.ts` (Issue #542) — `validateCreateWidgetInput`/`validateUpdateWidgetInput`, `bodyText` reuses `content-validation.ts`'s `containsUnsafeHtml` (newly exported in Issue #542, previously private).
- `ad-policy.ts` (Issue #542) — `validateCreateAdInput`/`validateUpdateAdInput` (`imageUrl`/`linkUrl` = `isAbsoluteHttpUrl`, `endsAt > startsAt`), `validateAdPlacementsInput` (`targetId` required for `widget|post|page`, forbidden for `global`).
- `theme-policy.ts` (Issue #542) — `validateUpdateThemeSettingsInput` (`mode` = `light|dark|system`, the same value set as `tenant-admin`'s `VALID_THEMES` but defined independently — this repo has no cross-module shared-domain-constant convention).

## Application (`application/`)

- `blog-post-directory.ts` — it used to be (Issue #537) only a read-only placeholder; Issue #538 completed it with every post mutation (`createBlogPost`, `updateBlogPost`, `softDeleteBlogPost`, `transitionBlogPostStatus`, `restoreBlogPost`, `purgeBlogPost`) in the same file — the same "one directory, read+write" convention as `email/application/email-template-directory.ts`, not split into a separate service file. `version` (an integer column in the #537 schema) is incremented on every successful `updateBlogPost`/`transitionBlogPostStatus` — a monotonic change marker only, there is **not yet** an optimistic-concurrency check (If-Match/expected-version) that reads it. Issue #543 adds `listBlogPostsForAdmin` (a pure addition, it changes no other function in this file) — `search` (`ILIKE` on the title, not `search_vector`, so an empty query still shows every post), `status`, `termId` (via `EXISTS` against `awcms_blog_post_terms`, not a `JOIN`, so a post with many terms never appears twice), and page-numbered pagination (`page`/`pageSize` + `total`) — used by `/admin/blog` for the search/filter/pagination that `listBlogPosts`/`GET /api/v1/blog/posts` do not provide. There is no new JSON endpoint for this function (no OpenAPI change) — it is only called directly from the SSR frontmatter of `admin/blog/posts/index.astro`, the same pattern as `admin/index.astro` calling reporting functions directly.
- `blog-page-directory.ts` (Issue #539) — structurally identical to `blog-post-directory.ts` (`createBlogPage`, `fetchBlogPageById`, `listBlogPages`, `updateBlogPage`, `softDeleteBlogPage`), **without** `transitionBlogPostStatus`/`restoreBlogPage`/`purgeBlogPage` — pages have no lifecycle-action endpoint in this issue (see §Admin API — Blog Pages). Issue #543 adds `listBlogPagesForAdmin` — the same convention as `listBlogPostsForAdmin` (search+status+pageType filter, page-numbered pagination), without a term filter (pages have no taxonomy relation).
- `author-lookup.ts` (Issue #543) — `fetchAuthorDisplayNames(tx, tenantId, tenantUserIds)`, resolving `author_tenant_user_id` -> display name for the "author" column in `/admin/blog`. A narrow join `awcms_tenant_users` -> `awcms_identities` -> `awcms_profiles`, narrowed down from `identity-access/application/user-directory.ts`'s `fetchTenantUsersWithRoles` (that function also loads role assignments and is gated by `identity_access.user_management.read`, a permission that should not be a precondition for a blog editor seeing the author name of their own content). Ids that are not found (e.g. a deleted user) are deliberately absent from the resulting `Map` rather than throwing an error — the UI caller falls back to the placeholder "Unknown".
- `blog-settings-directory.ts` (Issue #543) — `fetchBlogSettings`/`upsertBlogSettings` for `awcms_blog_settings` (migration 026, one row per tenant), finally activated through `GET`/`PATCH /api/v1/blog/settings` — see §Settings API.
- `blog-taxonomy-directory.ts` — it used to be (Issue #537) only the `fetchBlogTermsByTaxonomyType` placeholder; Issue #539 completed it with full term CRUD (`createBlogTerm`, `fetchBlogTermById`, `listBlogTerms`, `updateBlogTerm`, `softDeleteBlogTerm`) plus the post-term relation functions (`syncPostTermAssignments`, `fetchPostTermIds`, `countExistingTerms`) — see §Post-term relation handling.
- `blog-search.ts` (Issue #539) — `searchBlogContentAdmin` (all statuses, guard `search.read`) and `searchPublicBlogContent` (the public predicate, a pure helper — see §Search).
- `blog-revision-directory.ts` (Issue #541) — `createBlogRevision` (INSERT-only, `revision_number` = `MAX(...)+1` scoped to `(tenant_id, resource_type, resource_id)`), `listBlogRevisions`, `fetchBlogRevisionById` (scoped to `resource_id` too, not just `id` — a revisionId from another post cannot be read through this post's URL). There is no update/delete function in this file at all — see §Revisions.
- `blog-scheduled-publish.ts` (Issue #541) — `publishDueScheduledPosts`, one set-based `UPDATE` per tenant, called by `scripts/blog-scheduled-publish.ts` — see §Scheduled publishing.
- `domain/revision-policy.ts` (Issue #541) — `isSignificantContentChange` (true if `title`/`contentJson`/`contentText` are present in the update input; cosmetic fields like `seoTitle`/`canonicalUrl`/`slug` do not trigger a new revision).
- `template-directory.ts`/`menu-directory.ts`/`widget-directory.ts`/`ads-directory.ts`/`theme-settings-directory.ts` (Issue #542) — a CRUD directory per resource, the same pattern as `blog-taxonomy-directory.ts` (one file, read+write, soft-delete). `menu-directory.ts`'s `syncMenuItems` and `ads-directory.ts`'s `syncAdPlacements` full-replace their sub-resource (delete-then-insert), just like `syncPostTermAssignments`.
- `localized-content-directory.ts` (Issue #542) — `setPostTranslationGroup`/`fetchPostTranslations`, a single-column `UPDATE`/`SELECT` that deliberately stands on its own and does **not** touch `blog-post-directory.ts`'s `createBlogPost`/`updateBlogPost` (see §Presentation extensions §Multilingual for the risk/invasiveness reasoning).

## Admin API — Blog Posts (Issue #538)

`/api/v1/blog/posts` (`src/pages/api/v1/blog/posts/`), bearer session + `X-AWCMS-Mini-Tenant-ID`, the same pattern as every other endpoint in this base (`resolveAuthInputs`/`extractBearerToken` → `authorizeInTransaction`/`evaluateAccess` → service → `recordAuditEvent` → `ok()`/`fail()`).

```txt
GET    /api/v1/blog/posts                    -> blog_content.posts.read
POST   /api/v1/blog/posts                     -> blog_content.posts.create
GET    /api/v1/blog/posts/{id}                -> blog_content.posts.read
PATCH  /api/v1/blog/posts/{id}                -> blog_content.posts.update (+ author-own-draft override, see below)
DELETE /api/v1/blog/posts/{id}                -> blog_content.posts.delete
POST   /api/v1/blog/posts/{id}/submit-review  -> blog_content.posts.update (same override)
POST   /api/v1/blog/posts/{id}/publish        -> blog_content.posts.publish (Idempotency-Key required)
POST   /api/v1/blog/posts/{id}/schedule       -> blog_content.posts.schedule (Idempotency-Key required)
POST   /api/v1/blog/posts/{id}/archive        -> blog_content.posts.archive (Idempotency-Key required)
POST   /api/v1/blog/posts/{id}/restore        -> blog_content.posts.restore (Idempotency-Key required)
POST   /api/v1/blog/posts/{id}/purge          -> blog_content.posts.purge (Idempotency-Key required)
GET    /api/v1/blog/posts/{id}/quality-checklist -> blog_content.posts.read (Issue #640, read-only preview)
```

### Content quality checklist gate on publish/schedule (Issue #640)

The `publish`/`schedule` above now run `content-quality-checklist-gate.ts`'s `evaluateContentQualityChecklistForContent` BEFORE the status transition — server-side, not just a client preview (`GET .../quality-checklist`, used by the admin editor panel). This checklist is a no-op (`applicable: false`) unless full-online R2-only news portal mode (`news_portal`, Issue #632/#636) is active for the calling tenant — the majority of `blog_content`-only tenants are not affected at all. When the mode is active and one `blocking` rule fails (e.g. unsafe HTML, a local image path, an external image URL, a featured/gallery image that is not a verified R2 object), the request is rejected with `422 CONTENT_QUALITY_CHECKLIST_BLOCKED` and audited as `blog.post.publish_blocked_by_checklist`/`.schedule_blocked_by_checklist`. The full rule/severity/tenant-policy detail lives in `.claude/skills/awcms-news-portal/SKILL.md` §640 (not duplicated here, because the logic genuinely lives in the `news_portal` epic's cross-cutting context, just like §636's gate for create/update).

### ABAC — an author may edit their own draft without the `update` permission

The issue #538 doc §ABAC Rules demands two things at once from **one** permission `blog_content.posts.update`: "an Editor/Admin with the permission may edit every post in the tenant" **and** "an Author may edit their own draft even before it is published" (without that permission). `domain/content-access-policy.ts`'s `evaluateContentUpdateAccess` (the generic logic, extracted in Issue #539 so pages can reuse it) expresses this as an OR: the role permission (the "Editor/Admin" path) OR (caller = `authorTenantUserId` AND `status !== 'published'`) (the "Author" path). `post-access-policy.ts`'s `evaluatePostUpdateAccess` and `page-access-policy.ts`'s `evaluatePageUpdateAccess` are thin wrappers that pin their guard to `blog_content.posts.update`/`.pages.update`. The generic function is **deliberately not** placed in `identity-access/domain/access-control.ts`'s `evaluateAccess` — that is the cross-module, deny-biased evaluator (ADR-0004 "default deny, deny overrides allow"); an ALLOW override based on resource ownership is `blog_content`-specific business logic, layered on top of `evaluateAccess` (call it first, then fall back to the ownership check only if the sole deny reason is `default_deny`), not a new cross-module primitive like the existing `self_approval_deny`.

Used by `PATCH /api/v1/blog/posts/{id}`, `POST /api/v1/blog/posts/{id}/submit-review`, and `PATCH /api/v1/blog/pages/{id}` (all of which map to the `update` permission); the other endpoints (`publish`/`schedule`/`archive`/`restore`/`purge` for posts) do NOT have an ownership override — a pure permission check via `authorizeInTransaction`, per the literal issue #538 doc: "Author may not publish unless granted `blog_content.posts.publish`". Pages have no lifecycle-action endpoint at all in this issue (see §Admin API — Blog Pages), so there is no ownership-override question for publish/schedule/archive on pages.

### The `AccessAction` union widened: `publish`, `schedule`, `archive`

Just as Issue 10.1 added `restore`/`purge` and the sync object queue added `retry`, the `posts.publish`/`.schedule`/`.archive` guards need three new values in `identity-access/domain/access-control.ts`'s `AccessAction` union (see that module's README). They are **not** added to `HIGH_RISK_ACTIONS` (documentary metadata, not a gate) — the endpoints still call `recordAuditEvent` explicitly and still require an `Idempotency-Key` regardless of that classification.

### Status transition validation & purge/restore preconditions

- Every status transition (submit-review/publish/schedule/archive) is validated via `isValidStatusTransition` (Issue #537) before the mutation — an invalid transition → `409 INVALID_STATUS_TRANSITION`.
- `canPurgePost(status, deletedAt)` (new in `post-status.ts`) — purge is only allowed for a post that is already `archived` or already soft-deleted; anything else → `409 PURGE_NOT_ALLOWED`.
- `canRestorePost(deletedAt)` — restore is only for a post that is currently soft-deleted; anything else → `404`.

### HTML sanitisation

`domain/content-validation.ts`'s `validateContentJsonField`/`validateContentTextField` reject (rather than sanitise) `<script>`, `<iframe>`, `<embed>`, `<object>`, inline event-handler attributes, and `javascript:` URLs — exactly the same pattern used by `email-template-validation.ts` (doc 20 §XSS).

### Idempotency & audit

An `Idempotency-Key` is required for `publish`/`schedule`/`archive`/`restore`/`purge` (scopes: `blog_post_publish`/`blog_post_schedule`/`blog_post_archive`/`blog_post_restore`/`blog_post_purge`, generic table `awcms_idempotency_keys`). `create`/`update` do not require one (only recommended per the issue #538 doc) — a `create` retry that repeats the same slug hits `409 SLUG_CONFLICT` from the partial unique index, exactly like `POST /api/v1/email/templates`.

The audit `action` uses the exact strings from the issue #538 doc §Audit Requirements (`blog.post.created`, `.updated`, `.submitted_for_review`, `.published`, `.scheduled`, `.archived`, `.deleted`, `.restored`, `.purged`) — not the short generic verbs (`create`/`update`) other modules use, because this issue explicitly asks for those identifiers.

### Purge — cleaning up `post_terms`

`purgeBlogPost` deletes that post's `awcms_blog_post_terms` rows first (pure join metadata, meaningless once the post is gone) before `DELETE`ing the post itself — **different** from the `POST /api/v1/profiles/{id}/purge` pattern, which catches the foreign-key violation via a savepoint, because here we own both tables ourselves and know exactly what is safe to delete first. `awcms_blog_revisions` is deliberately **not** touched (no FK to the post, it stays as historical record even after the post is purged).

## Admin API — Blog Pages (Issue #539)

`/api/v1/blog/pages` (`src/pages/api/v1/blog/pages/`), the same pattern as posts (guard → validation → service → audit → response). **Different from posts: CRUD only, no lifecycle-action endpoint** (`submit-review`/`publish`/`schedule`/`archive`/`restore`/`purge`) — the issue #539 doc §Routes only lists GET/POST/GET/PATCH/DELETE for pages, even though the `blog_content.pages.{publish,archive,restore,purge}` permissions have been seeded since Issue #537. Those permissions are waiting for a follow-up issue that actually builds their endpoints — do not assume the page lifecycle works just because the permissions are in the catalogue.

```txt
GET    /api/v1/blog/pages          -> blog_content.pages.read
POST   /api/v1/blog/pages          -> blog_content.pages.create
GET    /api/v1/blog/pages/{id}     -> blog_content.pages.read
PATCH  /api/v1/blog/pages/{id}     -> blog_content.pages.update (+ author-own-draft override)
DELETE /api/v1/blog/pages/{id}     -> blog_content.pages.delete
GET    /api/v1/blog/pages/{id}/quality-checklist -> blog_content.pages.read (Issue #640, read-only preview — see note below)
```

Not idempotency-gated (same as posts create/update — recommended, not required). The audit `action` uses the same literal pattern: `blog.page.created`/`.updated`/`.deleted`.

`GET .../quality-checklist` (Issue #640) evaluates the same content checklist as posts (see §Content quality checklist gate above), BUT it is purely a **preview** for pages — because there is no `POST .../publish`/`.../schedule` for pages at all (the paragraph above), there is no state transition here to gate. `taxonomy_exists` is always `applicable: false` for pages (there is no `_terms` table for pages).

## Admin API — Blog Taxonomies (Issue #539)

`/api/v1/blog/terms` (`src/pages/api/v1/blog/terms/`). **There is no `GET /{id}`** — the issue #539 doc §Routes only lists list/create/update/delete for terms.

```txt
GET    /api/v1/blog/terms          -> blog_content.taxonomies.read
POST   /api/v1/blog/terms          -> blog_content.taxonomies.configure
PATCH  /api/v1/blog/terms/{id}     -> blog_content.taxonomies.configure
DELETE /api/v1/blog/terms/{id}     -> blog_content.taxonomies.configure
```

One permission (`configure`) gates create/update/delete at once — just as `sync_storage.conflict_resolution.approve` gates the whole of `POST /sync/conflicts/{id}/resolve` whatever the outcome (the permission is the capability "manage taxonomies", not a separate per-action one). There is no restore/purge — the issue #537 doc's permission seed has no `taxonomies.restore`/`.purge`, so a term soft-delete is one-way through this code (the row stays in the DB for audit, but no API path brings it back).

### `?order=created_at` — reading the WHOLE vocabulary (Issue #597)

The list defaults to `name ASC` with a bounded `LIMIT` (100, max 200 via `?limit=`), which is what the admin taxonomy screen wants and what made the endpoint unusable for anything else. A bare array carries no field that could say "there are more", so a caller that needed every term received the alphabetically-first hundred and had no way to find out. For `category` or `channel` that is harmless — a newsroom has a dozen of each. For `tag` on the 23,906-article archive of Issue #599 it means a static build generating a hundred tag pages out of thousands, `200 OK`, with every article filed under a later tag linking into a page nobody generated.

`?order=created_at` selects the stable traversal and the response gains `nextCursor`; follow it until it is null. `?cursor=` without `?order=created_at` is a `400`, because `name` is editable and a rename moves a term across a page boundary — the identical reasoning `GET /api/v1/blog/posts` records for `updated_at`. `listBlogTermsPage` (`application/blog-taxonomy-directory.ts`) is the query; `domain/blog-term-list-query.ts` is the refusal surface, and `tests/integration/blog-term-cursor.integration.test.ts` asserts both the traversal and the default list's silent truncation against a real PostgreSQL.

A `PATCH` that changes `taxonomyType` to `tag` while the old `parentId` is still there (not cleared in the same request) is rejected with `400` — the endpoint merges the submitted fields with the existing row before calling `validateTermParent` again, exactly as recorded in `blog-term-validation.ts`'s docblock.

## Post-term relation handling (Issue #539)

The issue #539 doc §Scope mentions "Post-term relation handling" but does **not** list a dedicated route for it in §Routes — so it is embedded in the existing blog post create/update payload (Issue #538), not a new endpoint:

- `POST`/`PATCH /api/v1/blog/posts(/{id})` accept an optional `termIds?: string[]`.
- If sent, `countExistingTerms` first checks that every id exists & belongs to the same tenant (`400 VALIDATION_ERROR` otherwise) — run **before** the post is written, so there is no "half-created" post when `termIds` is invalid.
- `syncPostTermAssignments` **replaces** the whole assignment set (`DELETE` every `awcms_blog_post_terms` row of that post, then `INSERT` the submitted set again) — not a diff/merge, because the caller always sends the complete desired list.
- The `GET`/`POST`/`PATCH /api/v1/blog/posts(/{id})` responses include `termIds` (assembled in the route handler through `fetchPostTermIds`, **not** a field on `BlogPostView` from `blog-post-directory.ts` — the directory stays purely about the `awcms_blog_posts` table). `GET /api/v1/blog/posts` (list) does **not** include `termIds` per item (an extra query per row is not worth it for a list).

## Search (Issue #539)

`blog-search.ts` — PostgreSQL full-text search through `search_vector @@ websearch_to_tsquery('simple', q)`, `UNION ALL` between posts and pages, ordered by `created_at DESC, id DESC`.

- **`GET /api/v1/blog/search`** (guard `blog_content.search.read`) — admin search, may return any status (`draft`/`review`/.../`archived`) as long as the caller has `search.read`; there is no additional per-status permission composition. Keyset-paginated through `_shared/keyset-pagination.ts` (base64 `cursor` of `(createdAt, id)`), exactly the same pattern as `GET /api/v1/logs/audit`. Optional filters `?type=post|page` and `?status=`.
- **`searchPublicBlogContent`** — a pure helper, **not** wired to any route in this issue (public route rendering = Issue #540, explicitly Out of Scope in the issue #539 doc). The predicate is exactly the one from the issue #539 doc §Public Visibility Predicate: `status = 'published' AND visibility = 'public' AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()`. Issue #540 calls this function directly rather than rewriting its predicate.

## Public routes (Issue #540)

`src/pages/blog/[tenantCode]/` — 7 public routes, anonymous (no session/tenant header), per ADR-0009: the tenant is resolved from the `tenantCode` path segment, not a subdomain/header.

```txt
GET /blog/{tenantCode}                         -> index (paginated, no auth/permission — public)
GET /blog/{tenantCode}/{slug}                   -> post detail
GET /blog/{tenantCode}/category/{slug}          -> category archive
GET /blog/{tenantCode}/tag/{slug}               -> tag archive
GET /blog/{tenantCode}/search?q=                -> public search (uses searchPublicBlogContent, Issue #539)
GET /blog/{tenantCode}/feed.xml                 -> RSS 2.0
GET /blog/{tenantCode}/sitemap-blog.xml         -> sitemap protocol 0.9
```

**Blog posts only**, not pages (`awcms_blog_pages`) — the issue #540 doc §Scope only lists "Public post detail page", there is no "Public page detail" anywhere among its scope bullets (unlike issue #539 §Routes, which explicitly names static pages). Public rendering for `blog_content` pages remains an open backlog item.

### Why a `.ts` API route, not an `.astro` page

All seven routes are `APIRoute`s (`.ts`, HTML/XML strings rendered by hand), **not** `.astro` files — a deliberate decision. This repo has no test convention for `.astro` output (every existing integration test, including the whole earlier `blog_content` suite, calls the `APIRoute` handler directly through `tests/integration/harness.ts`'s `invoke()`/`invokeRaw()`). Writing these routes as `.astro` would make them untestable through the pattern already established in the repo — while this issue's own requirements are explicit ("Tests cover public visibility leakage... SEO rendering... RSS and sitemap content filtering") and demand real end-to-end tests, not just unit tests of pure functions. `invokeRaw()` (new, `tests/integration/harness.ts`) complements `invoke()` for handlers that return a non-JSON body — `invoke()` itself always does `JSON.parse(text)` and would throw for HTML/XML.

### Two different public visibility predicates

The issue #540 doc defines one base "Public Visibility Rule" (`status='published' AND visibility='public' AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()`) plus an extra rule "listing/search/feed/sitemap: `visibility != 'unlisted'`". Those two sentences are redundant if the base predicate is ALWAYS `visibility='public'` — unless that base predicate is meant for the LISTING context only, and DETAIL has its own, slightly looser predicate. This issue's acceptance criteria confirm that reading: **"Unlisted content is excluded from listing/search/feed/sitemap"** (not from ALL public access) — meaning unlisted content must indeed remain reachable through a direct link, which is exactly why the "unlisted" tier exists separately from "private" (which is never public at all).

`public-blog-directory.ts` therefore has **two** predicates:

- **Listing** (index/category/tag/search/feed/sitemap): strict `visibility = 'public'` — exactly the same predicate as `searchPublicBlogContent` (Issue #539).
- **Detail** (`fetchPublicBlogPostBySlug`): `visibility IN ('public', 'unlisted')` — private is still always refused.

If a maintainer ever decides this interpretation is wrong, this is the only place that needs changing (it is not spread across 7 route handlers).

### Content block schema (new, defined by this issue)

`content_json` used to be "opaque to the API" (issue #537/#538 docs). Issue #540 defines its concrete shape for the first time, because public rendering needs something real to render: `{ blocks: ContentBlock[] }` with 4 block types — `paragraph`, `heading` (level 1-6), `list` (`ordered?: boolean`, `items: string[]`), `quote`. `domain/content-block-rendering.ts`'s `renderContentJsonToHtml` is a **whitelist renderer** — every block type only ever emits text through `escapeHtml`, there is no "raw html" block type. A block with an unknown `type` or invalid fields is skipped silently (it never throws — see §Error handling). Adding a new block type (image, embed, table, ...) means adding a new `case` to that function's `switch`, not opening a raw-HTML escape hatch.

### SEO rendering (`domain/seo-rendering.ts`)

- `resolveSeoTitle`: `seoTitle || title`.
- `resolveMetaDescription`: `metaDescription || excerpt || <a summary generated from contentText, cut at a word boundary, with "..." appended>`.
- `resolveCanonicalUrl`: use the author's `canonicalUrl` if it is a valid absolute http(s) URL (re-validated through the same `isAbsoluteHttpUrl` as the write-time check in `seo-validation.ts` — defense in depth, "Do not render unsafe URLs"); otherwise fall back to the page's own URL; if neither is valid, `null` (the `<link rel="canonical">` tag is not rendered at all, rather than rendered with an unsafe URL).

### Error handling — never leak a stack trace

Every route handler is wrapped in a top-level `try/catch`: the original error is logged through `log("error", ...)` (for the operator), but the response to the client is ALWAYS a fixed generic string (`src/lib/html/error-responses.ts`'s `notFoundHtmlResponse`/`serverErrorHtmlResponse`/`notFoundXmlResponse`/`serverErrorXmlResponse`) — never a raw message/`error.message`. A `tenantCode` that is not found OR not `active` yields an identical `404` (ADR-0009: "do not leak the existence of a tenant").

### Pagination

The index and the category/tag archives use `?page=` (1-indexed) + a plain `LIMIT`/`OFFSET`, not keyset — these are public pages read by human visitors (the UX expectation is "page 1, 2, 3", not an opaque cursor), unlike the admin search (Issue #539), which is keyset-paginated. `pageSize` comes from `awcms_blog_settings.posts_per_page` (Issue #537, default 10) via `fetchPublicBlogSettings`. RSS/sitemap are not paginated at all — flat, capped at the 50 most recent posts (`FEED_ITEM_LIMIT`), because their consumers are machines (feed readers/crawlers), not visitors clicking "next".

`?page=` is normalised through `parsePageParam`/`boundedPageNumber` (`src/modules/_shared/offset-pagination.ts`, Issue #819) — **not** a bare `Number(param)`. This route is public and unauthenticated, so `page` must be clamped at both ends: `?page=1e8` used to become `OFFSET 1e9` (Postgres still scans and then discards a billion rows while holding one pool connection — a one-request DoS), and `?page=abc` became `OFFSET NaN` → 500. Now non-numeric/`NaN`/`±Infinity`/negative values fall back to page 1, fractions are truncated, and the upper bound `MAX_PAGE_NUMBER` = 10,000. Junk is normalised to page 1, not a 400: this is an HTML archive route — a broken `?page=` must render the first page, not an error that crawlers then index. That same clamped value is what renders the pagination nav, so `?page=abc` never produces a `NaN` link. The admin lists (`listBlogPostsForAdmin`/`listBlogPagesForAdmin`) use the same helper.

## The retired `/news` family (ADR-0071 supersedes ADR-0059)

`src/pages/news/` **no longer exists.** ADR-0059 once added a SECOND, host-resolved
public route family — `/news`, `/news/{slug}`,
`/news/category/{slug}`, `/news/tag/{slug}` — together with the
`withHostResolvedBlogTenant` gate and the `publicRouteMode` switch.
[ADR-0071](../../../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
splits the AWCMS family's URL vocabulary: `/blog/**` is permanent in this repo,
`/news/**` belongs to `ahliweb/awcms-astro`. All four routes, their gate, and their
switch were deleted in the §4 implementation PR.

**What was retired was not simply switched off.** Those four routes were ON
by default (`publicRouteMode` = `domain_default`), so their URLs were real,
indexed, and already advertised by the sitemap and feed this repo publishes.
`seo_distribution` therefore installs a **301 from `/news/**` to
`/blog/{tenantCode}/**`** (`seo-distribution/domain/retired-news-redirect.ts`),
not a 404 — see §Retirement redirect in that module's README. This redirect is **not**
policy-gated: the routes are gone for everyone, so nobody can choose to keep
serving them. The only condition that applies is a
tenant with `legacyTenantRouteEnabled` `false` — it has no `/blog/**` either,
so redirecting it would mean handing the reader a 301 towards a guaranteed 404.

What did **not** disappear: every shared application/domain service is still in
place and still serves `/blog/{tenantCode}` —
`public-blog-directory.ts`, `public-page-rendering.ts`, `seo-rendering.ts`,
`content-block-rendering.ts`, `internal-tag-link-rendering.ts`,
`news-article-seo-metadata.ts`, `social-share-links.ts`. Not a single
function was duplicated when this family was pulled; what happened is that one
caller disappeared, not that one implementation forked.

### The rendering helper stays generic, and that is deliberate

`public-page-rendering.ts`'s `renderPostSummaryListHtmlAtBasePath(basePath, ...)`
remains in its general form, with `renderPostSummaryListHtml(tenantCode, ...)`
as the `/blog/{tenantCode}` wrapper. That general form was born to
serve two base paths; now it has only one caller. **It is deliberately not
inlined back**: merging them would mean rewriting behaviour that is already
proven byte-for-byte identical just to save one level of call, and
`awcms-astro` serves the other base path from the same contract.

### The advertised base path — two rows, not four

`resolvePublicContentBasePath` (`application/public-route-settings.ts`) shrinks
per ADR-0071 §3:

| `legacyTenantRouteEnabled` | Advertised base path |
| -------------------------- | -------------------- |
| `true`                     | `/blog/{tenantCode}` |
| `false`                    | no provider at all   |

The second row is the point, and it is **restated** by ADR-0071 §3 so it does
not fall away when ADR-0059 is superseded: a tenant that switches off its
public surface gets an EMPTY sitemap/feed, not one full of links that are
guaranteed 404s. The invariant "never advertise a URL we do not serve" is unchanged.

Test: `tests/blog-content-public-content-base-path.test.ts` (the rule itself, plus
"every advertised base path has a route file").

### Public share buttons + OG/Twitter metadata — Issue #642

Post detail (`/blog/{tenantCode}/{slug}`) renders a public share widget (native Web Share
API, copy-link, WhatsApp, Telegram, Facebook, LinkedIn, X, email) and
extended Open Graph/Twitter Card metadata. The pure modules:
`domain/social-share-links.ts` (`buildSocialShareLinks` — a fixed allowlist of six
platforms, every URL `encodeURIComponent`-ed; `renderSocialShareButtonsHtml`) and
`domain/social-share-config.ts` (the per-platform env flags `NEWS_SHARE_*_ENABLED`,
all defaulting to `true`). Instagram never gets a dedicated button because it has
no supported web-share URL; the canonical URL — not the raw request
querystring — is the only thing ever shared; the native-share/copy-link client
script is a same-origin static file (`public/js/news-share.js`), never
inline, so it adds zero CSP surface.

`renderPublicPageShell` also emits
`og:title`/`og:description`/`og:url`/`og:site_name` and
`twitter:title`/`twitter:description`/`twitter:card`. `og:image`/`twitter:image`/
`og:image:alt` are unchanged since Issue #636 (still gated on a verified R2 media
object).

## Public route settings

`application/public-route-settings.ts`'s `fetchEffectivePublicRouteSettings(tx, tenantId)`
computes one merged, read-only DTO for both route families, sourced from
**two** existing, already-authoritative stores — deliberately not a third one:

| Field                      | Store                                                                                                                              | Write path                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `legacyTenantRouteEnabled` | `blog_content` module descriptor `settings.defaults` + `awcms_module_settings` tenant override (generic tenant-settings framework) | `PATCH /api/v1/tenant/modules/blog_content/settings` |
| `rssEnabled`               | `awcms_blog_settings` (Issue #537, wired up Issue #543) — **unchanged**                                                            | `PATCH /api/v1/blog/settings`                        |
| `sitemapEnabled`           | `awcms_blog_settings` — **unchanged**                                                                                              | `PATCH /api/v1/blog/settings`                        |

`publicBasePath`/`publicLabel` — the two further keys awcms-micro carries —
are **not adopted** (ADR-0059 §4); see §`publicBasePath` below.

### Why `rssEnabled`/`sitemapEnabled` are NOT in the new descriptor defaults

Issue #564's own suggested example JSON lists `rssEnabled`/`sitemapEnabled`
alongside the four genuinely new keys. They are **deliberately excluded**
from `module.ts`'s `settings.defaults` here. Those two flags already
existed and already worked before this issue (Issue #537 defined the
column, Issue #543 wired up `PATCH /api/v1/blog/settings`, Issue #540/#560
made `/blog/{tenantCode}/feed.xml`/`sitemap-blog.xml` and
`/news/feed.xml`/`sitemap-news.xml` enforce them). Adding a _second_,
independently-writable copy of the same concept into
`awcms_module_settings` would create two disconnected sources of
truth: an admin could flip "RSS enabled" off in the generic module
settings store while the feed route keeps
reading the OLD `awcms_blog_settings` value and stays enabled — a
real correctness bug, not a stylistic preference. `fetchEffectivePublicRouteSettings`
proves this is enforced, not just documented:
`tests/integration/blog-content-settings.integration.test.ts`'s "writing
those exact key names into the new module-settings store has NO effect on
/news/feed.xml or /news/sitemap-news.xml" test PATCHes `rssEnabled: false`
into the wrong store and confirms the feed stays enabled, then flips it
through the correct store and confirms it actually disables.

### `publicBasePath` — NOT adopted, and that is the point

awcms-micro exposes `publicBasePath` as a per-tenant setting that changes
every self-referential URL a `/news` page emits — canonical `<link>`, feed
`<link>`/`<guid>`, sitemap `<loc>`, pagination hrefs, archive links. Its own
documentation states the limitation: it does **not** retarget which Astro file
route physically serves the request, because `/news/**` are file-based routes.

So setting it to anything but the physical path produces, per tenant, exactly
the failure this module keeps having to fix — a surface that reports success
while advertising URLs nothing serves. It is not adopted here (ADR-0059 §4).
The physical root is the constant `HOST_RESOLVED_PUBLIC_BASE_PATH`, and the
only per-tenant choice is WHICH FAMILY's base path is advertised
(`resolvePublicContentBasePath`, §Canonical URL above) — a choice between two
paths that both exist.

### Secret-shaped key rejection still applies

`PATCH /api/v1/tenant/modules/blog_content/settings` still runs through
the same `validateModuleSettingsPatch` (`module-management/domain/module-settings.ts`)
every other module's settings PATCH does — neither the key name
(`legacyTenantRouteEnabled`) nor its value matches any entry in `redaction.ts`'s
`REDACTION_KEYS` list, confirmed by
`tests/integration/blog-content-settings.integration.test.ts`'s existing
secret-shaped-key test (unchanged assertion, now targeting `blog_content`
instead of `form_drafts`).

## Revisions (Issue #541)

`/api/v1/blog/posts/{id}/revisions` (`src/pages/api/v1/blog/posts/[id]/revisions/`).

```txt
GET  /api/v1/blog/posts/{id}/revisions                     -> blog_content.revisions.read
GET  /api/v1/blog/posts/{id}/revisions/{revisionId}         -> blog_content.revisions.read
POST /api/v1/blog/posts/{id}/revisions/{revisionId}/restore -> blog_content.revisions.restore (Idempotency-Key required)
```

Routes for **posts** only — the issue #541 doc §Routes lists only the three routes above, even though the revision rule itself ("post/page changes") applies to both. `PATCH /api/v1/blog/pages/{id}` also triggers `createBlogRevision` with `resource_type = 'page'` (the row is stored, the history is recorded), but there is no read/restore route for page revisions in this issue — an open backlog item, see §Not yet available.

### When a new revision is created — "significant change"

`domain/revision-policy.ts`'s `isSignificantContentChange` — true if the `PATCH` includes `title`, `contentJson`, or `contentText`; other fields (`seoTitle`, `metaDescription`, `canonicalUrl`, `visibility`, `locale`, `featuredMediaId`, `slug`, `menuOrder`, ...) do not trigger a new revision. `awcms_blog_revisions` has no `slug` column (migration 026) — consistent with that decision. Called from `PATCH /api/v1/blog/posts/{id}` and `PATCH /api/v1/blog/pages/{id}`, **not** from the `POST` create — the first revision only appears once there is a first significant content change after create, not as an initial draft snapshot.

### Restore — append-only, never overwriting

`POST .../revisions/{revisionId}/restore`: (1) fetch the target revision's content, (2) write it back into the live post row through the ordinary `updateBlogPost`, (3) `createBlogRevision` again to record the restored state itself (`changeNote: "Restored from revision {n}."`). Step 3 means a restore **adds** a new row to `awcms_blog_revisions` and never `UPDATE`s/`DELETE`s any existing row — the full history, including the "in between" revisions, stays intact and can be read again later.

The `blog_content.revisions.restore` permission is **explicitly required** — there is no ownership override like `PATCH /api/v1/blog/posts/{id}` has (an author who owns the post is not automatically allowed to restore its revisions without that permission; see §ABAC under §Admin API — Blog Posts for the contrast in pattern). An `Idempotency-Key` is required (scope `blog_revision_restore`) — replaying the same key returns the stored response without adding a second revision.

Audit: `blog.post.revision_restored` (severity `warning`, `attributes: { revisionId, revisionNumber }`).

## Scheduled publishing (Issue #541, restructured by Issue #640)

`bun run blog:publish:scheduled` (`scripts/blog-scheduled-publish.ts`) — an internal worker, not an HTTP endpoint, scheduled by cron/a systemd timer (the same pattern as `scripts/form-draft-purge.ts`). For every active tenant it calls `blog-scheduled-publish.ts`'s `publishDueScheduledPosts(sql, tenantId, mediaPort, options?)`.

**Issue #640 changes the signature** (`mediaPort: MediaLibraryPort` — formerly `NewsMediaPort`, renamed by ADR-0036 — is now a required parameter, injected by `scripts/blog-scheduled-publish.ts` as the composition root, the same port pattern ADR-0011 established) **and** restructures it from one set-based `UPDATE` per tenant into a `SELECT ... FOR UPDATE` followed by a per-post loop:

```sql
SELECT id, slug, title, excerpt, content_json, content_text,
       featured_media_id, meta_description
FROM awcms_blog_posts
WHERE tenant_id = $1 AND status = 'scheduled'
  AND scheduled_at IS NOT NULL AND scheduled_at <= now() AND deleted_at IS NULL
FOR UPDATE
```

Every due post is evaluated through `content-quality-checklist-gate.ts`'s `evaluateContentQualityChecklistForContent` (see `.claude/skills/awcms-news-portal/SKILL.md` §640) before being transitioned — if the checklist fails (a blocking rule, relevant only when the tenant has enabled full-online R2-only mode), that post is **left `scheduled`** (not silently published, not unscheduled) and audited as `blog.post.scheduled_publish_blocked`; the job moves on to the next due post. Only the posts that pass are then `UPDATE`d one by one to `published`. The reason for the restructuring: without it a tenant could bypass the checklist entirely by scheduling a post BEFORE enabling R2-only mode (or before a media object is re-verified) and then waiting for it to fall due — the same class of hole as Issue #636's revision-restore bypass. `FOR UPDATE` keeps this job safe against two concurrent runs (e.g. two worker instances) for the same tenant.

Idempotent by construction: a post that is already `published`, whose `scheduled_at` is still in the future, or that was left `scheduled` because the checklist failed earlier, produces no new effect on the next run at the same `now`. `COALESCE(published_at, now())` ensures a post that **was** published before (`published_at` already filled from older history, then set back to `draft`/`scheduled` through manual SQL or a future endpoint) does not lose its original `published_at` — issue #541 doc §Scheduled Publishing Rules: "sets published_at=now() only if not already set".

Audit per published post: `blog.post.published` (reusing the same action as the manual `POST .../publish` — the distinguishing `trigger: "scheduled_publish"` exists only in the structured log, not in the audit `attributes`). Plus one summary event per tenant invocation: `blog.post.scheduled_publish_executed` (`attributes.publishedCount`/`blockedCount`) or `blog.post.scheduled_publish_skipped` (if nothing is due at all).

There is no external provider call whatsoever in this job (ADR-0006 is not relevant here — the job is purely a database transition, there is no dispatcher/provider that needs to be kept outside the transaction). `mediaPort` is not an external provider — its implementation (`mediaLibraryPortAdapter`, ADR-0036 — formerly `newsMediaPortAdapter`) only reads from the same Postgres, not from Cloudflare R2.

## Domain events (AsyncAPI, Issue #541, extended by Issue #542)

`asyncapi/awcms-domain-events.asyncapi.yaml` — 26 channels for `blog_content` (13 from Issue #541 + 13 from Issue #542), also registered in `module.ts`'s `events.publishes` (gated by `tests/domain-event-registry-parity.test.ts` — NOT `scripts/api-spec-check.ts`, which only reads the AsyncAPI file to make sure it parses; the function name `checkModuleEventChannels` once referenced here has never existed in this repo). Like every other event in this contract since Issue 0.3: **contract documentation only** — there is no real pub/sub dispatcher in this repo; the actual producer is the structured JSON logger (`src/lib/logging/logger.ts`'s `log()`), not an event bus. Log line naming convention: drop the `awcms.` prefix from the event type (`awcms.blog-content.post.published` -> log message `blog-content.post.published`) — exactly the same pattern as `email.message.queued` and friends.

All 26 events have a real producer in the code today (Issue #543 closed the only remaining gap, `settings.updated`):

| Event (AsyncAPI channel, without the `awcms.` prefix) | Log line emitted from                                                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blog-content.post.created`                           | `pages/api/v1/blog/posts/index.ts` (`POST`)                                                                                                                                                                             |
| `blog-content.post.updated`                           | `pages/api/v1/blog/posts/[id].ts` (`PATCH`)                                                                                                                                                                             |
| `blog-content.post.submitted-for-review`              | `pages/api/v1/blog/posts/[id]/submit-review.ts`                                                                                                                                                                         |
| `blog-content.post.published`                         | `pages/api/v1/blog/posts/[id]/publish.ts` **and** `blog-content/application/blog-scheduled-publish.ts` (the `trigger` attribute distinguishes them)                                                                     |
| `blog-content.post.scheduled`                         | `pages/api/v1/blog/posts/[id]/schedule.ts`                                                                                                                                                                              |
| `blog-content.post.archived`                          | `pages/api/v1/blog/posts/[id]/archive.ts`                                                                                                                                                                               |
| `blog-content.post.deleted`                           | `pages/api/v1/blog/posts/[id].ts` (`DELETE`)                                                                                                                                                                            |
| `blog-content.post.restored`                          | `pages/api/v1/blog/posts/[id]/restore.ts` (soft-delete restore, **not** revision restore)                                                                                                                               |
| `blog-content.post.purged`                            | `pages/api/v1/blog/posts/[id]/purge.ts`                                                                                                                                                                                 |
| `blog-content.revision.created`                       | `blog-content/application/blog-revision-directory.ts`'s `createBlogRevision` — one single point for a significant PATCH **and** for a revision restore, so its log line appears from both paths without duplicated code |
| `blog-content.term.created`                           | `pages/api/v1/blog/terms/index.ts` (`POST`)                                                                                                                                                                             |
| `blog-content.term.updated`                           | `pages/api/v1/blog/terms/[id].ts` (`PATCH`)                                                                                                                                                                             |
| `blog-content.template.created`/`.updated`/`.deleted` | `pages/api/v1/blog/templates/index.ts` (`POST`), `[id].ts` (`PATCH`/`DELETE`)                                                                                                                                           |
| `blog-content.menu.created`/`.updated`/`.deleted`     | `pages/api/v1/blog/menus/index.ts` (`POST`), `[id].ts` (`PATCH`/`DELETE`)                                                                                                                                               |
| `blog-content.widget.created`/`.updated`/`.deleted`   | `pages/api/v1/blog/widgets/index.ts` (`POST`), `[id].ts` (`PATCH`/`DELETE`)                                                                                                                                             |
| `blog-content.ad.created`/`.updated`/`.deleted`       | `pages/api/v1/blog/ads/index.ts` (`POST`), `[id].ts` (`PATCH`/`DELETE`)                                                                                                                                                 |
| `blog-content.theme.updated`                          | `pages/api/v1/blog/theme/index.ts` (`PATCH`) — **different** from `settings.updated` below, this one is strictly about `awcms_blog_theme_settings`, not `awcms_blog_settings`                                           |
| `blog-content.settings.updated`                       | `pages/api/v1/blog/settings/index.ts` (`PATCH`, Issue #543) — about `awcms_blog_settings`                                                                                                                               |

No gate demands that an AsyncAPI channel have a real PRODUCER in the code — `tests/domain-event-registry-parity.test.ts` enforces parity between `DOMAIN_EVENT_TYPE_REGISTRY` ↔ channel ↔ `events.publishes`, all of it declarative. That is why, before Issue #543, the `settings.updated` channel could live without a single call site publishing it, with every gate green.

## Presentation extensions (Issue #542)

The issue #542 doc is itself titled "Templates, Menus, Widgets, Media/Gallery, Multilingual, Theme Mode, and Ads" with its §Suggested Files/§Suggested Database Additions/§Suggested Routes explicitly labelled **"Suggested"** (unlike the literal §Routes in issues #537-#541) — so this implementation has more latitude to pick the approach most consistent with the existing architecture, as long as the Acceptance Criteria are still met. This issue's §Important Scope Control is explicit: do not rebuild the base media library, the base tenant system, the base RBAC/ABAC, the base audit, or the base theme engine.

### Templates, Menus, Widgets, Ads — full CRUD

These four resources are built as real admin CRUD (not lightweight), because each of them explicitly has its own §Suggested Routes in the issue and needs a full guard/audit/RLS:

```txt
GET    /api/v1/blog/templates          -> blog_content.templates.read
POST   /api/v1/blog/templates          -> blog_content.templates.configure
PATCH  /api/v1/blog/templates/{id}     -> blog_content.templates.configure
DELETE /api/v1/blog/templates/{id}     -> blog_content.templates.configure

GET    /api/v1/blog/menus              -> blog_content.menus.read
POST   /api/v1/blog/menus              -> blog_content.menus.configure
PATCH  /api/v1/blog/menus/{id}         -> blog_content.menus.configure
DELETE /api/v1/blog/menus/{id}         -> blog_content.menus.configure

GET    /api/v1/blog/widgets            -> blog_content.widgets.read
POST   /api/v1/blog/widgets            -> blog_content.widgets.configure
PATCH  /api/v1/blog/widgets/{id}       -> blog_content.widgets.configure
DELETE /api/v1/blog/widgets/{id}       -> blog_content.widgets.configure

GET    /api/v1/blog/ads                -> blog_content.ads.read
POST   /api/v1/blog/ads                -> blog_content.ads.configure
PATCH  /api/v1/blog/ads/{id}           -> blog_content.ads.configure
DELETE /api/v1/blog/ads/{id}           -> blog_content.ads.configure
```

One `configure` permission gates create/update/delete at once (the same pattern as `blog_content.taxonomies.configure`) — not a per-action permission like posts (`.publish`/`.schedule`/etc.), because these resources are admin master/config data, not content with a lifecycle status. There is no ABAC ownership override — `configure` is always checked purely through `authorizeInTransaction`.

### Menus — one-level hierarchy, `id` must be client-supplied

`POST`/`PATCH .../menus(/{id})` accept `items?: MenuItemEntryInput[]` — a **full replace** (delete every old item, insert the new set), just like `termIds` in the post payload. Because a full replace means the old ids are already gone by the time the new rows are inserted, each item's `id` **must be supplied by the client** (not the DB's `gen_random_uuid()`) — so that `parentItemId` in the same payload can reference its own sibling without needing to know a DB-generated id first. `domain/menu-policy.ts`'s `validateMenuItemsInput` validates: unique ids within the batch, `parentItemId` (if present) must reference another item in the same batch, and at most one level of nesting (an item whose `parentItemId` points at a parent that itself has a parent → rejected) — the same limit as categories/tags in `taxonomy-policy.ts`.

`linkType` (`post|page|url`) gates which field is required: `post`/`page` need `targetId` (a UUID, whose existence is **not** checked against the posts/pages tables — consistent with `termIds`' "shape only, existence check only if an extra DB request is warranted" pattern, deliberately skipped here because a menu may point at a resource that does not exist yet when the menu itself is created), `url` needs an absolute http(s) URL (`isAbsoluteHttpUrl`, the same as `canonicalUrl`).

### Widgets — fixed positions, plain-text body

`position` is one of `header|sidebar|footer|content_before|content_after` (a DB constraint + `domain/widget-policy.ts`). `bodyText` is not `content_json` — it is plain text, rejected (not sanitised) if it contains unsafe HTML patterns (`content-validation.ts`'s `containsUnsafeHtml`, newly exported by this issue). Public widget rendering (if/when it is built) must escape `bodyText`, just like the content_json block renderer — there is no public route for widgets in this issue yet.

### Ads — placement targeting + scheduling

`imageUrl`/`linkUrl` must be absolute http(s) URLs — there is no embed/iframe/raw-HTML field in the schema at all, so rendering (`ads-directory.ts`'s `renderAdHtml`, a whitelist of `<img>`/`<a>` only) **cannot** become an XSS channel whatever the request contains. `placements` (a full replace, like `menu items`) links one ad to `global`/`widget`/`post`/`page`; `targetId` is required for the last three, forbidden for `global`. Scheduling: `startsAt`/`endsAt` are optional, `endsAt` must be > `startsAt` when both are present.

`listActiveAdsForPlacement` (a public-safe query: `is_active=true` + the schedule window + tenant scope) and `renderAdHtml` are available and tested, but **not yet wired to any route** — the same precedent as `searchPublicBlogContent` in Issue #539 ("a tested helper, its wiring is another issue").

**Note (Issue #638, updated by ADR-0044)**: the ads system above temporarily STILL accepts a free http(s) URL in `image_url`, side by side with the R2-only ad placement system (`awcms_news_portal_ad_placements`) that **this module now also owns** after `news_portal` was merged in. Two systems for one feature is a temporary state, not a design: `awcms_blog_ads.image_url` accepts any URL, which is exactly the unmanaged-media hole that `media_library` enforcement (ADR-0036) exists to close. ADR-0044 §4 decides the two are unified into the table with an FK to verified media — after that table is widened with the `post`/`page` targeting only the old system has, so the unification does not silently delete a capability. Until that unification migration lands, do not add new consumers of `awcms_blog_ads`.

### Theme mode — a tenant override, not a new engine

`GET`/`PATCH /api/v1/blog/theme` reads/writes `awcms_blog_theme_settings` (one row per tenant). A `GET` with no override row returns `{ mode: <tenant.default_theme>, isOverride: false }` — the base theme engine (`awcms_tenants.default_theme`, migration 002) remains the only source of truth for the default; this blog table is purely an optional override layer and does not duplicate the tenant logic at all.

### Multilingual — a thin link column, not a new endpoint

The core requirements ("locale-based storage/retrieval", "slug uniqueness tenant+locale aware") have **been met since Issue #537** through the existing `locale` column + the partial unique index `(tenant_id, locale, slug)` on posts/pages — this issue does not redesign that. What is new: the `translation_group_id` column (nullable, no FK/trigger) so several locale variants of one logical post can be linked. Implemented as standalone functions (`localized-content-directory.ts`'s `setPostTranslationGroup`/`fetchPostTranslations`) called from `POST`/`PATCH /api/v1/blog/posts(/{id})` **after** `createBlogPost`/`updateBlogPost` succeeds — **not** added to the existing `INSERT`/`UPDATE`/`RETURNING` in `blog-post-directory.ts`, because that column is touched in 7+ different places in that file; one narrow, independent `UPDATE` is far lower risk than re-operating on every `RETURNING` clause in a file that has been tested since Issue #538. Posts only, not pages (scope control: one path is enough to prove the pattern works).

### Media/Gallery — a new `content_json` block, not a media table

The issue #542 doc is explicit: "Do not rebuild the base media library... Integrate with existing media/file capability where available." This base repo **has no** real media library — `featuredMediaId` on posts/pages (Issue #538) is just a loose UUID with no FK, validated only for shape. Because there is nothing real to integrate with, the gallery is implemented as a new block type in the existing whitelist renderer (`content-block-rendering.ts`, see §Content block schema under §Public routes): `{ type: "gallery", items: GalleryItem[] }`, each item `{ mediaType: "image"|"video", url, caption? }`. `url` is validated with `isAbsoluteHttpUrl` at render time (the same defense-in-depth as `canonicalUrl`); items that fail validation are skipped silently (not thrown). Rendering emits only `<img>`/`<video controls>` — no `<iframe>`/embed. There is no separate gallery endpoint/table — a gallery is part of the existing post/page `content_json`, written through the existing `PATCH` as well.

**Issue #636 update** (epic `news_portal`, outside epic #536): the paragraph above stays accurate for non-R2-only deployments (the majority today). When full-online R2-only mode is active for the calling tenant, `featuredMediaId` and gallery items with `mediaType: "image"` MUST reference a `verified`/`attached` row in the `news_portal` media registry (Issue #633) — items with `mediaType: "video"` and all non-R2-only behaviour are unchanged. It is still **not** a new media library inside `blog_content` — see `.claude/skills/awcms-news-portal/SKILL.md` §636 for the full detail.

**Issue #637 update** (epic `news_portal`): `public-blog-directory.ts`'s `PublicBlogPostSummary` (listing/archive/homepage-composer queries — previously only `PublicBlogPostDetail`, single-post-by-slug, carried `featuredMediaId`) now also includes `featuredMediaId`, so `news_portal`'s homepage section composer can show a post's featured image on the summary card without a separate query. There is no schema/validation change to `blog_content` itself here — purely one more column added to an existing SELECT.

## Settings API (Issue #543)

`GET`/`PATCH /api/v1/blog/settings` (`src/pages/api/v1/blog/settings/index.ts`) — finally activating `awcms_blog_settings` (migration 026, one row per tenant, `tenant_id` = PK), which had been in the schema since Issue #537 but had no route. There is no `{id}` in the path — like `PATCH /api/v1/blog/theme`, it is one row per tenant.

```txt
GET   /api/v1/blog/settings   -> blog_content.settings.read
PATCH /api/v1/blog/settings   -> blog_content.settings.configure
```

Fields: `defaultLocale`/`defaultVisibility`/`postsPerPage`/`seoDefaultTitle`/`seoDefaultDescription` have had their own typed columns since migration 026 (also used by `fetchPublicBlogSettings`, Issue #540, for the public `posts_per_page` pagination). `blogTitle`/`blogDescription`/`rssEnabled`/`sitemapEnabled` do **not** have their own columns — adding new columns is out of scope for this issue — so they are stored in the catch-all `settings jsonb` column the table already has (shallow-merge, not replace, the same semantics as `updateModuleSettings`). `PATCH` is a partial update (only the submitted fields are validated/written, `domain/blog-settings-policy.ts`'s `validateUpdateBlogSettingsInput`), publishes `blog-content.settings.updated` (closing the gap the README §Domain events noted earlier: the channel had been registered since Issue #541 but had no producer until now) and audits `blog.settings.updated`.

### RSS/sitemap now honour `rssEnabled`/`sitemapEnabled`

`GET /blog/{tenantCode}/feed.xml` and `.../sitemap-blog.xml` (Issue #540) call `fetchBlogSettings` at the top of the handler and return a `404` identical to tenant-not-found when the relevant flag is `false` — a tenant that switches off RSS/sitemap leaks no signal distinguishing "this feature exists but is off" from "this tenant does not exist", consistent with ADR-0009's "do not leak the existence of a tenant" already applied in §Public routes.

## Admin UI

**What EXISTS in this repo: one screen, `/admin/blog`** (`src/pages/admin/blog.astro`,
ADR-0051) — a post lifecycle console: a filtered list (title search, status)
with page-numbered pagination, per-row publish/schedule/archive/soft-delete/
restore/purge/submit-review actions, a revisions panel (`?post=<id>`) with restore, and a
new-draft form. Eleven permissions are exercised from there; gated by
`tests/admin-blog-page-contract.test.ts`.

Three things are DELIBERATELY absent from that screen, and the differences matter:

- **A body/content editor.** Writing a post body means a rich-text/Markdown surface
  plus SEO fields, terms, and featured media — that is an editor, not a corner of a
  list. `posts.update` is still exercised through "submit for review".
- **`posts.export`.** Declared in the descriptor and seeded by `sql/036`, and **there
  is not a single endpoint that enforces it**. A screen cannot exercise a
  permission without a surface; its button would send a request that 404s.
- **`search.read`.** The endpoint exists, but the admin list already has its own
  search (`ILIKE` on the title, which tolerates an empty query — precisely what
  `websearch_to_tsquery` behind `search.read` rejects). Two search boxes
  with different semantics on one screen is worse than one.

**The remaining 32 permissions** (pages, taxonomy, templates/menus/widgets, settings/seo/theme,
internal links, homepage sections, ad placements) are waiting for their sibling screens —
each will bring its own `navigation` entry when its page lands.

> **Everything below this line is the awcms-mini SPECIFICATION (Issue #543),
> not a description of this repo's code.** The `/admin/blog/*` screen tree below — posts/new,
> pages, categories, tags, settings, templates, widgets, menus, ads — **does not exist
> here**; the text came along when this module was ported, and because this module did
> not declare `navigation` back then, the `admin-navigation-registry.test.ts` gate
> that catches dangling paths had nothing to check. It is kept
> because it is a useful target design for the sibling screens above — read it
> as a plan, not as a map of the code.

<!-- aspirational:mulai -->

### (mini specification) Every screen under `/admin/blog` (`src/pages/admin/blog/`), using the existing `AdminLayout`/design tokens (`docs/awcms/14_ui_ux_design_system.md`), Astro + vanilla JS only — no new UI framework. Each screen's pattern is identical to `admin/modules/[moduleKey].astro`/`admin/access-users.astro` (references that existed before this issue): an SSR read through the same application-layer function the JSON endpoints use (or could use), every mutation through a client-side `fetch()` to the `/api/v1/blog/...` endpoints that have been guarded/audited/idempotency-gated since Issue #538-#542 — an admin page **never** writes to the database directly or bypasses the endpoint's ABAC guard. Permission-gated per section, following exactly the guard of the underlying endpoint (defense-in-depth; the real enforcement stays on the server).

```txt
/admin/blog                    -> dashboard (post/draft/scheduled/pages summary, quick links)
/admin/blog/posts              -> post list (search, status filter, category/tag filter, pagination)
/admin/blog/posts/new          -> new post editor
/admin/blog/posts/[id]         -> post editor (edit, lifecycle actions, revision history)
/admin/blog/pages              -> static page list (search, status/type filter, pagination)
/admin/blog/pages/new          -> new page editor
/admin/blog/pages/[id]         -> page editor (edit only — no lifecycle action/revision UI)
/admin/blog/categories         -> category manager (hierarchy, slug conflicts visible)
/admin/blog/tags               -> tag manager (NO parent field at all)
/admin/blog/settings           -> blog settings form + theme mode
/admin/blog/templates          -> template manager (optional, Issue #542)
/admin/blog/widgets            -> widget manager (optional, Issue #542)
/admin/blog/menus              -> menu manager (optional, Issue #542)
/admin/blog/ads                -> ads manager (optional, Issue #542)
```

<!-- aspirational:selesai -->

Sidebar navigation: one `/admin/blog` entry in `module.ts`'s `navigation` array (label `admin.layout.nav_blog`, guard `blog_content.posts.read`), rendered automatically by `AdminLayout.astro` through the existing `fetchVisibleModuleNavigationEntries` (Issue #518) — not hardcoded into `AdminLayout.astro`. Sub-navigation between the `/admin/blog/*` screens uses ordinary quick links on the dashboard/each screen (this repo has no nested-sidebar convention).

### Post editor — field-to-API mapping

`content` is split into two separate fields, mirroring the shape of `awcms_blog_posts` itself: `contentText` (a plain textarea, required) and `contentJson` (a labelled JSON textarea, default `{"blocks":[]}`, validated with `JSON.parse` on the client before submit + `validateContentJsonField` on the server) — not a new rich-text/block editor (`content_json`'s schema since Issue #540 has only 4+1 block types, `paragraph`/`heading`/`list`/`quote`/`gallery`; building a visual editor for that is out of proportion for this issue). "Category" and "Tags" are rendered as two separate `<select multiple>` controls (filtered from the same term list by `taxonomyType`) but merged into a single `termIds` array on submit — the API itself does not distinguish category from tag inside `termIds`.

Each lifecycle action (`submit-review`/`publish`/`schedule`/`archive`/`restore`/`purge`) is rendered only if `isValidStatusTransition`/`canRestorePost`/`canPurgePost` (the same pure functions the endpoints use) allows that transition from the post's current status **and** the caller holds that action's permission — this check is a UI nicety only, the endpoint still re-validates identically. Publish/schedule/archive/restore/purge all do: `window.confirm` first, then a fresh `Idempotency-Key` (`crypto.randomUUID()`, `lib/ui/admin-form-client.ts`'s `newIdempotencyKey`) per attempt. Revision history (`blog_content.revisions.read`) shows a revisions table + a per-row "Restore" button (`blog_content.revisions.restore`, a separate explicit guard — there is NO ownership override, just like its endpoint), also with a confirm first.

The "author" field (post list + editor) is resolved through `author-lookup.ts`'s `fetchAuthorDisplayNames`, not `identity-access`'s full user directory (see §Application for why).

### Page editor — no lifecycle, no revision UI

There is deliberately no status/publish button at all — `UpdateBlogPageInput` has no `status` field (README §Admin API — Blog Pages: a page is always `draft` from creation, no endpoint changes that). There is no revision history panel for pages either — `createBlogRevision` is still called from `PATCH /api/v1/blog/pages/{id}` (the row is stored in `awcms_blog_revisions`), but there is no `GET .../revisions` route for `resource_type='page'` this UI could call (see §Not yet available — another issue's backlog, not something that could simply be "added" from the UI side).

### Category/Tag manager — a deliberate file split

`admin/blog/categories.astro` and `admin/blog/tags.astro` are two separate files (not one screen with a `?type=` param) precisely so the "a tag may not have a parent" prohibition can be enforced structurally at the markup level — `tags.astro` never renders a `parentId` form element at all (not a field hidden behind a condition), so there is no UI path that could send `parentId` for a tag. Both call the same `/api/v1/blog/terms`, only the `taxonomyType` in the body differs. A slug conflict (`409 SLUG_CONFLICT`, no dedicated i18n entry) is shown as-is from the server message through the action banner — like every other unmapped error code in the admin UI.

### Templates/Widgets/Ads/Menus — complex sub-arrays through a labelled JSON textarea

A template's `layoutJson` is simple enough (`{columns, sidebarPosition}`) for two ordinary `<select>` controls. A menu's `items` and an ad's `placements` are far more complex (arrays of objects, and `menu items` need client-supplied UUID ids that reference each other within a single payload, see README §Menus) — building a dedicated tree/drag-drop editor for that is out of proportion for this issue's budget and would still have to produce exactly the same JSON shape. Both of those forms use a labelled JSON textarea + help text, the same pattern `admin/modules/[moduleKey].astro`'s settings panel already uses for structured config — the "Copy new id" button on the menu screen copies a fresh `crypto.randomUUID()` to the clipboard (rather than inserting it into the textarea, so it can never corrupt the JSON being edited).

### Theme mode goes into Settings, not its own screen

`GET`/`PATCH /api/v1/blog/theme` (Issue #542) is merged in as an extra section instead of a separate theme screen — in this repo that section landed at `/admin/blog-presentation?section=theme`, while `/admin/blog-settings` holds the blog settings (`awcms_blog_settings`) — this is tenant-wide configuration of the same class as the other fields on that screen, and issue #543's own screen list does not name a separate theme screen.

### Deliberately skipped: a pure Media/Gallery screen

Issue #543's list of optional screens names "Media/Gallery" — skipped as a screen of its own because there is no real media library to manage (README §Media/Gallery — Issue #542: a gallery is part of a `content_json` block, not a separate media table/endpoint). Managing a gallery means editing the `gallery` block array inside a post/page `contentJson` — already possible through the `contentJson` textarea in the post/page editor, no separate screen needed.

### Accessibility and UX (doc 14)

Every admin screen has four explicit states — loading (SSR, not a client spinner), empty (`p.empty-state`/a "nothing here yet ..." message), error (`StateNotice kind="error"` with a retry link, kept separate from `kind="denied"` for permissions), and ready (content). Every mutating action disables its own submit button while the request is in flight (`lib/ui/admin-form-client.ts`'s `lockElement`, `aria-busy="true"`) so a double click/double Enter never sends two requests — not a replacement for server-side idempotency, the two are layered. High-risk actions (publish/schedule/archive/restore/purge/delete/purge-config/revision-restore) always `window.confirm` first. Every `<label>` is explicitly associated with its input (markup `<label>text<input/></label>`, not a separate `aria-label`, except for icon-only controls that genuinely have no visible text). Keyboard focus is visible through `:focus-visible` (not plain `:focus`, so a mouse click does not trigger an unnecessary outline) in every screen's `<style>` block. Every displayed string goes through `t()` (gettext `.po` catalogues, `en`+`id`, see §Internationalization).

### Internationalization

Every UI string (~300 new keys, namespace `admin.blog.*`) is added to `i18n/en.po` **and** `i18n/id.po` (skill `awcms-i18n`, flat `namespace.key` gettext catalogues at the `i18n/` root, not per module) — there is no hardcoded string in any `.astro` file. A client `<script>` cannot read the `.po` catalogue directly (server-only, `Bun.file`), so each screen injects the already-translated strings through a `<script type="application/json" id="i18n-strings">` blob (`readClientStrings()`), the same pattern `admin/access-users.astro`/`admin/modules/[moduleKey].astro` already use. `admin.layout.nav_blog` (the sidebar label) and a few `common.*` keys (`filter_all`/`previous_page`/`next_page`) are new — the rest (`common.error_title`, `common.network_error`, etc.) reuse existing keys.

### Security notes (Issue #543 summary)

- No hardcoded secret was added — these admin screens are purely UI + calls to existing endpoints; there is no direct database connection from the client, no new token/API key.
- No public PostgreSQL exposure — all data access still goes through the existing `withTenant`/backend application, and the SSR read in the Astro frontmatter runs server-side (just like `admin/index.astro`/`admin/sync.astro`, which existed before this issue).
- Least-privilege runtime DB access — unchanged; admin pages are still bound to the same `awcms_app` role connection the whole app uses (see `docs/awcms/18_configuration_env_reference.md`).
- RLS isolation — explicitly re-tested in `tests/integration/blog-content-admin-ui.integration.test.ts` for the two new functions (the `listBlogPostsForAdmin` tenant-isolation test); the other functions the admin screens call (`listBlogPages`, `listBlogTerms`, etc.) already have RLS coverage from the Issue #538-#542 test suites.
- High-risk admin actions must confirm + audit — post lifecycle actions have been audited since Issue #538/#541 (`recordAuditEvent`, action `blog.post.<verb>`); the admin screens add a `window.confirm` layer on top of that, they do not replace it.
- Public rendering stays XSS-safe — unchanged by this issue; `content_json`/`content_text`/widget `bodyText`/ad `imageUrl`/`linkUrl` still go through the same whitelist renderers (`content-block-rendering.ts`, `ads-directory.ts`'s `renderAdHtml`). The admin editor (the `contentJson` textarea) lets an author type anything, but server validation (`validateContentJsonField`'s `containsUnsafeHtml`) still rejects `<script>`/`<iframe>`/`<embed>`/`<object>`/inline handlers/`javascript:` before it is stored — the editor does not loosen that rule.
- Error messages do not leak a stack trace — the admin action banner always shows `error.message` from the API response (which is itself already safe, doc 10) or the generic `common.network_error` string, never `error.stack`/a raw exception from `console.error` (which is only recorded server-side).

### Build feed: stable cursor-based traversal

`GET /api/v1/blog/posts` defaults to `updated_at DESC` ordering — correct for the
admin table, and **invalid** as a keyset key: editing a post
moves it, so a row can cross a page boundary between two
requests and then be missed or appear twice, with nothing able to
detect it.

A caller that needs ALL posts (the `awcms-astro` feed build) uses:

```
GET /api/v1/blog/posts?order=created_at&limit=100
GET /api/v1/blog/posts?order=created_at&limit=100&cursor=<nextCursor>
```

`created_at` is immutable, so the traversal is stable. A `?cursor=` without
`?order=created_at` is **rejected with 400**, not silently served — silent pagination
over a mutable ordering shows up precisely as "some articles are missing
from the site" months later.

`nextCursor` is printed in the layer that still holds the microsecond-precision text
(`to_char(... 'US')`), never re-derived from a JS `Date` in the route —
`Date` has already rounded the microseconds down and revives the
row-skipping bug of Issue #158. Proven in `tests/integration/blog-post-cursor.integration.test.ts`
with a batch insert whose rows all share a single instant.

#### The `?locale=` filter

```
GET /api/v1/blog/posts?order=created_at&view=full&locale=id&limit=50
```

Added to close awcms-astro ADR-0021 §2: without it, a single-language site
build has to pull ALL locales and then throw most of them away.
It matches **exactly** (`locale = $1`), not by prefix — `en` does not catch `en-GB`.
Absent means all locales, which remains the correct default for the admin table:
hiding translations because the operator did not name a language is a surprising
answer.

Its shape is **not** validated beyond non-empty and a 35-character limit, and that is
deliberate: the column is `text NOT NULL DEFAULT 'id'` and the WRITE path accepts any
non-empty string, so a read filter stricter than the write path would
make a stored locale UNREACHABLE — a row that exists, that
shows up in the admin table, and that no query could select. An empty `?locale=`
is rejected with 400, not treated as absent.

All three list functions accept it (`listBlogPosts`, `listBlogPostsPage`,
`listBlogPostsFullPage`), because the route picks between the three via
`view`/`order` — a filter wired into two of three would not be visible
until someone changed the query string. Proven in
`tests/integration/blog-post-locale-filter.integration.test.ts`.

### Testing commands

```bash
bun run db:migrate                     # the schema does not change in this issue (0 applied, 30 skipped)
bun run api:spec:check                 # OpenAPI/AsyncAPI baseline (26 blog-content channels, all of them used)
bun run typecheck                      # tsc --noEmit, including every admin/blog/* .astro
bun test                               # unit + integration; DATABASE_URL is required for the integration suite
bun test tests/integration/blog-content-admin-ui.integration.test.ts  # the new test specific to Issue #543
bun run build                          # Astro build, including every admin/blog/* screen
bun run check                          # lint + check:docs + api:spec:check + typecheck + test + build
bun run config:validate                # the env contract (one of the three go-live stages that actually exist)
bun run security:readiness             # security posture (RLS FORCE, default-deny, audit trail)
bun run db:pool:health                 # pool/backpressure health
# The `production:preflight` orchestrator that runs all three as one
# gated go/no-go DOES NOT YET exist in this repo — see docs/awcms/production-preflight-runbook.md §Document status.
```

### Operational checklist (Issue #543)

- [ ] Before deploying: `bun run db:migrate` (idempotent, safe to run repeatedly).
- [ ] `bun run check` green in CI before merging.
- [ ] After deploying, verify manually: log in as a role with `blog_content.posts.read` -> `/admin/blog` appears in the sidebar -> create a draft post -> publish -> check it appears at `/blog/{tenantCode}` (if visibility is `public`).
- [ ] Verify `rssEnabled`/`sitemapEnabled` at `/admin/blog-settings`: switch one off -> that tenant's `feed.xml`/`sitemap-blog.xml` returns 404.
- [ ] `bun run blog:publish:scheduled` is still scheduled by a separate cron/systemd timer (Issue #541, unchanged by this issue) — it is not triggered from any UI.
- [ ] The audit log (`/admin` -> module audit summary or `GET /api/v1/logs/audit`) shows `blog.post.*`/`blog.settings.updated` after lifecycle/settings actions from this new UI.

## Absorbed from `news_portal` (ADR-0044)

The `news_portal` module was retired; its two remaining features live here now.
What was merged is **ownership**, not shape: the table names and API paths were
deliberately NOT changed, following the ADR-0036 precedent that moved the media
registry into `media_library` without renaming `awcms_news_media_objects`.

| Feature                                                                                                                                       | Table                                             | Routes                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Editorial homepage section composer (6 types: `headline`, `latest_posts`, `featured_posts`, `editor_picks`, `category_grid`, `gallery_block`) | `awcms_news_portal_homepage_sections` (`sql/044`) | `GET`/`POST /api/v1/news-portal/homepage-sections`, `PATCH`/`DELETE .../{id}` |
| R2-only ad placement (12 `placement_key`s, 4 `rotation_mode`s, `priority`, scheduling)                                                        | `awcms_news_portal_ad_placements` (`sql/045`)     | `GET`/`POST /api/v1/news-portal/ad-placements`, `PATCH`/`DELETE .../{id}`     |

The files that moved: `domain/ad-placement-policy.ts`,
`domain/ad-placement-rotation.ts`, `domain/homepage-section-policy.ts`,
`domain/news-portal-preset-readiness.ts`,
`application/ad-placement-directory.ts`,
`application/ad-placement-reference-validation.ts`,
`application/homepage-section-directory.ts`,
`application/homepage-section-reference-validation.ts`.

Four permissions (`homepage_sections`/`ad_placements` × `read`/`configure`)
were repointed from `news_portal` to `blog_content` by `sql/076`, in the order
insert → repoint grant → delete so no tenant loses its
capability. `tests/news-portal-merge.test.ts` keeps every piece
above in place.

**What was deleted along with it, and why**: `awcms_news_portal_tenant_state`
(`sql/043`) together with its read helper. Its writer —
`apply-news-portal-preset.ts` — was never ported into this base, so the table was
inert; managed-media enforcement is switched on per tenant through
`media_library`'s `POST /api/v1/media/enforcement`. `sql/077`
DROPs it. Keeping a FORCE-RLS table with no owner and no writer
only makes every inventory gate report something nobody
guards at all.

`capabilities.consumes` for `media_library` **changes from `optional: true`
to required**: ad placement holds a real FK to a verified media object,
and that is exactly why `news_portal` used to declare it non-optional. Absorbing
its code means absorbing its constraint.

## Not yet available (an explicit backlog, not an oversight)

- Public page (static page) rendering — only posts have a public route in Issue #540, see §Public routes.
- Page revision list/detail/restore endpoints — `createBlogRevision` is already called from `PATCH /api/v1/blog/pages/{id}` (the row is stored), but there is no read/restore route for `resource_type = 'page'`, only for posts (see §Revisions). The admin UI (§Admin UI above) therefore has no revision panel for pages either.
- Public routes for widget/ads rendering (real header/sidebar/footer placement on a public page) — `listActiveAdsForPlacement`/`renderAdHtml`/`listWidgets({ activeOnly: true })` exist and are tested, but are not wired to any public route yet.
- Revision/`translationGroupId` routes for pages — `setPostTranslationGroup` is posts-only in this issue.
- Page lifecycle-action endpoints (`submit-review`/`publish`/`schedule`/`archive`/`restore`/`purge` for pages) — their permissions are seeded (Issue #537) but no issue explicitly builds their endpoints; an open backlog item, not part of #539. As a consequence, the page editor (§Admin UI) has no status button at all either.
- An optimistic-concurrency check that reads the `version` column — the column is already incremented on every write, but no endpoint rejects a write on a `version` mismatch yet.
- Search relevance ranking (`ts_rank`) and a per-locale text search config (`english`/`indonesian`) — `search_vector` is already weighted (A/B/C) for that future need, but `GET /api/v1/blog/search` (admin) and the public search currently order only by `created_at DESC`.
- Locale-aware negotiation for public visitors (e.g. the `Accept-Language` header) — the public index/detail currently shows all posts with no locale filter; `<html lang>` uses the post/tenant locale, not the visitor's preference.
- `robots.txt` and a sitemap reference from `robots.txt` — only the sitemap XML itself exists, nothing references it automatically yet.
- A rich visual block editor for `content_json` — the admin UI (Issue #543) uses a labelled JSON textarea for `contentJson`/menu items/ad placements, not a visual/drag-drop editor; building that remains an open backlog item if it is ever deemed necessary.
- A pure admin screen for media/gallery — there is none (and there will be none without a real base media library); galleries are managed through the `content_json` block in the existing post/page editor.
- A per-tenant physical base path — NOT built, and the archive's `publicBasePath` is not adopted either because it only changes the URLs that are GENERATED without moving the route that serves them (§Public route settings §`publicBasePath`).
- A dedicated visual settings editor for `legacyTenantRouteEnabled` — still not built, but its old justification has been wrong twice and both versions are worth reading in order. The original text read <!-- historis:mulai -->"deliberately not built; the generic `/admin/modules/blog_content` screen (Module Management, already exists) is enough to edit it through the existing JSON textarea"<!-- historis:selesai --> — and that screen **never existed**, so its claim was used to justify building nothing. The next correction recorded that absence. **Since Issue #546 the screen DOES exist**: `/admin/modules/{moduleKey}` shows the defaults, the tenant override, and the merged result, and accepts patches — so module settings are no longer changeable only through `curl`. It is deliberately a PATCH box, not a document editor, because its contract merges shallowly and has no deletion path at all. A dedicated editor here is therefore now a convenience choice, not a gap closer.
