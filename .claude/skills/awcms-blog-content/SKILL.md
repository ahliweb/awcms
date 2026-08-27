---
name: awcms-blog-content
description: The blog_content module HAS ALREADY been ported into this repo (PR #214) and since **ADR-0044 (PR #300) it ABSORBS ALL OF `news_portal`** — the homepage-section composer + ad placements with a verified `media_object_id` now belong to it, `src/modules/news-portal/` no longer exists, and the `awcms_news_portal_*` table names are KEPT (hard composite FK) so a table name is not a hint about ownership. The free-URL ad write path (`awcms_blog_ads.image_url`) is CLOSED (#303) after targeting was widened (#301) and the legacy ad ingest job landed (#302); the content-block vocabulary is now a gated contract (#304). (PR #214; `src/modules/blog-content`, migrations `sql/035`–`sql/040`, 15 `awcms_blog_*` tables with FORCE RLS). Guidance for CHANGING/adding to `src/modules/blog-content`, `src/pages/blog`, changing the blog schema, or working on follow-up issues. awcms adaptation NOTES (different from the mini specification below): ONE public route family — PATH-based `/blog/{tenantCode}` (ADR-0009, switch `legacyTenantRouteEnabled`). The host-resolved `/news/**` family that ADR-0059 added has been REMOVED by ADR-0071 (§4 ALREADY EXECUTED): all four routes, the `withHostResolvedBlogTenant` gate, and the `publicRouteMode` switch are gone — `/news/**` is `ahliweb/awcms-astro` vocabulary, and all that remains here is the `seo_distribution` 301 to `/blog/{tenantCode}/**`; the media capability is now `media_library` (ADR-0036 INVERSION — formerly `news_media` from news_portal; now the `media_library` module itself, with the REAL adapter `mediaLibraryPortAdapter` and method `isManagedMediaEnforcementActiveForTenant`); the `social_publishing` hook is still a no-op (that module does not exist here — ADR-0055 makes it a BUILD candidate, not a port); the blog admin UI ALREADY EXISTS — four screens `src/pages/admin/blog.astro`, `blog-pages.astro`, `blog-taxonomy.astro`, `blog-presentation.astro`. The `sql/NNN` numbers in the skill body use awcms-mini numbering — the real migrations in awcms are `sql/035`–`sql/040` (see the module README + the real `sql/`). Use when adding a blog endpoint/logic, changing the schema, or on follow-up issues.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Blog Content Module

<!-- sql-refs: awcms-mini — the `sql/NNN` numbers in this skill body use awcms-mini numbering; the module HAS been ported into awcms as `sql/035`–`sql/040` (see the module README + the real `sql/` for the actual numbers) -->

> **STATUS — ALREADY ported into this repo (PR #214).**
> `blog_content` is real here now: `src/modules/blog-content`, migrations
> `sql/035_awcms_blog_content_schema.sql`–`sql/040_awcms_blog_content_internal_tag_links_permissions.sql`,
> 15 `awcms_blog_*` tables (all `FORCE ROW LEVEL SECURITY`). This skill is now
> **guidance for changing/adding real code**, not a port target specification.
> Read `src/modules/blog-content/README.md` + `sql/` for accurate
> numbers/tables.
>
> **ABSORPTION OF `news_portal` (ADR-0044, PR #300) — READ BEFORE TOUCHING ADS OR THE HOMEPAGE:**
>
> - The `news_portal` module was **merged into here**. `src/modules/news-portal/` was deleted and
>   the registry shrank by one module (the absolute number is deliberately not written here — it goes stale every time a new module lands; `listModules()` is what answers). The `awcms-news-portal` skill is now historical.
> - What moved and now **lives in this module**: the homepage-section composer + ad
>   placements with a **verified** `media_object_id` (12 `placement_key` slots,
>   `rotation_mode`, `priority`), plus global/widget/post/page `placement_type`
>   targeting + `target_id`, **widened** to the R2 table (#301).
> - **The `awcms_news_portal_*` table names are KEPT** (ADR-0036 precedent — hard
>   composite FK). Do not rename them, and do not infer module ownership
>   from a table name.
> - **This module's OpenAPI contract (PR #308):** its fragment is
>   `openapi/modules/blog-content.openapi.yaml` — `api.openApiPath` used to point
>   wrongly at the BUNDLE, and the now-deleted
>   `openapi/modules/news-portal.openapi.yaml` was merged into it. This module
>   therefore owns **three** tags:
>   `Blog Content` (newly declared — its 30 paths were previously missing entirely
>   from `docs/awcms/api-reference.md`), plus `News Portal Homepage Sections`
>   and `News Portal Ad Placements` whose public names are deliberately kept.
>   Adding an endpoint here means editing that fragment, and any new tag
>   MUST be declared in `openapi/awcms-public-api.src.yaml`.
> - **The `awcms_blog_ads.image_url` write path is CLOSED (#303).** It was an
>   unmanaged-media hole that `media_library` + its enforcement exist to close:
>   a tenant could turn managed-media ON and still publish arbitrary remote
>   images through that table. New ads **must** carry `media_object_id`. Old data
>   is moved by the ingest job (#302, `bun run blog:ads:ingest` — preview first,
>   residue is reported) and drop readiness is checked by
>   `bun run blog:ads:drop-readiness`.
> - The content-block vocabulary (`content_json`) is now a **gated contract** (#304) —
>   adding a block type means touching that gate, not just the renderer.
>
> **AWCMS PORT DELTA (different from the mini specification in the skill body — MUST be observed):**
>
> - Public routes are **path-based `/blog/{tenantCode}`** (ADR-0009): index, detail,
>   category/tag archives, search, RSS `feed.xml`, `sitemap-blog.xml`. The
>   **host-resolved `/news/**` route family was NOT ported** — at port time the
>   blocker was that `tenant_domain` did not exist yet; that module now DOES exist
>   (#219) but the `/news/**` routes are **still not adopted**, so do not
>   build/refer to them as existing.
> - **`blog_content` is a CROSS-MODULE descriptor CONTRIBUTOR.** `module.ts`
>   provides the `seo_facts` capability (consumed by `seo_distribution`) and
>   declares `searchSources: [{ key: "blog_content.post", ... }]` which
>   `site_search` reads via `listModules()`. Both are **pure data** —
>   declarative table/column names + publication filters, with no cross imports. When
>   changing post table/column names, publication status, or the public URL
>   template, those descriptors **must be updated too** or the
>   `site-search:sources:check` gate goes red and the search index starts lying.
>   Do not write to `awcms_site_search_*` tables from here.
> - The **`news_media` capability is RETIRED**. Its replacement is `media_library`
>   (ADR-0036), with the REAL adapter `media-library/application/media-library-port-adapter.ts`
>   injected at every composition root — not a no-op. The old key
>   `news_media` is deliberately NOT reused so that consumers still asking for it
>   fail loudly instead of being silently bound to a different port.
>   The `social_publishing` hook is **still a no-op** (its module does not exist here — a BUILD candidate via ADR admission, ADR-0055 §1).
> - **The blog admin UI ALREADY EXISTS** (ADR-0051 admin screen consolidation). Four screens:
>   `src/pages/admin/blog.astro` (post lifecycle), `blog-pages.astro`
>   (ADR-0057, all eight `pages.*` permissions), `blog-taxonomy.astro`, and
>   `blog-presentation.astro` (templates/menus/widgets/theme). An older entry here
>   read "NOT ported"; that has long been wrong. There is no separate
>   `internal-tag-links` screen — its configuration rides along with the presentation screen.
> - The `video_news` content block (YouTube iframe) renders but is blocked by CSP
>   until a deployment adds its own `frame-src` (the "zero third-party
>   CSP origin" guarantee is not relaxed) — see the header of
>   `_shared/rendering/video-news-block-renderer.ts`.
> - The `sql/NNN` numbers in the skill body = awcms-mini numbering; in awcms the real
>   ones are `sql/035`–`sql/040`.

`blog_content` (`src/modules/blog-content`) is **the first domain module
registered directly in this base repo** (epic #536, not in a separate
derived application — see `AGENTS.md` §Module map and
`docs/adr/0009-public-tenant-scoped-routes.md`). Epic #536 (Issues #537-#543)
is **finished** — the module is registered `status: "active"` (no longer
`experimental`). This skill summarises the decisions already made so that
follow-up issues (outside this epic) **must** reuse them rather than
redesign them — read `src/modules/blog-content/README.md` for the full
detail on every table and endpoint.

## When to use this skill vs the generic skills

This skill complements (does not replace) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-testing`, etc. — those remain the ones used
for **how to build** an endpoint/migration/test. This skill supplies the
**blog_content-specific domain** context that is not obvious from merely
reading a single migration file.

## Status per issue (do not rebuild what already exists)

| Issue | Scope                                                       | Status                                                                       |
| ----- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| #537  | Schema, domain validation, permission seed                  | **Done** (migrations 026/027)                                                |
| #538  | Admin API + lifecycle actions (posts)                       | **Done** (`/api/v1/blog/posts`, see README)                                  |
| #539  | Pages, taxonomy, post-term relation, search                 | **Done** (`/api/v1/blog/pages`, `/terms`, `/search`)                         |
| #540  | Public routes, RSS, sitemap, SEO                            | **Done** (`/blog/{tenantCode}/...`, see README)                              |
| #541  | Revisions + scheduled publishing + AsyncAPI                 | **Done** (`/posts/{id}/revisions`, `blog:publish:scheduled`, see README)     |
| #542  | Template/menu/widget/media/multilingual/ads                 | **Done** (`/templates`, `/menus`, `/widgets`, `/ads`, `/theme`, see README)  |
| #543  | Admin UI, blog settings API, final documentation, hardening | **Done** (14 screens `/admin/blog/...`, `/api/v1/blog/settings`, see README) |

**Outside epic #536 — BUT DROPPED during the port to awcms (see PORT DELTA
above):** in awcms-mini `blog_content` also has a second public route family `/news/...`
(Issue #560, epic #555 "online public tenant routing"). Those `/news/**` routes were
**NOT ported to awcms** because they need the `tenant_domain` module (tenant resolution
via custom domain) which does not exist here — do not build/refer to `/news/**`
as existing. The public routes that REALLY exist in awcms are only `/blog/{tenantCode}`
(ADR-0009, epic #536). The parts of this skill further down that discuss `/news`/cross-mode
resolution are the awcms-mini specification, not awcms code.

**Also outside epic #536**: Issue #636 (epic `news_portal` #631-#642/#649)
adds CONDITIONAL validation — active only when full-online R2-only
mode is active FOR THE CALLING TENANT (`isNewsPortalFullOnlineR2ModeActiveForTenant`,
`application/news-media-reference-gate.ts` — the file was renamed during the
ADR-0044 merge; `news-portal-r2-mode-gate.ts` does not exist) — which requires
`featuredMediaId` and image-typed gallery items to reference a
`verified`/`attached` row in the `news_portal` media registry (#633), no longer
a free UUID/URL WITHOUT verification. **Rule #18 below ("there is no base
media library") REMAINS TRUE for non-R2-only mode** (the majority of
deployments today) — only R2-only mode adds a verification layer
on top of it, it does not replace that rule. The full technical detail
(new files, og:image, render-time resolution) is in
`.claude/skills/awcms-news-portal/SKILL.md` §636 — read it THERE
before touching `featuredMediaId`/gallery again, do not re-derive it
here.

**Also outside epic #536**: Issue #640 (content quality checklist preview)
adds `GET /api/v1/blog/posts/{id}/quality-checklist` and
`GET /api/v1/blog/pages/{id}/quality-checklist` — read-only endpoints that
compute content quality signals (e.g. title/excerpt length, SEO
completeness) from data that already exists, write nothing, and add no new
permission beyond the existing `<posts|pages>.read`.

**Also outside epic #536**: Issue #641 (automatic internal tag linking)
adds a render-time transform that links matching tag names in the body of a
published post to that tag's archive URL — see `domain/internal-tag-linking*.ts`,
`application/internal-tag-link-*.ts`, migration `sql/052` (table
`awcms_blog_internal_tag_link_settings`, per-tenant policy), gated by the
deployment-wide config `BLOG_AUTO_INTERNAL_TAG_LINKS_*` + a per-post column
`auto_internal_tag_links_disabled` (opt-out). New endpoints:
`GET/PATCH /api/v1/blog/internal-tag-links/settings` (tenant policy),
`GET /api/v1/blog/posts/{id}/internal-links/preview` (read-only preview,
permission `preview` — not `configure`, see the §Rule rules in the
`awcms-abac-guard` skill for why `preview` is separated from `configure`).
Mini admin UI: `awcms-mini:src/pages/admin/blog/internal-tag-links.astro` (the 15th screen THERE). In this repo its configuration rides along with `src/pages/admin/blog-presentation.astro`.

## What already exists — reuse it, do not re-derive

- **Tables** (migration `026_awcms_blog_content_schema.sql`): `awcms_blog_posts`, `_pages`, `_terms`, `_post_terms`, `_revisions` (append-only), `_redirects`, `_settings` (1 row/tenant, `tenant_id` = PK). All `ENABLE`+`FORCE ROW LEVEL SECURITY`, without explicit `GRANT` (migration 013's `ALTER DEFAULT PRIVILEGES` already covers it). Migration `028` (Issue #539) changes `search_vector` in posts/pages to `GENERATED ALWAYS ... STORED` (weighted title/excerpt/content_text, config `simple`) — PostgreSQL itself keeps it in sync, there is no trigger/application code. Migration `029` (Issue #542) adds `awcms_blog_templates`, `_menus`+`_menu_items`, `_widgets`, `_ads`+`_ad_placements`, `_theme_settings` (all FORCE RLS too) plus a `translation_group_id` column on posts/pages — see README §Presentation extensions for the detail on each table.
- **Permission seed** (migrations `027`, `030`): 26 permissions `blog_content.<posts|pages|taxonomies|revisions|settings|seo|search>.<action>` from migration 027, plus 10 permissions `<templates|menus|widgets|ads|theme>.<read|configure>` from migration 030 (Issue #542) — if a new endpoint needs a permission outside this list, that means its scope is wrong or it needs a new permission migration, not an improvised new module_key/activity_code.
- **Domain validation** (`src/modules/blog-content/domain/`): `content-validation.ts` (core fields + rejection of unsafe HTML via `containsUnsafeHtml`, exported since #542 + the shared `validateDeleteReasonInput`, reused by create/update/delete for post/page/term/widget), `post-status.ts` (`isValidStatusTransition`, `canRestorePost`, `canPurgePost`), `page-type.ts` (`isPageType`), `slug-policy.ts`, `seo-validation.ts` (`isAbsoluteHttpUrl`, reused for menu/ad URLs), `taxonomy-policy.ts` (`validateTermParent`), `content-access-policy.ts` (`evaluateContentUpdateAccess` — generic ABAC ownership logic, see below), `post-access-policy.ts`/`page-access-policy.ts` (thin resource-specific wrappers), `blog-post-validation.ts`, `blog-page-validation.ts`, `blog-term-validation.ts`, `revision-policy.ts` (`isSignificantContentChange`), `template-policy.ts`/`menu-policy.ts`/`widget-policy.ts`/`ad-policy.ts`/`theme-policy.ts` (Issue #542). **Call these functions**, do not rewrite the same regex/rules in an endpoint handler.
- **Application** (`src/modules/blog-content/application/`): `blog-post-directory.ts` (post CRUD + lifecycle, plus consumption of `syncPostTermAssignments`/`fetchPostTermIds`/`countExistingTerms` from `blog-taxonomy-directory.ts` for `termIds`), `blog-page-directory.ts` (page CRUD only — **without** lifecycle transition/restore/purge), `blog-taxonomy-directory.ts` (term CRUD + post-term relations), `blog-search.ts` (`searchBlogContentAdmin`, `searchPublicBlogContent`), `blog-revision-directory.ts` (`createBlogRevision`/`listBlogRevisions`/`fetchBlogRevisionById`, INSERT-only), `blog-scheduled-publish.ts` (`publishDueScheduledPosts`, one set-based `UPDATE` per tenant), `template-directory.ts`/`menu-directory.ts`/`widget-directory.ts`/`ads-directory.ts`/`theme-settings-directory.ts` (Issue #542, one CRUD directory per resource, same pattern as `blog-taxonomy-directory.ts`), `localized-content-directory.ts` (Issue #542 — `setPostTranslationGroup`/`fetchPostTranslations`, a single-column `UPDATE`/`SELECT` that **deliberately stands alone**, never touching `blog-post-directory.ts`'s big query — see §Rule #13).
- **Admin posts API** (`src/pages/api/v1/blog/posts/`): CRUD + 5 lifecycle actions + `termIds`/`translationGroupId` in the create/update body + a revisions sub-resource. **Admin pages API** (`src/pages/api/v1/blog/pages/`): CRUD only, no lifecycle actions; a significant PATCH still triggers `createBlogRevision` (`resource_type='page'`) even though there is no read/restore route for page revisions. **Admin terms API** (`src/pages/api/v1/blog/terms/`): list/create/update/delete, without `GET /{id}`. **Search API** (`src/pages/api/v1/blog/search/`): admin only, keyset-paginated. Read `src/modules/blog-content/README.md` for the full guard/idempotency/audit pattern of each endpoint (including the literal audit action names `blog.<resource>.<verb>`).
- **Revisions API** (`src/pages/api/v1/blog/posts/[id]/revisions/`, Issue #541): `GET` list, `GET /{revisionId}` detail (guard `blog_content.revisions.read`, without an ownership override), `POST /{revisionId}/restore` (explicit guard `blog_content.revisions.restore`, Idempotency-Key mandatory, append-only — restore = write the content back into the post + insert a new revision, never `UPDATE`/`DELETE` any revision row).
- **Scheduled publishing** (`scripts/blog-scheduled-publish.ts`, Issue #541): `bun run blog:publish:scheduled`, an internal worker (not an HTTP endpoint) scheduled by cron/systemd timer, one idempotent `UPDATE` per tenant for posts with `status='scheduled' AND scheduled_at<=now()`.
- **Public routes** (`src/pages/blog/[tenantCode]/`, Issue #540): index, post detail, category/tag archives, search, `feed.xml`, `sitemap-blog.xml` — 7 `APIRoute`s (`.ts`, not `.astro`, see §Rule #7). All anonymous, tenant resolution via `src/lib/tenant/public-tenant-resolver.ts`'s `resolvePublicTenantByCode` (ADR-0009). The public queries live in `public-blog-directory.ts` (**not** the admin-only `blog-post-directory.ts`), safe rendering in `content-block-rendering.ts`/`seo-rendering.ts`/`public-page-rendering.ts`. **Posts only**, there is no public route for pages, widgets, or ads (the helpers `listActiveAdsForPlacement`/`renderAdHtml`/`listWidgets({activeOnly:true})` exist and are tested, but no route wires them up). The second family that Issue #560 (epic #555) once added **NO LONGER EXISTS in this repo**: ADR-0071 deleted its entire route directory together with its gate and its switch, and `/news/**` is now `ahliweb/awcms-astro` vocabulary. The **posts only** limit is stated because it holds for the one remaining family here, `/blog/{tenantCode}`. The only difference between `/news` and `/blog/{tenantCode}`: tenant resolution via `resolvePublicTenantFromRequest` (Issue #559, `src/lib/tenant/public-host-tenant-resolver.ts`) through the `withNewsTenant` helper (`application/public-news-tenant-resolution.ts`), instead of `resolvePublicTenantByCode` from a path segment — and `/news` adds an explicit module-disabled check that `/blog/{tenantCode}` **still** lacks (a pre-existing gap, documented, deliberately not retrofitted in Issue #560 — see the `awcms-tenant-domain-routing` skill).
- **Presentation API** (Issue #542): `src/pages/api/v1/blog/{templates,menus,widgets,ads}/` (CRUD, one `configure` permission gating create/update/delete, same pattern as taxonomies) and `src/pages/api/v1/blog/theme/` (`GET`/`PATCH`, one row per tenant, falling back to `awcms_tenants.default_theme`). Menu items and ad placements are full-replace via a sub-array in the payload (`items`/`placements`), just like `termIds`.
- **Gallery block** (Issue #542, `content-block-rendering.ts`): a new block type `{ type: "gallery", items: GalleryItem[] }` (image/video, whitelist rendering, `<img>`/`<video controls>` only) — **not** a separate media table/endpoint, because there is no real base media library to integrate with (`featuredMediaId` is just a loose UUID without an FK).
- **Settings API** (Issue #543, `src/pages/api/v1/blog/settings/`): `GET`/`PATCH`, one row per tenant (`awcms_blog_settings`, migration 026 — the typed columns `default_locale`/`default_visibility`/`posts_per_page`/`seo_default_title`/`seo_default_description` are written/read through the route for the first time in #543; `blogTitle`/`blogDescription`/`rssEnabled`/`sitemapEnabled` live in the catch-all jsonb `settings` column). Directory `blog-settings-directory.ts` (`fetchBlogSettings`/`upsertBlogSettings`, merge-patch upsert), policy `blog-settings-policy.ts` (`validateUpdateBlogSettingsInput`). Guard `blog_content.settings.{read,configure}`, audit `blog.settings.updated`, registered in OpenAPI (`paths./api/v1/blog/settings`) and closing the AsyncAPI gap `settings.updated` (see below). `feed.xml.ts`/`sitemap-blog.xml.ts` (#540) now read `rssEnabled`/`sitemapEnabled` from here — a tenant that turns them off gets a `404` identical to an unknown tenant (same as rule #5, no distinguishing signal).
- **Mini admin UI** (Issue #543, `awcms-mini:src/pages/admin/blog/`): 15 Astro screens (`+ vanilla JS`, no new framework), reusing the existing `AdminLayout` + design tokens, with the SSR-read-through-the-application-layer + mutate-through-fetch-to-a-guarded-endpoint pattern **identical** to `src/pages/admin/modules.astro` (the primary reference) — dashboard (`index.astro`), posts (`posts/index.astro`, `/new`, `/[id]` — including lifecycle actions + revision history), pages (`pages/index.astro`, `/new`, `/[id]` — **without** lifecycle actions, per README §Not yet available), `categories.astro`, `tags.astro` (a structural tag has no `parentId` field at all, not merely hidden), `settings.astro`, the optional screens `templates.astro`/`widgets.astro`/`menus.astro`/`ads.astro` (included because #542 was already merged), and `internal-tag-links.astro` (Issue #641, mini's 15th screen — internal tag linking policy configuration). Every high-risk action (publish/schedule/archive/restore/purge/revision-restore/delete) must have `window.confirm` + a new `Idempotency-Key` per attempt (`newIdempotencyKey()` in `src/lib/ui/admin-form-client.ts`) + the submit button locked while in flight. `module.ts`'s `navigation` array (one entry `/admin/blog`, guard `blog_content.posts.read`) and `permissions` array (39 entries, mirroring migrations 027+030+052) were only declared in #543 — before that they were empty even though the permissions had long existed in the DB.
- **AsyncAPI domain events** (`asyncapi/awcms-domain-events.asyncapi.yaml`): 27 `awcms.blog-content.*` channels (13 from #541 + 13 from #542 + 1 from Issue #641 — `internal-tag-linking-policy.updated`), also registered in `module.ts`'s `events.publishes`. **Contract documentation only** — the real producer is the structured JSON logger (`log()`), not an event bus, the same convention since Issue 0.3 (see the `email.*` pattern as precedent). Since #543 **every channel has a real producer** — `settings.updated` (previously reserved-without-producer) is now logged from `PATCH /api/v1/blog/settings`.

## Cross-issue rules that must be followed

1. **Slug uniqueness**: posts/pages are unique per `(tenant_id, locale, slug)` while `deleted_at IS NULL`; terms are unique per `(tenant_id, taxonomy_type, slug)`. Do not add a new looser/stricter unique constraint without a new migration + a README update.
2. **A tag must not have a `parent_id`** — already enforced in a DB constraint (`awcms_blog_terms_tag_no_parent_check`) and in the application (`validateTermParent`). Term create/update endpoints must call `validateTermParent` before insert/update — for update, merge the submitted fields with the existing row first (see the `blog-term-validation.ts` docblock), do not check the body in isolation.
3. **Revisions are append-only** — never `UPDATE`/`DELETE` a row in `awcms_blog_revisions`. "Restore a revision" (Issue #541, `POST /api/v1/blog/posts/{id}/revisions/{revisionId}/restore`) = write the old revision's content back into the live post row (`updateBlogPost`), then insert a new revision recording the post-restore state (`changeNote: "Restored from revision {n}."`) — two steps, both through the existing `blog-revision-directory.ts`/`blog-post-directory.ts`, do not write raw `UPDATE ... SET` SQL against the revision table. A new revision is created only if the `PATCH` includes `title`/`contentJson`/`contentText` (`domain/revision-policy.ts`'s `isSignificantContentChange`) — cosmetic fields (`seoTitle`, `slug`, `visibility`, etc.) do not trigger a revision. This applies to posts AND pages (it is called from both `PATCH` handlers), but revision read/restore routes exist only for posts.
4. **`search_vector` is already `GENERATED ALWAYS ... STORED`** since migration `028` (Issue #539) — never write to this column manually (Postgres rejects it), and do not add a trigger/`recomputeSearchVector` of any kind, that is already handled at the column level.
5. **Tenant-scoped public routes must follow ADR-0009**: tenant resolution via the `tenant_code` path segment (`/blog/{tenantCode}/...`) using `resolvePublicTenantByCode` (`src/lib/tenant/public-tenant-resolver.ts`), **not** a subdomain/header — this base is LAN-first and must not assume public DNS/TLS exists. `tenantCode` not found OR the tenant not `active` → an identical `404` (do not leak the existence of a tenant). Use `searchPublicBlogContent` (`blog-search.ts`, Issue #539) directly for public search, do not rewrite its visibility predicate.
6. **There are two different public visibility predicates** (Issue #540, `public-blog-directory.ts`): LISTING (index/category/tag/search/feed/sitemap) uses strict `visibility = 'public'`; DETAIL (`fetchPublicBlogPostBySlug`) uses `visibility IN ('public', 'unlisted')` — unlisted is reachable by direct link but never appears in any listing, private is never public at all in either context. Do not conflate the two.
7. **Public routes = `APIRoute` `.ts`, not `.astro`** — so they are testable through `tests/integration/harness.ts`'s `invoke()`/`invokeRaw()` (the only test pattern that exists in this repo). Use `invokeRaw()` (not `invoke()`) for handlers that return HTML/XML rather than JSON — `invoke()` always `JSON.parse`s and will throw on a non-JSON body.
8. **`content_json` now has a concrete schema** (Issue #540, previously "opaque"): `{ blocks: ContentBlock[] }`, 4 types (`paragraph`/`heading`/`list`/`quote`). Rendering ALWAYS goes through `content-block-rendering.ts`'s `renderContentJsonToHtml` (whitelist, escape all text) — never `set:html`/render raw `content_json`/`content_text` in any route.
9. **Idempotency**: posts have the scopes `blog_post_publish`/`_schedule`/`_archive`/`_restore`/`_purge` (Issue #538); revision-restore has the scope `blog_revision_restore` (Issue #541) — the same `blog_<resource>_<action>` pattern. Pages/terms CRUD (#539), the scheduled-publishing job (#541 — idempotent by construction through its `WHERE` clause, not through an `Idempotency-Key`), and all public routes (#540, GET-only, mutating nothing) are **not** idempotency-gated — do not add it without a new reason.
10. **Audit**: `action` uses the literal string `blog.<resource>.<verb>` (not the short generic verbs of other modules) — `blog.post.*` (#538), `blog.page.*`/`blog.term.*` (#539), `blog.post.revision_restored`/`blog.post.scheduled_publish_executed`/`blog.post.scheduled_publish_skipped` (#541, also reusing `blog.post.published` for publishing via the scheduled job) are already consistent. Public routes (#540) write no audit event (read-only, anonymous, no `actorTenantUserId`); the scheduled-publishing job also does not set `actorTenantUserId` (a system/background actor, not a user).
11. **Generic ABAC ownership override**: `content-access-policy.ts`'s `evaluateContentUpdateAccess` is used by posts AND pages (an author may edit their own not-yet-published content, without the `update` permission). If you add a new resource with a similar pattern, call this generic function with a new guard — do not copy-paste the `evaluatePostUpdateAccess`/`evaluatePageUpdateAccess` logic again. **Revision restore does NOT have this override** — `blog_content.revisions.restore` is required explicitly even when the caller is the post's own author (a deliberate difference from `update`).
12. **Public error handling must not leak a stack trace**: every public route is wrapped in `try/catch`, the real error is `log()`ged, and the response to the client is always a generic string from `src/lib/html/error-responses.ts`. Reuse those functions for new public routes, do not invent ad-hoc error messages.
13. **Multilingual** (Issue #542, final decision — no longer open): the `locale` column on posts/pages is **already sufficient** for "locale-based storage/retrieval" + tenant+locale-aware slug uniqueness (since #537) — do not redesign it into per-locale JSONB. What #542 added is only `translation_group_id` (nullable, no FK/trigger) to link several locale-variant posts, through the standalone function `localized-content-directory.ts`'s `setPostTranslationGroup` — **do not** add this column to the `INSERT`/`UPDATE`/`RETURNING` in `blog-post-directory.ts` (that file is already touched in 7+ different places; one narrow separate function is far lower risk).
14. **AsyncAPI domain events**: if you add a new lifecycle action to `blog_content`, add a new channel+operation in `asyncapi/awcms-domain-events.asyncapi.yaml` **and** an entry in `module.ts`'s `events.publishes` (gated by `tests/domain-event-registry-parity.test.ts`, NOT by `api:spec:check` — this skill used to name a function `checkModuleEventChannels` that never existed in `scripts/api-spec-check.ts`; that script only READS the AsyncAPI file to make sure it parses. The real parity is two-way between `DOMAIN_EVENT_TYPE_REGISTRY`, the AsyncAPI channels, and each module's `events.publishes`: a registry entry without a channel, or without a module claiming to publish it, turns that test red). The event producer = add `log("info", "blog-content.<aggregate>.<verb>", {...})` at the same point in the code where `recordAuditEvent` is called — **do not** build a new pub/sub dispatcher, this contract has been documentation-only since Issue 0.3 (see the `email.*` precedent in the `email` module README).
15. **Admin master/config data (templates/menus/widgets/ads/theme) uses a single `configure` permission** for create+update+delete, not per-action permissions like posts — the same pattern as `taxonomies.configure`. Do not add separate `templates.create`/`templates.delete` without a strong new reason.
16. **`/news` (Issue #560, epic #555) reuses the `/blog/{tenantCode}` public routes as they are** — do not rewrite the queries/rendering/visibility predicates for `/news`; the only new code allowed is the tenant resolution layer (`withNewsTenant`, `application/public-news-tenant-resolution.ts`) and basePath link building (`renderPostSummaryListHtmlAtBasePath` in `public-page-rendering.ts`, with `/blog/{tenantCode}`'s old wrapper staying byte-for-byte the same). Any change to the existing `/blog/{tenantCode}` in support of `/news` must be zero-behaviour-change (pure refactor/extraction only) — see the `awcms-tenant-domain-routing` skill's §Public `/news` routes for the full detail, including the module-disabled check that `/news` has and `/blog/{tenantCode}` does not.
17. **A full-replace sub-resource needs a client-supplied `id` when there is a hierarchy/self-reference within one payload** (`menu items`' `parentItemId`, see the `menu-directory.ts` `syncMenuItems` docblock) — because `DELETE`-then-`INSERT` discards the old ids before the new rows are written, a reference to a sibling in the same payload can ONLY be resolved if the client supplies the ids itself (not the DB's `gen_random_uuid()`). A sub-resource _without_ a hierarchy (ad placements) may keep using ordinary DB-generated ids.
18. **There is no base media library** — do not build new media tables/endpoints for gallery/attachment needs. Add a new block type to `content-block-rendering.ts`'s whitelist (the `gallery` pattern, Issue #542) or store it as a loose UUID/URL (the `featuredMediaId` pattern), depending on the need — do not re-derive a "media library" concept from scratch. **Since Issue #636** (see the "Outside epic #536" note above): when full-online R2-only mode is active for a tenant, that loose UUID/URL MUST be validated to point at a safe `news_portal` registry row (#633) — still not a new media library inside `blog_content` itself, only validation of a reference to another module's registry.
19. **Theme mode is an override, not a new engine** — `awcms_tenants.default_theme` (migration 002) remains the single source of the default. Any module's theme table/endpoint (blog or a future module) must fall back to it when there is no override, exactly like `theme-settings-directory.ts`'s `fetchBlogThemeSettings`.
20. **HISTORICAL since ADR-0044/#300** — `news_portal` is now ONE module with this one, so there is no longer any cross-module collaboration to port between them; its porting pattern still applies to `media_library`. (Originally: collaboration with `news_portal` through a capability port, NOT a direct import — Issue #681, epic #679, see ADR-0011 and the `awcms-news-portal` skill §681 for the full detail). `blog_content`'s `application`/`domain` files are FORBIDDEN from `import ... from` the `application`/`domain` tree of `news_portal` — any capability needed from `news_portal` (e.g. R2 media validation/resolution) is received through a port parameter (`_shared/ports/news-media-port.ts`'s `NewsMediaPort`), injected by the caller (the route handler). Guarded automatically by `tests/module-boundary.test.ts` — a PR that adds a new cross-module import will fail that test.
21. **Every handler that CHANGES blog content must enqueue an edge cache purge** (ADR-0042). Call `enqueueModuleContentPurge(tx, tenantId, "blog_content", "<reason>")` from `src/lib/edge-cache/content-purge.ts` **inside the same transaction** as the change — that is the core of the outbox pattern (ADR-0006): a rolled-back publish leaves no stray purge, and a committed publish cannot lose its purge. Already wired into `posts/index.ts` (create), `posts/[id].ts` (update + delete), and `blog-scheduled-publish.ts`. Its scope is the **module, not the resource** — cached responses are tagged with the tenant/surface/module key only, so a resource-scoped ban would match no object at all while the queue reports success. It is a no-op when `EDGE_CACHE_MODE=off`, so it is safe to call unconditionally. `tests/edge-cache-content-purge.test.ts` locks the call counts **at the source level** for those three files: adding a fourth mutation handler without an enqueue will not turn any handler test red — but it will serve stale pages until the TTL expires. Update that test list together with the new handler.

## Not there yet — do not assume it is done

Epic #536 (Issues #537-#543) is entirely finished, but a few things
remain **deliberately outside this epic's scope** — do not assume they are
done just because the epic is "finished":

- Public routes for pages (only posts have public routes, #540), and revision read/restore routes for pages (only posts have revision routes, #541 — a page still accumulates revisions through `PATCH`, it just has no read/restore endpoint).
- Page lifecycle-action endpoints (`publish`/`schedule`/`archive`/`restore`/`purge` for pages) — their permissions have been seeded since #537, but the endpoints were never built in any issue (#538-#543). Do not assume that is done just because posts have a full lifecycle and the post editor admin UI has a lifecycle panel.
- Locale-aware negotiation for public visitors (e.g. `Accept-Language`) — public routes do not filter by the visitor's language preference.
- An optimistic-concurrency check that reads the `version` column.
- Public routes for widget/ads rendering (a real header/sidebar/footer on public pages) — the helpers (`listActiveAdsForPlacement`/`renderAdHtml`/`listWidgets({activeOnly:true})`) exist and have been tested since #542, and their admin CRUD partly exists — widgets at `/admin/blog-presentation?section=widgets` (together with `templates`/`menus`/`theme`), whereas **ads have no screen at all**. This entry once read <!-- historis:mulai -->"its admin CRUD (`/admin/blog/widgets`, `/admin/blog/ads`) has existed since #543"<!-- historis:selesai -->; the directory `src/pages/admin/blog/` never existed in this repo. What is still missing stays the same: zero public routes wiring those helpers into blog pages.
- A dedicated admin screen for media/gallery — there is no base media library (see rule #18), so gallery blocks are still edited through the `content_json` textarea in the post/page editor, not a visual picker.
- A visual/WYSIWYG editor for `content_json`, and a visual editor (tree/drag-drop) for menu items/ad placements — the #543 admin UI uses labelled JSON textareas for all of them, a deliberate scope decision (see README §Known limitations).

`src/modules/blog-content/README.md` §Not yet available holds the complete list with per-item detail.
