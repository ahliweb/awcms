# Blog Content

Implementasi Issue #537, #538, #539, #540, #541, #542, dan #543 (epic #536 — `blog_content`, `docs/adr/0009-public-tenant-scoped-routes.md`). **Modul domain pertama yang didaftarkan langsung di repo base ini** — sebelumnya `AGENTS.md` §Peta modul hanya mendaftarkan modul base generik; lihat catatan di sana untuk konteks. Epic ini **selesai** — semua acceptance criteria issue #537-#543 terpenuhi; `module.ts`'s `status` sudah `active` (bukan lagi `experimental`).

## Scope per issue

Issue #537: module descriptor, domain validation, application placeholder read-only, dan schema database (migration 026/027) — lihat §Tabel dan §Permission seed.

Issue #538: API admin CRUD + lifecycle untuk blog post di `/api/v1/blog/posts` (lihat §Admin API — Blog Posts).

Issue #539: API admin CRUD untuk halaman statis (`/api/v1/blog/pages`, lihat §Admin API — Blog Pages), kategori/tag (`/api/v1/blog/terms`, lihat §Admin API — Blog Taxonomies), post-term relation assignment (lewat `termIds` di payload post, lihat §Post-term relation handling), dan PostgreSQL full-text search (`/api/v1/blog/search` admin + helper public-safe, lihat §Search). Migration `028` mengubah `search_vector` menjadi `GENERATED ALWAYS ... STORED`.

Issue #540: rute publik anonim (tanpa sesi) di bawah `/blog/{tenantCode}/...` sesuai ADR-0009 — index, detail post, arsip kategori/tag, search, RSS feed, dan sitemap. Lihat §Public routes.

Issue #541: revision history append-only untuk post/page, restore revisi (permission eksplisit + Idempotency-Key), scheduled-publishing job (`bun run blog:publish:scheduled`), dan kontrak AsyncAPI domain event penuh untuk lifecycle modul ini. Lihat §Revisions dan §Scheduled publishing.

Issue #542: presentation/monetization extensions — template, menu hierarkis, widget, iklan (ads) dengan placement/scheduling, override tema per-tenant, `translation_group_id` untuk multilingual, dan block `gallery` baru di `content_json` untuk gambar/video publik. Migration `029`/`030`. Lihat §Presentation extensions.

Issue #543 (final hardening): admin UI penuh di bawah `/admin/blog` (dashboard, posts, pages, categories, tags, settings, dan optional advanced screens templates/widgets/menus/ads — semuanya menggunakan `AdminLayout`/design token yang sudah ada, Astro + vanilla JS saja, tanpa framework baru), endpoint `blog_content.settings.*` (`/api/v1/blog/settings`, akhirnya mengaktifkan `awcms_blog_settings` yang sejak migration 026 sudah ada tapi belum punya route), `module.ts`'s `permissions`/`navigation` array (sebelumnya kosong meski 36 permission-nya sudah ada di DB sejak migration 027/030), dan dokumentasi/testing/hardening akhir. Lihat §Admin UI dan §Settings API.

Issue #560 (epic #555, bukan #536): rute publik kedua `/news/...`, tenant-code-free counterpart `/blog/{tenantCode}`, resolusi tenant lewat `resolvePublicTenantFromRequest` (Issue #559) bukan segmen path. Lihat §Public routes `/news`.

Issue #564 (epic #555, bukan #536): `settings.defaults` baru di descriptor (`publicRouteMode`, `publicBasePath`, `legacyTenantRouteEnabled`, `publicLabel`) lewat Module Management's generic tenant-settings framework (Issue #516/epic #510) — **bukan** `rssEnabled`/`sitemapEnabled`, yang tetap di `awcms_blog_settings` yang sudah ada. `/news` menghormati `publicRouteMode`/`publicBasePath`/`publicLabel`; `/blog/{tenantCode}` (ketujuh rutenya) menghormati `legacyTenantRouteEnabled`. Lihat §Public route settings.

## Tabel (migration `026_awcms_blog_content_schema.sql`)

Tujuh tabel persis sesuai doc issue #537 §Database Tables, semuanya tenant-scoped (`ENABLE` + `FORCE ROW LEVEL SECURITY`, satu policy `tenant_isolation` per tabel):

1. **`awcms_blog_posts`** — `status`: `draft → review → scheduled → published → archived` (`domain/post-status.ts` `isValidStatusTransition`), `visibility`: `public | private | unlisted`. Slug unik per `(tenant_id, locale)` selama `deleted_at IS NULL` (partial unique index). `search_vector tsvector` — sejak migration `028` (Issue #539) kolom ini `GENERATED ALWAYS ... STORED` (weighted `title` 'A' / `excerpt` 'B' / `content_text` 'C', text search config `simple`), PostgreSQL sendiri yang menjaganya tetap sinkron; index GIN tetap ada.
2. **`awcms_blog_pages`** — struktur core sama seperti posts (termasuk `search_vector` generated STORED yang sama sejak migration `028`), plus `page_type` (`standard | landing | legal | system`), `parent_page_id` (self-FK), `menu_order`.
3. **`awcms_blog_terms`** — kategori (`taxonomy_type = 'category'`, boleh `parent_id`) dan tag (`taxonomy_type = 'tag'`, `CHECK` menolak `parent_id` — lihat juga `domain/taxonomy-policy.ts` untuk cek pre-insert di level aplikasi). Slug unik per `(tenant_id, taxonomy_type)`.
4. **`awcms_blog_post_terms`** — relasi many-to-many post↔term, tetap membawa `tenant_id` sendiri (bukan hanya lewat FK) supaya RLS bisa langsung mengisolasi baris join ini, konvensi yang sama seperti tabel relasi lain di base ini.
5. **`awcms_blog_revisions`** — **append-only**, tidak pernah di-`UPDATE` aplikasi (pola sama seperti `awcms_workflow_decisions`/`awcms_audit_events`). "Restore revisi" berarti membuat revisi baru berisi konten lama, bukan menimpa baris manapun — jalur kode restore-nya diimplementasikan Issue #541, lihat §Revisions. Tidak ada kolom `slug`.
6. **`awcms_blog_redirects`** — soft-deletable (bukan append-only), unik per `(tenant_id, from_path)` selama aktif.
7. **`awcms_blog_settings`** — satu baris per tenant, `tenant_id` sendiri jadi primary key (pola sama seperti `awcms_tenant_settings`, migration 002), bukan soft-deletable (dikonfigurasi, bukan dihapus).

Tidak ada `GRANT` eksplisit ke `awcms_app` di migration 026 — migration 013 sudah memasang `ALTER DEFAULT PRIVILEGES` yang otomatis meng-grant tabel baru apa pun yang dibuat role pemilik (dipakai ulang oleh migration 025 untuk alasan yang sama).

## Tabel presentasi (migration `029_awcms_blog_content_presentation_schema.sql`, Issue #542)

Delapan penambahan skema, semua tenant-scoped RLS FORCE seperti migration 026, per doc issue #542 §Important Scope Control (tidak membangun ulang base media library/tenant/RBAC/audit/theme engine):

1. **`awcms_blog_templates`** — `layout_json` **whitelisted**, bukan JSON bebas (`{ columns: 1|2|3, sidebarPosition: 'left'|'right'|'none' }`, divalidasi `domain/template-policy.ts`). Unik per `(tenant_id, key)` selama `deleted_at IS NULL`.
2. **`awcms_blog_menus`** + **`awcms_blog_menu_items`** — hierarkis, **satu level** nesting saja (sama seperti batas parent kategori/tag). `menu_items.link_type` (`post|page|url`) menggerbangi field mana yang berarti (`target_id` untuk post/page, `url` untuk url — divalidasi absolute http(s), `isAbsoluteHttpUrl`).
3. **`awcms_blog_widgets`** — `position` (`header|sidebar|footer|content_before|content_after`), `body_text` plain text (di-escape saat render, tidak ada field raw-HTML).
4. **`awcms_blog_ads`** + **`awcms_blog_ad_placements`** — `image_url`/`link_url` wajib absolute http(s). `ad_placements.placement_type` (`global|widget|post|page`) menggerbangi `target_id` (`NULL` untuk `global`, wajib UUID untuk sisanya).
5. **`awcms_blog_theme_settings`** — satu baris per tenant (`tenant_id` = PK, pola sama `awcms_blog_settings`), `mode` (`light|dark|system`) adalah **override** dari `awcms_tenants.default_theme` (migration 002) — baris tidak ada berarti "warisi default tenant", bukan `'light'` hardcoded.
6. `awcms_blog_posts`/`awcms_blog_pages` mendapat kolom baru `translation_group_id uuid` (nullable, self-grouping, tanpa trigger) — lihat §Presentation extensions §Multilingual.

Tidak ada tabel baru untuk galeri media — lihat §Presentation extensions §Media/Gallery untuk alasannya.

## Permission seed (migration `027_awcms_blog_content_permissions.sql`, `030_awcms_blog_content_presentation_permissions.sql`, `052_awcms_blog_content_internal_tag_links_permissions.sql`)

26 permission dari migration 027 persis sesuai doc issue #537 §Permission Seed (`blog_content.posts.*`, `.pages.*`, `.taxonomies.*`, `.revisions.*`, `.settings.*`, `.seo.configure`, `.search.read`). Migration 030 (Issue #542) menambah 10 permission lagi: `templates.{read,configure}`, `menus.{read,configure}`, `widgets.{read,configure}`, `ads.{read,configure}`, `theme.{read,configure}` — satu `read` + satu `configure` per resource, pola granularitas yang sama seperti `taxonomies.{read,configure}` (master/config data admin, bukan konten dengan lifecycle). Tidak ada role grant implisit — hanya assignable lewat Access & Users yang sudah ada.

Sampai Issue #543, ke-36 permission ini ada di database tapi `module.ts`'s `permissions` array kosong — Module Management's permission-sync report (`fetchModulePermissionSyncReport`, dipakai `admin/modules/[moduleKey].astro`'s panel Permissions) karena itu tidak punya apa pun untuk dibandingkan terhadap DB. Issue #543 mendeklarasikan seluruh 36 permission di `module.ts` (persis mencerminkan migration 027+030, bukan menambah permission baru) supaya sync report itu akhirnya berfungsi untuk modul ini, dan menambahkan `navigation: [{ path: "/admin/blog", ... }]` supaya `/admin/blog` muncul di sidebar admin (lihat §Admin UI).

Migration 052 (Issue #641, epic `news_portal`) menambah 3 permission lagi: `internal_links.{read,configure,preview}` — untuk fitur automatic internal tag linking (render-time transform yang me-link nama tag yang cocok di body post published ke halaman archive tag-nya, `domain/internal-tag-linking.ts`). Total permission modul ini sekarang **39** (26 + 10 + 3), seluruhnya dideklarasikan di `module.ts`'s `permissions` array. Endpoint nyata: `GET/PATCH /api/v1/blog/internal-tag-links/settings` (`internal_links.read`/`internal_links.configure`) dan `GET /api/v1/blog/posts/{id}/internal-links/preview` (`internal_links.preview`).

## Domain validation (`domain/`)

- `content-validation.ts` — `validateBlogContentCore`: field inti yang dipakai bersama post & page (`title`, `slug`, `excerpt`, `contentJson`, `contentText`, `locale`), plus field-level validator individual (`validateTitleField`, dst.) yang dipakai ulang oleh partial-update page/post, dan `validateDeleteReasonInput` (`{ reason: string }`) dipakai ulang oleh soft-delete post/page/term.
- `post-status.ts` — enum status/visibility + `isValidStatusTransition` (satu sumber kebenaran dipakai ulang oleh endpoint lifecycle Issue #538 dan scheduled-publishing Issue #541), plus `canRestorePost`/`canPurgePost`.
- `page-type.ts` (Issue #539) — enum `PageType` (`standard | landing | legal | system`) + `isPageType`.
- `slug-policy.ts` — `isValidSlug` (format) + `slugify` (derivasi dari title; pemanggil tetap wajib cek keunikan sendiri).
- `seo-validation.ts` — `validateSeoFields` (`seoTitle` ≤70 char, `metaDescription` ≤160 char, `canonicalUrl` harus URL http(s) absolut).
- `taxonomy-policy.ts` — `validateTermParent` (tag tidak boleh punya parent, term tidak boleh jadi parent dirinya sendiri) — pre-check aplikasi sebelum constraint DB `awcms_blog_terms_tag_no_parent_check` tersentuh.
- `content-access-policy.ts` (Issue #539) — `evaluateContentUpdateAccess`, generic ABAC ownership override (lihat §ABAC di bawah) diekstrak dari `post-access-policy.ts` Issue #538 supaya `page-access-policy.ts` bisa memakai ulang logic yang sama persis, bukan duplikat. `post-access-policy.ts`/`page-access-policy.ts` sekarang jadi thin wrapper yang mengunci `updateGuard` masing-masing (`blog_content.posts.update` / `.pages.update`).
- `blog-post-validation.ts` — `validateCreateBlogPostInput`/`validateUpdateBlogPostInput`/`validateScheduleBlogPostInput`/`validateSoftDeleteBlogPostInput`. Issue #539 menambah `termIds?: string[]` (validasi bentuk saja — array UUID, dedup; eksistensi per-tenant dicek di application layer).
- `blog-page-validation.ts` (Issue #539) — sama strukturnya seperti `blog-post-validation.ts`, plus `pageType`/`parentPageId` (menolak diri sendiri sebagai parent)/`menuOrder` (integer ≥0).
- `blog-term-validation.ts` (Issue #539) — `validateCreateBlogTermInput`/`validateUpdateBlogTermInput`/`validateSoftDeleteBlogTermInput`. Update tidak bisa mengecek ulang aturan tag-tanpa-parent terhadap baris yang sudah ada (validator murni, tidak query DB) — endpoint (`PATCH /api/v1/blog/terms/{id}`) yang menggabungkan field baru dengan baris existing sebelum memanggil `validateTermParent` lagi.
- `template-policy.ts` (Issue #542) — `validateTemplateLayout` (whitelist `{ columns, sidebarPosition }`), `validateCreateTemplateInput`/`validateUpdateTemplateInput` (key format = `isValidSlug`).
- `menu-policy.ts` (Issue #542) — `validateMenuItemsInput`: cross-item validation dalam satu batch (id unik, `parentItemId` wajib merujuk item lain di batch yang sama, maksimal satu level nesting) — lihat §Presentation extensions §Menus untuk kenapa `id` wajib client-supplied.
- `widget-policy.ts` (Issue #542) — `validateCreateWidgetInput`/`validateUpdateWidgetInput`, `bodyText` memakai ulang `content-validation.ts`'s `containsUnsafeHtml` (baru diekspor Issue #542, sebelumnya privat).
- `ad-policy.ts` (Issue #542) — `validateCreateAdInput`/`validateUpdateAdInput` (`imageUrl`/`linkUrl` = `isAbsoluteHttpUrl`, `endsAt > startsAt`), `validateAdPlacementsInput` (`targetId` wajib untuk `widget|post|page`, terlarang untuk `global`).
- `theme-policy.ts` (Issue #542) — `validateUpdateThemeSettingsInput` (`mode` = `light|dark|system`, set nilai sama seperti `tenant-admin`'s `VALID_THEMES` tapi didefinisikan independen — repo ini tidak punya konvensi shared-domain-constant lintas modul).

## Application (`application/`)

- `blog-post-directory.ts` — dulu (Issue #537) hanya placeholder read-only; Issue #538 melengkapinya dengan seluruh mutation post (`createBlogPost`, `updateBlogPost`, `softDeleteBlogPost`, `transitionBlogPostStatus`, `restoreBlogPost`, `purgeBlogPost`) di file yang sama — konvensi "satu directory, baca+tulis" yang sama seperti `email/application/email-template-directory.ts`, bukan dipecah jadi file service terpisah. `version` (kolom integer di schema #537) di-increment tiap `updateBlogPost`/`transitionBlogPostStatus` sukses — penanda perubahan monoton saja, **belum** ada optimistic-concurrency check (If-Match/expected-version) yang membacanya. Issue #543 menambah `listBlogPostsForAdmin` (tambahan murni, tidak mengubah fungsi lain di file ini) — `search` (`ILIKE` judul, bukan `search_vector`, supaya query kosong tetap menampilkan semua post), `status`, `termId` (via `EXISTS` terhadap `awcms_blog_post_terms`, bukan `JOIN`, supaya post dengan banyak term tidak pernah muncul dobel), dan pagination bernomor halaman (`page`/`pageSize` + `total`) — dipakai `/admin/blog/posts` untuk search/filter/pagination yang `listBlogPosts`/`GET /api/v1/blog/posts` tidak sediakan. Tidak ada endpoint JSON baru untuk fungsi ini (tidak ada perubahan OpenAPI) — hanya dipanggil langsung dari SSR frontmatter `admin/blog/posts/index.astro`, pola yang sama seperti `admin/index.astro` memanggil fungsi reporting langsung.
- `blog-page-directory.ts` (Issue #539) — struktur identik `blog-post-directory.ts` (`createBlogPage`, `fetchBlogPageById`, `listBlogPages`, `updateBlogPage`, `softDeleteBlogPage`), **tanpa** `transitionBlogPostStatus`/`restoreBlogPage`/`purgeBlogPage` — pages tidak punya lifecycle-action endpoint di issue ini (lihat §Admin API — Blog Pages). Issue #543 menambah `listBlogPagesForAdmin` — sama konvensinya seperti `listBlogPostsForAdmin` (search+status+pageType filter, pagination bernomor halaman), tanpa filter term (pages tidak punya relasi taksonomi).
- `author-lookup.ts` (Issue #543) — `fetchAuthorDisplayNames(tx, tenantId, tenantUserIds)`, resolusi `author_tenant_user_id` -> nama tampilan untuk kolom "author" di `/admin/blog/posts` dan `/admin/blog/posts/{id}`. Join sempit `awcms_tenant_users` -> `awcms_identities` -> `awcms_profiles` yang dipersempit dari `identity-access/application/user-directory.ts`'s `fetchTenantUsersWithRoles` (fungsi itu juga memuat role assignment dan digerbangi `identity_access.user_management.read`, permission yang tidak seharusnya jadi syarat seorang editor blog melihat nama penulis kontennya sendiri). Id yang tidak ditemukan (mis. user sudah dihapus) sengaja absen dari `Map` hasil, bukan dilempar error — pemanggil UI fallback ke placeholder "Unknown".
- `blog-settings-directory.ts` (Issue #543) — `fetchBlogSettings`/`upsertBlogSettings` untuk `awcms_blog_settings` (migration 026, satu baris per tenant), akhirnya diaktifkan lewat `GET`/`PATCH /api/v1/blog/settings` — lihat §Settings API.
- `blog-taxonomy-directory.ts` — dulu (Issue #537) hanya `fetchBlogTermsByTaxonomyType` placeholder; Issue #539 melengkapinya dengan CRUD term penuh (`createBlogTerm`, `fetchBlogTermById`, `listBlogTerms`, `updateBlogTerm`, `softDeleteBlogTerm`) plus fungsi relasi post-term (`syncPostTermAssignments`, `fetchPostTermIds`, `countExistingTerms`) — lihat §Post-term relation handling.
- `blog-search.ts` (Issue #539) — `searchBlogContentAdmin` (semua status, guard `search.read`) dan `searchPublicBlogContent` (predikat publik, helper murni — lihat §Search).
- `blog-revision-directory.ts` (Issue #541) — `createBlogRevision` (INSERT-only, `revision_number` = `MAX(...)+1` scoped ke `(tenant_id, resource_type, resource_id)`), `listBlogRevisions`, `fetchBlogRevisionById` (di-scope ke `resource_id` juga, bukan cuma `id` — revisionId dari post lain tidak bisa dibaca lewat URL post ini). Tidak ada fungsi update/delete di file ini sama sekali — lihat §Revisions.
- `blog-scheduled-publish.ts` (Issue #541) — `publishDueScheduledPosts`, satu `UPDATE` set-based per tenant, dipanggil `scripts/blog-scheduled-publish.ts` — lihat §Scheduled publishing.
- `domain/revision-policy.ts` (Issue #541) — `isSignificantContentChange` (true kalau `title`/`contentJson`/`contentText` ada di input update; field kosmetik seperti `seoTitle`/`canonicalUrl`/`slug` tidak memicu revisi baru).
- `template-directory.ts`/`menu-directory.ts`/`widget-directory.ts`/`ads-directory.ts`/`theme-settings-directory.ts` (Issue #542) — CRUD directory per resource, pola identik `blog-taxonomy-directory.ts` (satu file, baca+tulis, soft-delete). `menu-directory.ts`'s `syncMenuItems` dan `ads-directory.ts`'s `syncAdPlacements` full-replace sub-resource (delete-lalu-insert), sama seperti `syncPostTermAssignments`.
- `localized-content-directory.ts` (Issue #542) — `setPostTranslationGroup`/`fetchPostTranslations`, satu kolom `UPDATE`/`SELECT` yang sengaja berdiri sendiri, **tidak** menyentuh `blog-post-directory.ts`'s `createBlogPost`/`updateBlogPost` (lihat §Presentation extensions §Multilingual untuk alasan risk/invasiveness-nya).

## Admin API — Blog Posts (Issue #538)

`/api/v1/blog/posts` (`src/pages/api/v1/blog/posts/`), bearer session + `X-AWCMS-Mini-Tenant-ID`, pola identik endpoint lain di base ini (`resolveAuthInputs`/`extractBearerToken` → `authorizeInTransaction`/`evaluateAccess` → service → `recordAuditEvent` → `ok()`/`fail()`).

```txt
GET    /api/v1/blog/posts                    -> blog_content.posts.read
POST   /api/v1/blog/posts                     -> blog_content.posts.create
GET    /api/v1/blog/posts/{id}                -> blog_content.posts.read
PATCH  /api/v1/blog/posts/{id}                -> blog_content.posts.update (+ author-own-draft override, lihat di bawah)
DELETE /api/v1/blog/posts/{id}                -> blog_content.posts.delete
POST   /api/v1/blog/posts/{id}/submit-review  -> blog_content.posts.update (sama override)
POST   /api/v1/blog/posts/{id}/publish        -> blog_content.posts.publish (Idempotency-Key wajib)
POST   /api/v1/blog/posts/{id}/schedule       -> blog_content.posts.schedule (Idempotency-Key wajib)
POST   /api/v1/blog/posts/{id}/archive        -> blog_content.posts.archive (Idempotency-Key wajib)
POST   /api/v1/blog/posts/{id}/restore        -> blog_content.posts.restore (Idempotency-Key wajib)
POST   /api/v1/blog/posts/{id}/purge          -> blog_content.posts.purge (Idempotency-Key wajib)
GET    /api/v1/blog/posts/{id}/quality-checklist -> blog_content.posts.read (Issue #640, read-only preview)
```

### Content quality checklist gate pada publish/schedule (Issue #640)

`publish`/`schedule` di atas sekarang menjalankan `content-quality-checklist-gate.ts`'s `evaluateContentQualityChecklistForContent` SEBELUM transisi status — server-side, bukan cuma preview klien (`GET .../quality-checklist`, dipakai panel admin editor). Checklist ini adalah no-op (`applicable: false`) kecuali full-online R2-only news portal mode (`news_portal`, Issue #632/#636) aktif untuk tenant pemanggil — mayoritas tenant `blog_content`-only tidak terpengaruh sama sekali. Ketika mode aktif dan satu rule `blocking` gagal (mis. unsafe HTML, local image path, external image URL, featured/gallery image tidak verified R2), request ditolak `422 CONTENT_QUALITY_CHECKLIST_BLOCKED` dan diaudit `blog.post.publish_blocked_by_checklist`/`.schedule_blocked_by_checklist`. Detail rule/severity/kebijakan tenant lengkap ada di `.claude/skills/awcms-news-portal/SKILL.md` §640 (bukan diduplikasi di sini, karena logikanya benar-benar hidup di `news_portal` epic's cross-cutting context, sama seperti §636's gate untuk create/update).

### ABAC — author boleh edit draft sendiri tanpa permission `update`

Doc issue #538 §ABAC Rules menuntut dua hal sekaligus dari **satu** permission `blog_content.posts.update`: "Editor/Admin dengan permission boleh edit semua post tenant" **dan** "Author boleh edit draft sendiri walau belum published" (tanpa permission itu). `domain/content-access-policy.ts`'s `evaluateContentUpdateAccess` (logic generik, diekstrak di Issue #539 supaya pages memakai ulang) mengekspresikan ini sebagai OR: role permission (jalur "Editor/Admin") ATAU (pemanggil = `authorTenantUserId` DAN `status !== 'published'`) (jalur "Author"). `post-access-policy.ts`'s `evaluatePostUpdateAccess` dan `page-access-policy.ts`'s `evaluatePageUpdateAccess` adalah thin wrapper yang mengunci guard-nya ke `blog_content.posts.update`/`.pages.update`. Fungsi generiknya **sengaja tidak** ditaruh di `identity-access/domain/access-control.ts`'s `evaluateAccess` — itu evaluator lintas-modul yang deny-biased (ADR-0004 "default deny, deny overrides allow"); override ALLOW berbasis kepemilikan resource adalah business logic spesifik `blog_content`, disusun di atas `evaluateAccess` (memanggilnya dulu, baru fallback ke ownership check kalau satu-satunya alasan deny adalah `default_deny`), bukan primitive lintas-modul baru seperti `self_approval_deny` yang sudah ada.

Dipakai oleh `PATCH /api/v1/blog/posts/{id}`, `POST /api/v1/blog/posts/{id}/submit-review`, dan `PATCH /api/v1/blog/pages/{id}` (semua map ke permission `update`); endpoint lain (`publish`/`schedule`/`archive`/`restore`/`purge` untuk posts) TIDAK punya ownership override — cek permission murni via `authorizeInTransaction`, sesuai literal doc issue #538: "Author may not publish unless granted `blog_content.posts.publish`". Pages tidak punya lifecycle-action endpoint sama sekali di issue ini (lihat §Admin API — Blog Pages), jadi tidak ada pertanyaan ownership-override untuk publish/schedule/archive pages.

### `AccessAction` union diperluas: `publish`, `schedule`, `archive`

Sama seperti Issue 10.1 menambah `restore`/`purge` dan sync object-queue menambah `retry`, guard `posts.publish`/`.schedule`/`.archive` butuh tiga nilai baru di `identity-access/domain/access-control.ts`'s `AccessAction` union (lihat README modul itu). **Tidak** ditambahkan ke `HIGH_RISK_ACTIONS` (metadata dokumentatif, bukan gerbang) — endpoint-nya tetap memanggil `recordAuditEvent` eksplisit dan mewajibkan `Idempotency-Key` terlepas dari klasifikasi itu.

### Validasi status transition & purge/restore precondition

- Semua transisi status (submit-review/publish/schedule/archive) divalidasi via `isValidStatusTransition` (Issue #537) sebelum mutasi — transisi tidak sah → `409 INVALID_STATUS_TRANSITION`.
- `canPurgePost(status, deletedAt)` (baru di `post-status.ts`) — purge hanya boleh untuk post yang sudah `archived` atau sudah soft-deleted; selain itu → `409 PURGE_NOT_ALLOWED`.
- `canRestorePost(deletedAt)` — restore hanya untuk post yang sedang soft-deleted; selain itu → `404`.

### Sanitasi HTML

`domain/content-validation.ts`'s `validateContentJsonField`/`validateContentTextField` menolak (bukan men-sanitize) `<script>`, `<iframe>`, `<embed>`, `<object>`, atribut event-handler inline, dan URL `javascript:` — pola persis sama yang dipakai `email-template-validation.ts` (doc 20 §XSS).

### Idempotency & audit

`Idempotency-Key` wajib untuk `publish`/`schedule`/`archive`/`restore`/`purge` (scope: `blog_post_publish`/`blog_post_schedule`/`blog_post_archive`/`blog_post_restore`/`blog_post_purge`, tabel generik `awcms_idempotency_keys`). `create`/`update` tidak mewajibkannya (direkomendasikan saja per doc issue #538) — retry `create` yang mengulang slug yang sama akan kena `409 SLUG_CONFLICT` dari partial unique index, sama seperti `POST /api/v1/email/templates`.

Audit `action` memakai string persis dari doc issue #538 §Audit Requirements (`blog.post.created`, `.updated`, `.submitted_for_review`, `.published`, `.scheduled`, `.archived`, `.deleted`, `.restored`, `.purged`) — bukan verb generik singkat (`create`/`update`) yang dipakai modul lain, karena issue ini eksplisit meminta identifier tersebut.

### Purge — pembersihan `post_terms`

`purgeBlogPost` menghapus baris `awcms_blog_post_terms` milik post itu lebih dulu (metadata join murni, tidak berarti apa-apa begitu post-nya hilang) sebelum `DELETE` post-nya sendiri — **berbeda** dari pola `POST /api/v1/profiles/{id}/purge` yang menangkap foreign-key violation via savepoint, karena di sini kita sendiri yang memiliki kedua tabel dan tahu persis apa yang aman dihapus lebih dulu. `awcms_blog_revisions` sengaja **tidak** disentuh (tidak ber-FK ke post, tetap jadi riwayat historis meski post-nya sudah purge).

## Admin API — Blog Pages (Issue #539)

`/api/v1/blog/pages` (`src/pages/api/v1/blog/pages/`), pola identik posts (guard → validasi → service → audit → response). **Beda dari posts: hanya CRUD, tidak ada lifecycle-action endpoint** (`submit-review`/`publish`/`schedule`/`archive`/`restore`/`purge`) — doc issue #539 §Routes hanya mendaftarkan GET/POST/GET/PATCH/DELETE untuk pages, meskipun permission `blog_content.pages.{publish,archive,restore,purge}` sudah diseed sejak Issue #537. Permission itu menunggu issue lanjutan yang benar-benar membangun endpoint-nya — jangan asumsikan lifecycle pages sudah berfungsi hanya karena permission-nya ada di katalog.

```txt
GET    /api/v1/blog/pages          -> blog_content.pages.read
POST   /api/v1/blog/pages          -> blog_content.pages.create
GET    /api/v1/blog/pages/{id}     -> blog_content.pages.read
PATCH  /api/v1/blog/pages/{id}     -> blog_content.pages.update (+ author-own-draft override)
DELETE /api/v1/blog/pages/{id}     -> blog_content.pages.delete
GET    /api/v1/blog/pages/{id}/quality-checklist -> blog_content.pages.read (Issue #640, read-only preview — see note below)
```

Tidak idempotency-gated (sama seperti posts create/update — recommended, bukan required). Audit `action` memakai pola literal yang sama: `blog.page.created`/`.updated`/`.deleted`.

`GET .../quality-checklist` (Issue #640) mengevaluasi checklist konten yang sama dengan posts (lihat §Content quality checklist gate di atas), TAPI murni **preview** untuk pages — karena tidak ada `POST .../publish`/`.../schedule` untuk pages sama sekali (paragraf di atas), tidak ada state transition apa pun untuk digerbangi di sini. `taxonomy_exists` selalu `applicable: false` untuk pages (tidak ada tabel `_terms` untuk pages).

## Admin API — Blog Taxonomies (Issue #539)

`/api/v1/blog/terms` (`src/pages/api/v1/blog/terms/`). **Tidak ada `GET /{id}`** — doc issue #539 §Routes hanya mendaftarkan list/create/update/delete untuk terms.

```txt
GET    /api/v1/blog/terms          -> blog_content.taxonomies.read
POST   /api/v1/blog/terms          -> blog_content.taxonomies.configure
PATCH  /api/v1/blog/terms/{id}     -> blog_content.taxonomies.configure
DELETE /api/v1/blog/terms/{id}     -> blog_content.taxonomies.configure
```

Satu permission (`configure`) menggerbangi create/update/delete sekaligus — sama seperti `sync_storage.conflict_resolution.approve` menggerbangi seluruh `POST /sync/conflicts/{id}/resolve` apa pun hasilnya (permission = kapabilitas "mengelola taksonomi", bukan per-aksi terpisah). Tidak ada restore/purge — doc issue #537's permission seed tidak punya `taxonomies.restore`/`.purge`, jadi soft-delete term bersifat satu arah lewat kode ini (baris tetap ada di DB untuk audit, tapi tidak ada jalur API mengembalikannya).

`PATCH` yang mengubah `taxonomyType` ke `tag` sambil `parentId` lama masih ada (tidak ikut dikosongkan di request yang sama) ditolak `400` — endpoint menggabungkan field yang dikirim dengan baris existing sebelum memanggil ulang `validateTermParent`, persis dicatat di `blog-term-validation.ts`'s docblock.

## Post-term relation handling (Issue #539)

Doc issue #539 §Scope menyebut "Post-term relation handling" tapi **tidak** mendaftarkan route khusus untuk itu di §Routes — jadi ini ditanam di payload create/update blog post yang sudah ada (Issue #538), bukan endpoint baru:

- `POST`/`PATCH /api/v1/blog/posts(/{id})` menerima `termIds?: string[]` opsional.
- Kalau dikirim, `countExistingTerms` mengecek dulu semua id ada & milik tenant yang sama (`400 VALIDATION_ERROR` kalau tidak) — dijalankan **sebelum** post ditulis, supaya tidak ada post "setengah jadi" saat `termIds` invalid.
- `syncPostTermAssignments` men-**replace** seluruh assignment (`DELETE` semua baris `awcms_blog_post_terms` milik post itu, lalu `INSERT` ulang set yang dikirim) — bukan diff/merge, karena caller selalu mengirim daftar lengkap yang diinginkan.
- Response `GET`/`POST`/`PATCH /api/v1/blog/posts(/{id})` menyertakan `termIds` (di-assemble di route handler lewat `fetchPostTermIds`, **bukan** field pada `BlogPostView` dari `blog-post-directory.ts` — directory tetap murni soal tabel `awcms_blog_posts` saja). `GET /api/v1/blog/posts` (list) **tidak** menyertakan `termIds` per item (query tambahan per baris tidak sepadan untuk daftar).

## Search (Issue #539)

`blog-search.ts` — PostgreSQL full-text search lewat `search_vector @@ websearch_to_tsquery('simple', q)`, `UNION ALL` antara posts dan pages, diurutkan `created_at DESC, id DESC`.

- **`GET /api/v1/blog/search`** (guard `blog_content.search.read`) — admin search, boleh mengembalikan status apa pun (`draft`/`review`/.../`archived`) selama caller punya `search.read`; tidak ada komposisi permission tambahan per-status. Keyset-paginated lewat `_shared/keyset-pagination.ts` (`cursor` base64 `(createdAt, id)`), pola sama persis `GET /api/v1/logs/audit`. Filter opsional `?type=post|page` dan `?status=`.
- **`searchPublicBlogContent`** — helper murni, **tidak** dipasang ke route apa pun di issue ini (rendering rute publik = Issue #540, eksplisit Out of Scope di doc issue #539). Predikat persis dari doc issue #539 §Public Visibility Predicate: `status = 'published' AND visibility = 'public' AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()`. Issue #540 memanggil fungsi ini langsung, bukan menulis ulang predikatnya.

## Public routes (Issue #540)

`src/pages/blog/[tenantCode]/` — 7 rute publik, anonim (tanpa sesi/header tenant), per ADR-0009: resolusi tenant dari segmen path `tenantCode`, bukan subdomain/header.

```txt
GET /blog/{tenantCode}                         -> index (paginated, tanpa auth/permission — publik)
GET /blog/{tenantCode}/{slug}                   -> detail post
GET /blog/{tenantCode}/category/{slug}          -> arsip kategori
GET /blog/{tenantCode}/tag/{slug}               -> arsip tag
GET /blog/{tenantCode}/search?q=                -> search publik (memakai searchPublicBlogContent, Issue #539)
GET /blog/{tenantCode}/feed.xml                 -> RSS 2.0
GET /blog/{tenantCode}/sitemap-blog.xml         -> sitemap protocol 0.9
```

**Hanya blog post**, bukan pages (`awcms_blog_pages`) — doc issue #540 §Scope hanya mendaftarkan "Public post detail page", tidak ada "Public page detail" sama sekali di antara bullet scope-nya (beda dari §Routes issue #539 yang eksplisit menyebut halaman statis). Rendering publik untuk `blog_content` pages tetap backlog terbuka.

### Kenapa `.ts` API route, bukan `.astro` page

Ketujuh rute ini adalah `APIRoute` (`.ts`, HTML/XML string dirender manual), **bukan** file `.astro` — keputusan disengaja. Repo ini tidak punya konvensi test untuk output `.astro` (semua integration test yang ada, termasuk seluruh suite `blog_content` sebelumnya, memanggil `APIRoute` handler langsung lewat `tests/integration/harness.ts`'s `invoke()`/`invokeRaw()`). Menulis rute ini sebagai `.astro` akan membuatnya untestable lewat pola yang sudah mapan di repo — sementara persyaratan issue ini sendiri eksplisit ("Tests cover public visibility leakage... SEO rendering... RSS and sitemap content filtering") menuntut test end-to-end yang nyata, bukan cuma unit test fungsi murni. `invokeRaw()` (baru, `tests/integration/harness.ts`) melengkapi `invoke()` untuk handler yang me-return body non-JSON — `invoke()` sendiri selalu `JSON.parse(text)` dan akan throw untuk HTML/XML.

### Dua predikat visibilitas publik yang berbeda

Doc issue #540 mendefinisikan satu "Public Visibility Rule" dasar (`status='published' AND visibility='public' AND deleted_at IS NULL AND published_at IS NOT NULL AND published_at <= now()`) plus aturan tambahan "listing/search/feed/sitemap: `visibility != 'unlisted'`". Kedua kalimat itu redundan kalau predikat dasarnya SELALU `visibility='public'` — kecuali predikat dasar itu dimaksudkan untuk konteks LISTING saja, dan DETAIL punya predikat sendiri yang sedikit lebih longgar. Acceptance criteria issue ini mengonfirmasi baca-an itu: **"Unlisted content is excluded from listing/search/feed/sitemap"** (bukan dari SEMUA akses publik) — artinya unlisted memang harus tetap bisa diakses lewat link langsung, itulah gunanya tier "unlisted" ada terpisah dari "private" (yang tidak pernah publik sama sekali).

`public-blog-directory.ts` karena itu punya **dua** predikat:

- **Listing** (index/kategori/tag/search/feed/sitemap): `visibility = 'public'` ketat — sama persis predikat `searchPublicBlogContent` (Issue #539).
- **Detail** (`fetchPublicBlogPostBySlug`): `visibility IN ('public', 'unlisted')` — private tetap selalu ditolak.

Kalau interpretasi ini pernah dianggap salah oleh maintainer, ini satu-satunya tempat yang perlu diubah (bukan tersebar di 7 route handler).

### Content block schema (baru, didefinisikan oleh issue ini)

`content_json` sebelumnya "opaque to the API" (doc issue #537/#538). Issue #540 pertama kali mendefinisikan bentuk konkretnya karena rendering publik butuh sesuatu yang nyata untuk dirender: `{ blocks: ContentBlock[] }` dengan 4 tipe block — `paragraph`, `heading` (level 1-6), `list` (`ordered?: boolean`, `items: string[]`), `quote`. `domain/content-block-rendering.ts`'s `renderContentJsonToHtml` adalah **whitelist renderer** — setiap tipe block hanya pernah mengeluarkan teks lewat `escapeHtml`, tidak ada tipe block "raw html". Block dengan `type` tak dikenal atau field tidak valid di-skip diam-diam (tidak pernah throw — lihat §Error handling). Menambah tipe block baru (image, embed, table, ...) berarti menambah `case` baru di `switch` fungsi itu, bukan membuka raw-HTML escape hatch.

### SEO rendering (`domain/seo-rendering.ts`)

- `resolveSeoTitle`: `seoTitle || title`.
- `resolveMetaDescription`: `metaDescription || excerpt || <ringkasan digenerate dari contentText, dipotong di batas kata, diberi "...">`.
- `resolveCanonicalUrl`: pakai `canonicalUrl` penulis kalau itu URL http(s) absolut yang valid (re-validasi lewat `isAbsoluteHttpUrl` yang sama dengan write-time check di `seo-validation.ts` — defense in depth, "Do not render unsafe URLs"); kalau tidak, fallback ke URL halaman itu sendiri; kalau keduanya tidak valid, `null` (tag `<link rel="canonical">` tidak dirender sama sekali, bukan dirender dengan URL tidak aman).

### Error handling — tidak pernah bocorkan stack trace

Setiap route handler dibungkus `try/catch` di level teratas: error asli di-log lewat `log("error", ...)` (untuk operator), tapi respons ke klien SELALU string generik tetap (`src/lib/html/error-responses.ts`'s `notFoundHtmlResponse`/`serverErrorHtmlResponse`/`notFoundXmlResponse`/`serverErrorXmlResponse`) — tidak pernah pesan/`error.message` mentah. Tenant `tenantCode` tidak ditemukan ATAU tidak `active` menghasilkan `404` yang identik (ADR-0009: "jangan bocorkan keberadaan tenant").

### Pagination

Index dan arsip kategori/tag pakai `?page=` (1-indexed) + `LIMIT`/`OFFSET` sederhana, bukan keyset — ini halaman publik yang dibaca pengunjung manusia (ekspektasi UX "halaman 1, 2, 3", bukan cursor buram), beda dari admin search (Issue #539) yang keyset-paginated. `pageSize` diambil dari `awcms_blog_settings.posts_per_page` (Issue #537, default 10) lewat `fetchPublicBlogSettings`. RSS/sitemap tidak dipaginasi sama sekali — flat, dibatasi 50 post terbaru (`FEED_ITEM_LIMIT`), karena konsumennya mesin (feed reader/crawler), bukan pengunjung yang mengklik "next".

`?page=` di-normalisasi lewat `parsePageParam`/`boundedPageNumber` (`src/modules/_shared/offset-pagination.ts`, Issue #819) — **bukan** `Number(param)` langsung. Route ini publik tanpa auth, jadi `page` wajib terklamp di kedua ujung: `?page=1e8` dulu jadi `OFFSET 1e9` (Postgres tetap memindai lalu membuang satu miliar baris sambil menahan satu koneksi pool — DoS satu-request), dan `?page=abc` jadi `OFFSET NaN` → 500. Sekarang nilai non-numerik/`NaN`/`±Infinity`/negatif jatuh ke halaman 1, pecahan di-truncate, dan batas atas `MAX_PAGE_NUMBER` = 10.000. Junk dinormalisasi ke halaman 1, bukan 400: ini route arsip HTML — `?page=` rusak harus merender halaman pertama, bukan error yang ikut terindeks crawler. Nilai terklamp itu juga yang dipakai untuk merender nav pagination, supaya `?page=abc` tidak pernah menghasilkan link `NaN`. Daftar admin (`listBlogPostsForAdmin`/`listBlogPagesForAdmin`) memakai helper yang sama.

## Public routes `/news` (Issue #560, epic #555)

`src/pages/news/` — tenant-code-free counterpart of `/blog/{tenantCode}`
above, added by epic #555 ("online public tenant routing, news routes, and
tenant domain management"), **not** epic #536. See
`.claude/skills/awcms-tenant-domain-routing/SKILL.md` §Rute publik
`/news` for the full cross-issue writeup (config, resolver, module-disabled
gate); this section only covers what's specific to this module.

```txt
GET /news                         -> index (paginated, same as /blog/{tenantCode})
GET /news/{slug}                  -> detail post
GET /news/category/{slug}         -> category archive
GET /news/tag/{slug}              -> tag archive
GET /news/search?q=               -> public search (same searchPublicBlogContent, Issue #539)
GET /news/feed.xml                -> RSS 2.0
GET /news/sitemap-news.xml        -> sitemap protocol 0.9
```

Same 7 routes as `/blog/{tenantCode}` (same `.ts` `APIRoute` decision — see
§Kenapa `.ts` API route above, same reasoning applies unchanged), reusing
every application/domain service unchanged: `public-blog-directory.ts`
(same two visibility predicates, §Dua predikat visibilitas publik above,
unmodified), `public-page-rendering.ts`, `seo-rendering.ts`,
`content-block-rendering.ts`, `blog-search.ts`'s `searchPublicBlogContent`,
`src/lib/html/error-responses.ts`. **Only post, still no public route for
pages** — same scope boundary as `/blog/{tenantCode}` (§Public routes
above), unchanged by this issue.

**The only actual difference**: tenant resolution.
`/blog/{tenantCode}/...` resolves the tenant from the `tenantCode` path
segment via `resolvePublicTenantByCode` (ADR-0009); `/news/...` has no
`tenantCode` segment at all and instead resolves via
`resolvePublicTenantFromRequest` (Issue #559,
`src/lib/tenant/public-host-tenant-resolver.ts`) — a request `Host`
header/domain-mapping lookup with an env/setup-state fallback chain (see
the tenant-domain-routing skill for the full resolution order and the
`tenant_code_legacy` mode decision made in this issue).

### `withNewsTenant` — shared tenant resolution + module-disabled + route-mode gate

`src/modules/blog-content/application/public-news-tenant-resolution.ts`'s
`withNewsTenant(sql, request, handler, env?)` centralizes what all seven
routes need before touching a single post row:

1. Builds `PublicHostResolverConfig` from `process.env.PUBLIC_TENANT_RESOLUTION_MODE`/
   `process.env.PUBLIC_TRUST_PROXY` (`buildPublicHostResolverConfigFromEnv`)
   and calls `resolvePublicTenantFromRequest`. `null` -> the whole helper
   returns `null`.
2. **Module-disabled + route-mode gate** (`checkBlogContentAndRouteGate`,
   private): inside the same `withTenant(...)` transaction,
   `fetchTenantModuleEntry` (`module-management/application/tenant-module-lifecycle.ts`
   — the single-module narrowing of the plural `fetchTenantModuleEntries`,
   added as a security audit follow-up so this anonymous gate reads only
   `blog_content`'s own row, not every registered module's) confirms
   `blog_content` is enabled (explicit Issue #560 acceptance criterion),
   and `fetchEffectivePublicRouteSettings` (Issue
   #564, `application/public-route-settings.ts`) confirms the tenant's
   effective `publicRouteMode` is not `"disabled"`. Either failing -> the
   helper returns `null` — indistinguishable from every other non-resolving
   case from the caller's side.

On success, `handler` also receives the tenant's `EffectivePublicRouteSettings`
as a third argument (Issue #564) — `publicBasePath`/`publicLabel` for
self-referential link generation, `rssEnabled`/`sitemapEnabled` so
`feed.xml`/`sitemap-news.xml` don't need a second lookup (see §Public
route settings below for where each field actually lives).

Every route then does `const result = await withNewsTenant(sql, request,
async (tx, tenant, routeSettings) => { ...; return new Response(...); });
return result ?? notFoundHtmlResponse();` (or `notFoundXmlResponse()` for
the two XML routes) — a `handler` that finds no matching post/term also
just `return null`, collapsing into the identical generic 404 as the
tenant/module/route-mode gate.

**Timing side-channel fix (landed alongside Issue #562)**: "tenant not
resolved" and "tenant resolved but `blog_content` disabled" both return the
identical `null`/404, but used to cost a different number of DB round trips
(the first touched no transaction at all, the second opened `withTenant` +
one module-enabled lookup query) — an external prober varying the
`Host` header could have learned "this hostname maps to a real, active
tenant" purely from response latency once Issue #562's API let
`awcms_tenant_domains` hold real mappings. Fixed by
`padUnresolvedTenantLatency()`: the "not resolved" branch now pays the same
round-trip shape via a harmless padding query scoped to the all-zero
fail-closed sentinel tenant id (migration 013), which always matches zero
rows. See `public-news-tenant-resolution.ts`'s own docblock and skill
`awcms-tenant-domain-routing` §Rute publik `/news` for the full
writeup, including the deliberate trade-off this adds for
`tenant_code_legacy` mode (a small, constant DB dependency it did not
previously have). Issue #564 extended the gate (added the route-mode
check above) without reopening this fix — see §Public route settings
below, "Timing parity preserved", for how.

**Known pre-existing gap, deliberately not retrofitted here**:
`/blog/{tenantCode}` (Issue #540) has **no** module-disabled check at all —
a tenant that disables `blog_content` via
`POST /api/v1/tenant/modules/blog_content/disable` can still be browsed
publicly through `/blog/{tenantCode}`. Out of this issue's explicit scope
("Rebuilding blog-content internals" is listed as out of scope); flagged
here as a good candidate for a small follow-up issue instead (reuse
`withNewsTenant`'s module-disabled pattern, or extract a shared
`withTenantModuleGate` if that retrofit is ever done for more than one
legacy route).

### Rendering helper extended, not duplicated

`public-page-rendering.ts`'s `renderPostSummaryListHtml(tenantCode, ...)`
now delegates to a new, more general
`renderPostSummaryListHtmlAtBasePath(basePath, ...)` (`basePath =
/blog/{tenantCode}` for the old wrapper, `/news` for these routes) — a pure
extraction, byte-for-byte identical output for every existing
`/blog/{tenantCode}` call site (verified: `escapeHtml` applied to the whole
base-path string produces the same escaped characters as escaping the
tenant code alone, regardless of the literal `/blog/` slashes around it).
`renderPaginationNavHtml` was already generic (takes `basePath` directly) —
no change needed there.

### Canonical URL / feed / sitemap base path

All literal `/news` (not a consumer of `PUBLIC_CANONICAL_BASE_PATH` —
that var has been validated since Issue #556 but is not consumed by any
code yet; `/news` here is a fixed file-routing path, not an
env-configurable base path). `seo-rendering.ts`'s `resolveCanonicalUrl` is
unchanged — only the `selfUrl` each route passes in differs
(`${url.origin}/news/{slug}` instead of `${url.origin}/blog/{tenantCode}/{slug}`).

Test: `tests/integration/blog-content-public-news.integration.test.ts` —
every acceptance criterion (listing/detail visibility across all
statuses, unlisted-reachable-by-direct-link, canonical URL under `/news`,
feed/sitemap links under `/news`, module-disabled 404, `tenant_code_legacy`
404, cross-tenant isolation).

### Public social share buttons + expanded OG/Twitter metadata — Issue #642 (epic `news_portal`)

Both post detail routes (`/news/{slug}`, `/blog/{tenantCode}/{slug}`) now
render a public share widget (native Web Share API, copy-link, WhatsApp,
Telegram, Facebook, LinkedIn, X, email) and expanded Open Graph/Twitter
Card metadata. New pure modules:
`domain/social-share-links.ts` (`buildSocialShareLinks` — six-platform
fixed allowlist, every URL `encodeURIComponent`-encoded;
`renderSocialShareButtonsHtml` — full widget markup) and
`src/modules/news-portal/domain/news-share-config.ts`
(`resolveNewsShareConfig` — per-platform `NEWS_SHARE_*_ENABLED` env
flags, all defaulting `true`; see that file's header comment for why this
deviates from this repo's usual "opt-in, default off" feature-flag
convention). See `.claude/skills/awcms-news-portal/SKILL.md` §642 for
the full design rationale (Instagram has no supported web-share URL so
never gets a dedicated button; the canonical URL — never the request's
raw querystring — is the only URL ever shared; the native-share/copy-link
client script is a same-origin static file, `public/js/news-share.js`,
never inline, so it adds zero Content-Security-Policy surface).

`public-page-rendering.ts`'s `renderPublicPageShell` now also emits
`og:title`/`og:description`/`og:url`/`og:site_name` (derived from the same
`title`/`description`/`canonicalUrl` fields it already renders as
`<title>`/`<meta name="description">`/`<link rel="canonical">` — one
source of truth, `siteName` new and optional from
`PublicTenantResolution.tenantName`) and `twitter:title`/
`twitter:description`/`twitter:card` (now always present — `summary`
without an image, `summary_large_image` with one). `og:image`/
`twitter:image`/`og:image:alt` are unchanged from Issue #636 (still gated
on a verified R2 media object).

Test: `tests/unit/social-share-links.test.ts`, `tests/unit/news-share-config.test.ts`,
`tests/unit/news-share-client-script.test.ts`,
`tests/integration/news-portal-share-buttons.integration.test.ts` (real
`/news/{slug}`/`/blog/{tenantCode}/{slug}` routes — default-enabled
widget, master-switch/per-platform disable, draft never renders it,
canonical URL used even when the request URL carries tracking
querystring parameters).

## `/news` (default) vs `/blog/{tenantCode}` (legacy) — Issue #561

Two public route families exist side by side, and neither is going away.
Pick per-deployment via `PUBLIC_TENANT_RESOLUTION_MODE`
(`docs/awcms/18_configuration_env_reference.md` §Public routing,
`docs/adr/0010-public-host-tenant-routing.md`) — this is a **config
choice**, not a code choice; both route families always exist in every
build.

| Route                | Status                                             | Tenant resolution                                                                                                                                 | Use when                                                                                                                                                     |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/news`              | **Default for online/public**                      | Request `Host`/domain mapping (Issue #559, mode `host_default`), with env/setup-state fallback — see §Resolver in the tenant-domain-routing skill | Online/public/SaaS deployment with a real domain: clean, SEO-friendly, tenant-implicit URLs (no tenant code in the path)                                     |
| `/blog/{tenantCode}` | **Legacy, explicit-tenant, still fully supported** | `tenantCode` path segment (ADR-0009), resolved directly, independent of `PUBLIC_TENANT_RESOLUTION_MODE`                                           | Offline/LAN-first deployment (doc 18) with no public domain/DNS/TLS at all, or any deployment that wants an explicit, unambiguous tenant selector in the URL |

Both route families reuse the exact same application/domain services
(`public-blog-directory.ts`, `public-page-rendering.ts`, `seo-rendering.ts`,
`content-block-rendering.ts`, `blog-search.ts`'s `searchPublicBlogContent`)
— see §Public routes `/news` (Issue #560) above, "The only actual
difference". Neither family redirects to the other and there is no plan to
retire `/blog/{tenantCode}` — see `docs/adr/0010-public-host-tenant-routing.md`
§Konsekuensi and the `awcms-tenant-domain-routing` skill's "aturan
lintas-issue" #3. `/news` examples in this README never include a
`tenantCode` segment — that is the whole point of the route (tenant is
resolved from the request, not the path).

## Public route settings (Issue #564, epic #555)

`application/public-route-settings.ts`'s `fetchEffectivePublicRouteSettings(tx, tenantId, env?)`
computes one merged, read-only DTO for `/news`/`/blog/{tenantCode}` route
handlers, sourced from **two** existing, already-authoritative stores —
deliberately not a third one:

| Field                      | Store                                                                                                                                                    | Write path                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `publicRouteMode`          | `blog_content` module descriptor `settings.defaults` + `awcms_module_settings` tenant override (generic tenant-settings framework, Issue #516/epic #510) | `PATCH /api/v1/tenant/modules/blog_content/settings` |
| `publicBasePath`           | same as above                                                                                                                                            | same as above                                        |
| `legacyTenantRouteEnabled` | same as above                                                                                                                                            | same as above                                        |
| `publicLabel`              | same as above                                                                                                                                            | same as above                                        |
| `rssEnabled`               | `awcms_blog_settings` (Issue #537, wired up Issue #543) — **unchanged**                                                                                  | `PATCH /api/v1/blog/settings`                        |
| `sitemapEnabled`           | `awcms_blog_settings` — **unchanged**                                                                                                                    | `PATCH /api/v1/blog/settings`                        |

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
truth: an admin could flip "RSS enabled" off in the generic
`/admin/modules/blog_content` settings panel while the feed route keeps
reading the OLD `awcms_blog_settings` value and stays enabled — a
real correctness bug, not a stylistic preference. `fetchEffectivePublicRouteSettings`
proves this is enforced, not just documented:
`tests/integration/blog-content-settings.integration.test.ts`'s "writing
those exact key names into the new module-settings store has NO effect on
/news/feed.xml or /news/sitemap-news.xml" test PATCHes `rssEnabled: false`
into the wrong store and confirms the feed stays enabled, then flips it
through the correct store and confirms it actually disables.

### `publicRouteMode` — `/news` only, `domain_default` = unchanged behavior

`"domain_default"` (the default) means "behave exactly as before this
issue" — `/news` resolves the tenant per `PUBLIC_TENANT_RESOLUTION_MODE`
(doc 18) unchanged. `"disabled"` is the one new value: `withNewsTenant`
(`application/public-news-tenant-resolution.ts`) now also checks this
after confirming `blog_content` is enabled, and returns the same generic
`null` (-> identical 404) an unresolved tenant or a disabled module already
produce. Scoped to `/news` only — it does **not** gate `/blog/{tenantCode}`,
which has its own, independent switch (`legacyTenantRouteEnabled`, below).
This scoping is deliberate: the two route families are independent
(§`/news` vs `/blog/{tenantCode}` above), so their kill switches are too.

**Timing parity preserved.** `withNewsTenant`'s module-disabled gate
already had a timing side-channel fix (Issue #562's
`padUnresolvedTenantLatency`, closing the "does this hostname map to a
real tenant" latency leak). Adding a second condition (`publicRouteMode`)
to the same branch risked reopening it if the new check's query cost
weren't paid on every outcome uniformly. Fixed by factoring the whole gate
(`fetchTenantModuleEntry` + `fetchEffectivePublicRouteSettings`) into one
private `checkBlogContentAndRouteGate` function that both the real
resolved-tenant branch **and** `padUnresolvedTenantLatency` call — they can
never drift apart because they're the same function call, not
hand-duplicated query sequences. `tests/integration/blog-content-public-news.integration.test.ts`'s
three round-trip-parity tests were updated accordingly (same equality
assertions, now covering the extra query).

### `publicBasePath` — self-referential link generation only, NOT physical routing

Used everywhere `/news` route handlers previously hardcoded the literal
string `/news` into a **generated URL**: canonical `<link>`, RSS
`<link>`/item `<link>`/`<guid>`, sitemap `<loc>`, pagination hrefs,
category/tag archive links, and the post-summary listing links
(`renderPostSummaryListHtmlAtBasePath`). Falls back to the
`PUBLIC_CANONICAL_BASE_PATH` env var (Issue #556 — validated since that
issue but never consumed by any code until now, a pre-existing gap this
issue closes) when unset/invalid, then to the hardcoded `/news`.

**Known, deliberate limitation**: this does **not** retarget which Astro
file route physically serves a request. `/news/**` are Astro file-based
static routes (`src/pages/news/*`); Astro cannot repoint a static route's
own served path per-tenant at runtime without a catch-all dynamic segment
(`src/pages/[...basePath]/...`) — a much larger, riskier restructuring
that is out of this issue's scope (the issue's own "Update `/news` route
handlers ... where appropriate" wording reads as a soft/partial-application
instruction, not a routing rebuild). Practical consequence: setting
`publicBasePath` to anything other than `/news` produces self-referential
links that point at a path Astro does not actually serve at that prefix —
acceptable and documented, not silently broken; a tenant that customizes
this value is expected to also configure their reverse proxy/CDN to route
that prefix to this app if they want the generated links to actually
resolve. `tests/integration/blog-content-settings.integration.test.ts`
proves the acceptance criterion ("`/news` uses `publicBasePath` from
effective settings") is satisfied exactly this way — generated links
change, the route handler itself is still reached at `/news/*`.

### `legacyTenantRouteEnabled` — disable (404), not redirect; all 7 routes, consistently

Chosen: `false` makes all 7 `/blog/{tenantCode}` routes (index, detail,
category, tag, search, feed, sitemap) return the exact same generic 404 an
unknown `tenantCode` already produces — **not** a redirect to `/news`.
Reasons: (1) consistency with every other "this feature is turned off"
outcome in this module, which always collapses to the same generic 404
(rssEnabled/sitemapEnabled since Issue #543, blog_content-disabled and
publicRouteMode=disabled on `/news` above) — a redirect would be the only
inconsistent case; (2) a redirect to `/news` would implicitly assert "this
tenant is also reachable via host-based resolution," which is not
necessarily true (the two route families resolve tenants through entirely
independent mechanisms — §`/news` vs `/blog/{tenantCode}` above); (3) doc
issue #564's security note ("do not expose disabled reason... to anonymous
users") is trivially satisfied by reusing the established generic-404
convention, whereas a redirect target itself could leak information. The
default (`true`) keeps today's behavior unchanged — ADR-0010 and the
`awcms-tenant-domain-routing` skill's binding rule #3 both establish
that the legacy family is never removed by default; this setting is a
tenant-chosen opt-out, not a code-level deprecation. Implemented via
`isLegacyTenantRouteEnabled(tx, tenantId)` (a thin wrapper around
`fetchEffectivePublicRouteSettings`), called identically at the top of the
`withTenant` callback in all 7 `/blog/{tenantCode}/*.ts` files — no shared
resolver like `withNewsTenant` exists for the legacy family (each file
independently calls `resolvePublicTenantByCode`), so the consistency
guarantee here comes from every file calling the exact same one-line
helper, not from a single centralized gate function. Deliberately does
**not** get `withNewsTenant`'s timing-parity treatment — the `tenantCode`
is already caller-supplied and visible in the URL path itself, so there is
no "does this identifier map to a real tenant" existence question left to
protect by response latency (contrast `/news`, which resolves the tenant
from an opaque `Host` header). This module-disabled check is also still
absent from `/blog/{tenantCode}` (see §Public routes `/news` above, "Known
pre-existing gap") — unchanged, out of this issue's scope too.

### `publicLabel` — route-family label, distinct from `blogTitle`

A human-readable label for the `/news` route family (default `"News"`),
used in generated headings/titles/RSS channel title on `/news` only (not
`/blog/{tenantCode}`, which keeps its historical hardcoded "Blog" wording —
`publicLabel` is scoped to the route family this settings group actually
describes). Genuinely distinct from `awcms_blog_settings.blogTitle`
(Issue #543): `blogTitle` is SEO-facing content metadata (falls into
`seoDefaultTitle`'s fallback chain), while `publicLabel` labels the route
family itself ("News" vs "Blog" vs any other tenant-chosen word) —
independent of what the tenant names their actual blog/site.

### Secret-shaped key rejection still applies

`PATCH /api/v1/tenant/modules/blog_content/settings` still runs through
the same `validateModuleSettingsPatch` (`module-management/domain/module-settings.ts`)
every other module's settings PATCH does — none of the four new key names
(`publicRouteMode`, `publicBasePath`, `legacyTenantRouteEnabled`,
`publicLabel`) or their values match any entry in `redaction.ts`'s
`REDACTION_KEYS` list, confirmed by
`tests/integration/blog-content-settings.integration.test.ts`'s existing
secret-shaped-key test (unchanged assertion, now targeting `blog_content`
instead of `form_drafts`).

## Revisions (Issue #541)

`/api/v1/blog/posts/{id}/revisions` (`src/pages/api/v1/blog/posts/[id]/revisions/`).

```txt
GET  /api/v1/blog/posts/{id}/revisions                     -> blog_content.revisions.read
GET  /api/v1/blog/posts/{id}/revisions/{revisionId}         -> blog_content.revisions.read
POST /api/v1/blog/posts/{id}/revisions/{revisionId}/restore -> blog_content.revisions.restore (Idempotency-Key wajib)
```

Hanya rute untuk **post** — doc issue #541 §Routes cuma mendaftarkan tiga rute di atas, meski aturan revisi sendiri ("post/page changes") berlaku untuk keduanya. `PATCH /api/v1/blog/pages/{id}` juga memicu `createBlogRevision` dengan `resource_type = 'page'` (baris tersimpan, riwayat terekam), tapi tidak ada rute baca/restore untuk page revision di issue ini — backlog terbuka, lihat §Belum tersedia.

### Kapan revisi baru dibuat — "significant change"

`domain/revision-policy.ts`'s `isSignificantContentChange` — true kalau `PATCH` menyertakan `title`, `contentJson`, atau `contentText`; field lain (`seoTitle`, `metaDescription`, `canonicalUrl`, `visibility`, `locale`, `featuredMediaId`, `slug`, `menuOrder`, ...) tidak memicu revisi baru. `awcms_blog_revisions` tidak punya kolom `slug` (migration 026) — konsisten dengan keputusan itu. Dipanggil dari `PATCH /api/v1/blog/posts/{id}` dan `PATCH /api/v1/blog/pages/{id}`, **bukan** dari `POST` create — revisi pertama baru muncul begitu ada perubahan konten signifikan pertama setelah create, bukan snapshot draft awal.

### Restore — append-only, tidak pernah menimpa

`POST .../revisions/{revisionId}/restore`: (1) ambil konten revisi target, (2) tulis kembali ke baris post yang hidup lewat `updateBlogPost` biasa, (3) `createBlogRevision` lagi untuk mencatat state hasil restore itu sendiri (`changeNote: "Restored from revision {n}."`). Langkah 3 berarti restore **menambah** baris baru di `awcms_blog_revisions`, tidak pernah `UPDATE`/`DELETE` baris manapun yang sudah ada — riwayat lengkap termasuk revisi-revisi "di antara" tetap utuh dan bisa dibaca lagi nanti.

Permission `blog_content.revisions.restore` **eksplisit wajib** — tidak ada ownership override seperti `PATCH /api/v1/blog/posts/{id}` (author pemilik post tidak otomatis boleh restore revisinya sendiri tanpa permission itu; lihat §ABAC di §Admin API — Blog Posts untuk kontras pola). `Idempotency-Key` wajib (scope `blog_revision_restore`) — replay key yang sama mengembalikan response tersimpan tanpa menambah revisi kedua.

Audit: `blog.post.revision_restored` (severity `warning`, `attributes: { revisionId, revisionNumber }`).

## Scheduled publishing (Issue #541, direstrukturisasi Issue #640)

`bun run blog:publish:scheduled` (`scripts/blog-scheduled-publish.ts`) — worker internal, bukan endpoint HTTP, dijadwalkan cron/systemd timer (pola sama `scripts/form-draft-purge.ts`). Untuk setiap tenant aktif, memanggil `blog-scheduled-publish.ts`'s `publishDueScheduledPosts(sql, tenantId, mediaPort, options?)`.

**Issue #640 mengubah signature** (`mediaPort: NewsMediaPort` sekarang parameter wajib, disuntik `scripts/blog-scheduled-publish.ts` sebagai composition root — pola port yang sama ADR-0011 tetapkan) **dan** merestrukturisasi dari satu `UPDATE` set-based per tenant menjadi `SELECT ... FOR UPDATE` diikuti loop per-post:

```sql
SELECT id, slug, title, excerpt, content_json, content_text,
       featured_media_id, meta_description
FROM awcms_blog_posts
WHERE tenant_id = $1 AND status = 'scheduled'
  AND scheduled_at IS NOT NULL AND scheduled_at <= now() AND deleted_at IS NULL
FOR UPDATE
```

Setiap post due dievaluasi lewat `content-quality-checklist-gate.ts`'s `evaluateContentQualityChecklistForContent` (lihat `.claude/skills/awcms-news-portal/SKILL.md` §640) sebelum ditransisikan — kalau checklist gagal (blocking rule, hanya relevan bila tenant mengaktifkan mode full-online R2-only), post itu **dibiarkan `scheduled`** (bukan silently published, bukan di-unschedule) dan diaudit `blog.post.scheduled_publish_blocked`; job lanjut ke post due berikutnya. Post yang lolos baru di-`UPDATE` satu-per-satu ke `published`. Alasan restrukturisasi: tanpa ini, tenant bisa bypass checklist sepenuhnya dengan men-schedule post SEBELUM mengaktifkan mode R2-only (atau sebelum sebuah media diverifikasi ulang), lalu menunggu due — celah kelas yang sama dengan Issue #636's revision-restore bypass. `FOR UPDATE` menjaga job ini tetap aman terhadap dua run konkuren (mis. dua worker instance) untuk tenant yang sama.

Idempoten by construction: post yang sudah `published`, `scheduled_at`-nya masih di masa depan, atau ditinggalkan `scheduled` karena checklist gagal sebelumnya tidak menghasilkan efek baru pada run berikutnya di `now` yang sama. `COALESCE(published_at, now())` memastikan post yang **pernah** published sebelumnya (`published_at` sudah terisi dari histori lama, lalu di-set balik ke `draft`/`scheduled` lewat SQL manual atau endpoint masa depan) tidak kehilangan `published_at` aslinya — doc issue #541 §Scheduled Publishing Rules: "sets published_at=now() only if not already set".

Audit per post yang dipublish: `blog.post.published` (reuse action yang sama dengan `POST .../publish` manual — pembeda `trigger: "scheduled_publish"` hanya ada di structured log, bukan di audit `attributes`). Plus satu event ringkasan per pemanggilan tenant: `blog.post.scheduled_publish_executed` (`attributes.publishedCount`/`blockedCount`) atau `blog.post.scheduled_publish_skipped` (kalau tidak ada yang due sama sekali).

Tidak ada pemanggilan provider eksternal sama sekali di job ini (ADR-0006 tidak relevan di sini — job murni transisi database, tidak ada dispatcher/provider yang perlu dijaga di luar transaction). `mediaPort` bukan provider eksternal — implementasinya (`newsMediaPortAdapter`) hanya membaca dari Postgres yang sama, bukan Cloudflare R2.

## Domain events (AsyncAPI, Issue #541, diperluas Issue #542)

`asyncapi/awcms-domain-events.asyncapi.yaml` — 26 channel untuk `blog_content` (13 dari Issue #541 + 13 dari Issue #542), terdaftar juga di `module.ts`'s `events.publishes` (divalidasi `scripts/api-spec-check.ts`'s `checkModuleEventChannels`: tiap entry `publishes` module manapun wajib punya channel AsyncAPI yang cocok). Sama seperti setiap event lain di kontrak ini sejak Issue 0.3: **dokumentasi kontrak saja** — tidak ada dispatcher pub/sub nyata di repo ini; produser sebenarnya adalah structured JSON logger (`src/lib/logging/logger.ts`'s `log()`), bukan event bus. Konvensi penamaan log line: buang prefix `awcms.` dari event type (`awcms.blog-content.post.published` -> log message `blog-content.post.published`) — pola sama persis `email.message.queued` dkk.

Ke-26 event punya produser nyata di kode saat ini (Issue #543 menutup satu-satunya celah yang tersisa, `settings.updated`):

| Event (AsyncAPI channel, tanpa prefix `awcms.`)       | Log line diemisikan dari                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blog-content.post.created`                           | `pages/api/v1/blog/posts/index.ts` (`POST`)                                                                                                                                                                      |
| `blog-content.post.updated`                           | `pages/api/v1/blog/posts/[id].ts` (`PATCH`)                                                                                                                                                                      |
| `blog-content.post.submitted-for-review`              | `pages/api/v1/blog/posts/[id]/submit-review.ts`                                                                                                                                                                  |
| `blog-content.post.published`                         | `pages/api/v1/blog/posts/[id]/publish.ts` **dan** `blog-content/application/blog-scheduled-publish.ts` (atribut `trigger` membedakan)                                                                            |
| `blog-content.post.scheduled`                         | `pages/api/v1/blog/posts/[id]/schedule.ts`                                                                                                                                                                       |
| `blog-content.post.archived`                          | `pages/api/v1/blog/posts/[id]/archive.ts`                                                                                                                                                                        |
| `blog-content.post.deleted`                           | `pages/api/v1/blog/posts/[id].ts` (`DELETE`)                                                                                                                                                                     |
| `blog-content.post.restored`                          | `pages/api/v1/blog/posts/[id]/restore.ts` (restore soft-delete, **bukan** restore revisi)                                                                                                                        |
| `blog-content.post.purged`                            | `pages/api/v1/blog/posts/[id]/purge.ts`                                                                                                                                                                          |
| `blog-content.revision.created`                       | `blog-content/application/blog-revision-directory.ts`'s `createBlogRevision` — satu titik untuk PATCH signifikan **dan** restore revisi, jadi log line-nya otomatis muncul dari kedua jalur tanpa duplikasi kode |
| `blog-content.term.created`                           | `pages/api/v1/blog/terms/index.ts` (`POST`)                                                                                                                                                                      |
| `blog-content.term.updated`                           | `pages/api/v1/blog/terms/[id].ts` (`PATCH`)                                                                                                                                                                      |
| `blog-content.template.created`/`.updated`/`.deleted` | `pages/api/v1/blog/templates/index.ts` (`POST`), `[id].ts` (`PATCH`/`DELETE`)                                                                                                                                    |
| `blog-content.menu.created`/`.updated`/`.deleted`     | `pages/api/v1/blog/menus/index.ts` (`POST`), `[id].ts` (`PATCH`/`DELETE`)                                                                                                                                        |
| `blog-content.widget.created`/`.updated`/`.deleted`   | `pages/api/v1/blog/widgets/index.ts` (`POST`), `[id].ts` (`PATCH`/`DELETE`)                                                                                                                                      |
| `blog-content.ad.created`/`.updated`/`.deleted`       | `pages/api/v1/blog/ads/index.ts` (`POST`), `[id].ts` (`PATCH`/`DELETE`)                                                                                                                                          |
| `blog-content.theme.updated`                          | `pages/api/v1/blog/theme/index.ts` (`PATCH`) — **beda** dari `settings.updated` di bawah, ini tegas tentang `awcms_blog_theme_settings`, bukan `awcms_blog_settings`                                             |
| `blog-content.settings.updated`                       | `pages/api/v1/blog/settings/index.ts` (`PATCH`, Issue #543) — tentang `awcms_blog_settings`                                                                                                                      |

`checkModuleEventChannels` hanya memvalidasi arah module.ts→AsyncAPI (setiap `publishes` wajib ada channel), bukan sebaliknya — jadi sebelum Issue #543, channel `settings.updated` tanpa produser tidak sempat membuat `api:spec:check` gagal.

## Presentation extensions (Issue #542)

Doc issue #542 sendiri berjudul "Templates, Menus, Widgets, Media/Gallery, Multilingual, Theme Mode, and Ads" dengan §Suggested Files/§Suggested Database Additions/§Suggested Routes eksplisit berlabel **"Suggested"** (beda dari §Routes literal di issue #537-#541) — jadi implementasi ini punya keleluasaan lebih untuk memilih pendekatan paling konsisten dengan arsitektur yang sudah ada, selama Acceptance Criteria tetap terpenuhi. §Important Scope Control issue ini eksplisit: jangan bangun ulang base media library, base tenant system, base RBAC/ABAC, base audit, atau base theme engine.

### Templates, Menus, Widgets, Ads — CRUD penuh

Empat resource ini dibangun sebagai admin CRUD nyata (bukan lightweight), karena masing-masing eksplisit punya §Suggested Routes sendiri di issue dan butuh guard/audit/RLS lengkap:

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

Satu permission `configure` menggerbangi create/update/delete sekaligus (pola sama seperti `blog_content.taxonomies.configure`) — bukan permission per-aksi seperti posts (`.publish`/`.schedule`/dst) karena resource ini adalah master/config data admin, bukan konten dengan lifecycle status. Tidak ada ownership override ABAC — `configure` selalu dicek murni via `authorizeInTransaction`.

### Menus — hierarki satu level, `id` wajib client-supplied

`POST`/`PATCH .../menus(/{id})` menerima `items?: MenuItemEntryInput[]` — **full replace** (delete semua item lama, insert set baru), sama seperti `termIds` di payload post. Karena full-replace berarti id lama sudah hilang di saat baris baru di-insert, `id` tiap item **wajib disuplai klien** (bukan `gen_random_uuid()` DB) — supaya `parentItemId` di payload yang sama bisa merujuk sibling-nya sendiri tanpa perlu tahu id yang di-generate DB terlebih dulu. `domain/menu-policy.ts`'s `validateMenuItemsInput` memvalidasi: id unik dalam batch, `parentItemId` (kalau ada) wajib merujuk item lain di batch yang sama, dan nesting maksimal satu level (item dengan `parentItemId` yang parent-nya sendiri juga punya parent → ditolak) — batas yang sama seperti kategori/tag di `taxonomy-policy.ts`.

`linkType` (`post|page|url`) menggerbangi field mana yang wajib: `post`/`page` butuh `targetId` (UUID, **tidak** dicek eksistensinya terhadap tabel posts/pages — konsisten dengan `termIds`' pola "shape only, existence check kalau perlu request DB tambahan," yang di sini sengaja dilewati karena menu bisa menunjuk resource yang belum ada saat menu-nya sendiri dibuat), `url` butuh URL http(s) absolut (`isAbsoluteHttpUrl`, sama seperti `canonicalUrl`).

### Widgets — posisi tetap, body plain text

`position` salah satu dari `header|sidebar|footer|content_before|content_after` (constraint DB + `domain/widget-policy.ts`). `bodyText` bukan `content_json` — plain text, direject (bukan disanitasi) kalau mengandung pola HTML tidak aman (`content-validation.ts`'s `containsUnsafeHtml`, baru diekspor issue ini). Rendering publik widget (kalau/ketika dibangun) wajib escape `bodyText`, sama seperti block renderer content_json — belum ada rute publik untuk widget di issue ini.

### Ads — placement targeting + scheduling

`imageUrl`/`linkUrl` wajib URL http(s) absolut — tidak ada field embed/iframe/raw-HTML sama sekali di skema, jadi rendering (`ads-directory.ts`'s `renderAdHtml`, whitelist `<img>`/`<a>` saja) **tidak bisa** jadi kanal XSS apa pun isi request-nya. `placements` (full replace, sama seperti `menu items`) menautkan satu ad ke `global`/`widget`/`post`/`page`; `targetId` wajib untuk tiga terakhir, terlarang untuk `global`. Scheduling: `startsAt`/`endsAt` opsional, `endsAt` wajib > `startsAt` kalau keduanya ada.

`listActiveAdsForPlacement` (query publik-aman: `is_active=true` + jendela jadwal + tenant scope) dan `renderAdHtml` sudah tersedia dan diuji, tapi **belum dipasang ke rute mana pun** — precedent yang sama seperti `searchPublicBlogContent` di Issue #539 ("helper teruji, pemasangannya issue lain").

**Catatan (Issue #638, epic `news_portal`)**: sistem ads di atas TETAP TIDAK BERUBAH dan tetap berlaku untuk `image_url` bebas URL http(s) — `news_portal` epic menambah sistem ad placement TERPISAH yang R2-only (`awcms_news_portal_ad_placements`, dimiliki modul `news_portal`, bukan modul ini) untuk tenant full-online-R2 yang butuh gambar iklan berasal dari objek media R2 terverifikasi, bukan URL bebas. Lihat `.claude/skills/awcms-news-portal/SKILL.md` §638 dan `src/modules/news-portal/README.md`.

### Theme mode — override tenant, bukan engine baru

`GET`/`PATCH /api/v1/blog/theme` membaca/menulis `awcms_blog_theme_settings` (satu baris per tenant). `GET` tanpa baris override mengembalikan `{ mode: <tenant.default_theme>, isOverride: false }` — base theme engine (`awcms_tenants.default_theme`, migration 002) tetap satu-satunya sumber kebenaran default; tabel blog ini murni lapisan override opsional, sama sekali tidak menduplikasi logic tenant.

### Multilingual — kolom link tipis, bukan endpoint baru

Persyaratan inti ("locale-based storage/retrieval", "slug uniqueness tenant+locale aware") **sudah terpenuhi sejak Issue #537** lewat kolom `locale` + partial unique index `(tenant_id, locale, slug)` yang sudah ada di posts/pages — issue ini tidak mendesain ulang itu. Yang baru: kolom `translation_group_id` (nullable, tanpa FK/trigger) supaya beberapa varian-locale dari satu post logis bisa ditautkan. Diimplementasikan sebagai fungsi berdiri sendiri (`localized-content-directory.ts`'s `setPostTranslationGroup`/`fetchPostTranslations`) yang dipanggil dari `POST`/`PATCH /api/v1/blog/posts(/{id})` **setelah** `createBlogPost`/`updateBlogPost` sukses — **bukan** ditambahkan ke `INSERT`/`UPDATE`/`RETURNING` `blog-post-directory.ts` yang sudah ada, karena kolom itu disentuh di 7+ tempat berbeda di file itu; satu `UPDATE` sempit yang independen jauh lebih rendah risiko daripada bedah ulang setiap `RETURNING` clause di file yang sudah teruji sejak Issue #538. Hanya posts, tidak pages (scope-control: cukup satu jalur untuk membuktikan pola-nya bekerja).

### Media/Gallery — block `content_json` baru, bukan tabel media

Doc issue #542 eksplisit: "Do not rebuild the base media library... Integrate with existing media/file capability where available." Base repo ini **tidak punya** media library nyata — `featuredMediaId` di posts/pages (Issue #538) cuma UUID longgar tanpa FK, tervalidasi bentuknya saja. Karena tidak ada yang nyata untuk diintegrasikan, galeri diimplementasikan sebagai tipe block baru di whitelist renderer yang sudah ada (`content-block-rendering.ts`, lihat §Content block schema di §Public routes): `{ type: "gallery", items: GalleryItem[] }`, tiap item `{ mediaType: "image"|"video", url, caption? }`. `url` divalidasi `isAbsoluteHttpUrl` saat render (defense-in-depth yang sama seperti `canonicalUrl`); item gagal validasi di-skip diam-diam (bukan throw). Render hanya `<img>`/`<video controls>` — tidak ada `<iframe>`/embed. Tidak ada endpoint/tabel gallery terpisah — galeri adalah bagian dari `content_json` post/page yang sudah ada, ditulis lewat `PATCH` yang sudah ada juga.

**Update Issue #636** (epic `news_portal`, di luar epic #536): paragraf di atas tetap akurat untuk deployment non-R2-only (mayoritas hari ini). Ketika full-online R2-only mode aktif untuk tenant pemanggil, `featuredMediaId` dan item gallery `mediaType: "image"` WAJIB mereferensikan baris `verified`/`attached` di media registry `news_portal` (Issue #633) — item `mediaType: "video"` dan seluruh perilaku non-R2-only tidak berubah. Tetap **bukan** media library baru di `blog_content` — lihat `.claude/skills/awcms-news-portal/SKILL.md` §636 untuk detail lengkap.

**Update Issue #637** (epic `news_portal`): `public-blog-directory.ts`'s `PublicBlogPostSummary` (listing/archive/homepage-composer queries — sebelumnya hanya `PublicBlogPostDetail`, single-post-by-slug, punya `featuredMediaId`) sekarang juga menyertakan `featuredMediaId`, supaya `news_portal`'s homepage section composer bisa menampilkan gambar unggulan post di kartu ringkasan tanpa query terpisah. Tidak ada perubahan skema/validasi `blog_content` sendiri di sini — murni menambah satu kolom ke SELECT yang sudah ada.

## Settings API (Issue #543)

`GET`/`PATCH /api/v1/blog/settings` (`src/pages/api/v1/blog/settings/index.ts`) — akhirnya mengaktifkan `awcms_blog_settings` (migration 026, satu baris per tenant, `tenant_id` = PK) yang sejak Issue #537 sudah ada di schema tapi tidak punya route. Tidak ada `{id}` di path — sama seperti `PATCH /api/v1/blog/theme`, satu baris per tenant.

```txt
GET   /api/v1/blog/settings   -> blog_content.settings.read
PATCH /api/v1/blog/settings   -> blog_content.settings.configure
```

Field: `defaultLocale`/`defaultVisibility`/`postsPerPage`/`seoDefaultTitle`/`seoDefaultDescription` sudah punya kolom typed sendiri sejak migration 026 (dipakai juga oleh `fetchPublicBlogSettings`, Issue #540, untuk `posts_per_page` pagination publik). `blogTitle`/`blogDescription`/`rssEnabled`/`sitemapEnabled` **tidak** punya kolom sendiri — di luar scope issue ini menambah kolom baru — jadi disimpan di kolom catch-all `settings jsonb` yang tabel itu sudah punya (shallow-merge, bukan replace, sama semantik `updateModuleSettings`). `PATCH` partial-update (hanya field yang dikirim yang divalidasi/ditulis, `domain/blog-settings-policy.ts`'s `validateUpdateBlogSettingsInput`), publish `blog-content.settings.updated` (menutup celah yang README §Domain events sebelumnya catat: channel-nya sudah terdaftar sejak Issue #541 tapi belum ada produsen sampai sekarang) dan audit `blog.settings.updated`.

### RSS/sitemap sekarang menghormati `rssEnabled`/`sitemapEnabled`

`GET /blog/{tenantCode}/feed.xml` dan `.../sitemap-blog.xml` (Issue #540) memanggil `fetchBlogSettings` di awal handler dan mengembalikan `404` yang identik dengan tenant-tidak-ditemukan kalau flag terkait `false` — tenant yang mematikan RSS/sitemap tidak membocorkan sinyal "fitur ini ada tapi dimatikan" vs "tenant ini tidak ada", konsisten dengan ADR-0009's "jangan bocorkan keberadaan tenant" yang sudah diterapkan §Public routes.

## Admin UI (Issue #543)

Seluruh layar di bawah `/admin/blog` (`src/pages/admin/blog/`), memakai `AdminLayout`/design token yang sudah ada (`docs/awcms/14_ui_ux_design_system.md`), Astro + vanilla JS saja — tidak ada framework UI baru. Pola tiap layar identik `admin/modules/[moduleKey].astro`/`admin/access-users.astro` (referensi yang sudah ada sebelum issue ini): SSR read lewat fungsi application-layer yang sama yang dipakai (atau bisa dipakai) endpoint JSON, seluruh mutasi lewat `fetch()` client-side ke endpoint `/api/v1/blog/...` yang sudah ter-guard/audit/idempotency sejak Issue #538-#542 — halaman admin **tidak pernah** menulis ke database langsung atau melewati guard ABAC endpoint. Permission-gated per-section, mengikuti persis guard endpoint yang mendasarinya (defense-in-depth; enforcement sebenarnya tetap di server).

```txt
/admin/blog                    -> dashboard (ringkasan post/draft/scheduled/pages, quick link)
/admin/blog/posts              -> daftar post (search, filter status, filter kategori/tag, pagination)
/admin/blog/posts/new          -> editor post baru
/admin/blog/posts/[id]         -> editor post (edit, lifecycle action, revision history)
/admin/blog/pages              -> daftar halaman statis (search, filter status/type, pagination)
/admin/blog/pages/new          -> editor halaman baru
/admin/blog/pages/[id]         -> editor halaman (edit saja — tidak ada lifecycle action/revision UI)
/admin/blog/categories         -> manajer kategori (hierarki, slug conflict terlihat)
/admin/blog/tags               -> manajer tag (TIDAK ada field parent sama sekali)
/admin/blog/settings           -> form pengaturan blog + mode tema
/admin/blog/templates          -> manajer template (opsional, Issue #542)
/admin/blog/widgets            -> manajer widget (opsional, Issue #542)
/admin/blog/menus              -> manajer menu (opsional, Issue #542)
/admin/blog/ads                -> manajer iklan (opsional, Issue #542)
```

Navigasi sidebar: satu entry `/admin/blog` di `module.ts`'s `navigation` array (label `admin.layout.nav_blog`, guard `blog_content.posts.read`), dirender otomatis oleh `AdminLayout.astro` lewat `fetchVisibleModuleNavigationEntries` (Issue #518) yang sudah ada — bukan ditambahkan hardcode ke `AdminLayout.astro`. Sub-navigasi antar layar `/admin/blog/*` memakai quick-link biasa di dashboard/tiap layar (repo ini tidak punya konvensi sidebar bertingkat).

### Post editor — pemetaan field ke API

`content` dipecah jadi dua field terpisah, sama seperti bentuk data `awcms_blog_posts` sendiri: `contentText` (textarea polos, wajib) dan `contentJson` (textarea JSON berlabel, default `{"blocks":[]}`, divalidasi `JSON.parse` di klien sebelum submit + `validateContentJsonField` di server) — bukan rich-text/block editor baru (`content_json`'s schema sejak Issue #540 hanya 4+1 tipe block, `paragraph`/`heading`/`list`/`quote`/`gallery`; membangun editor visual untuk itu di luar proporsi issue ini). "Category" dan "Tags" dirender sebagai dua `<select multiple>` terpisah (difilter dari term list yang sama by `taxonomyType`) tapi digabung jadi satu array `termIds` saat submit — API sendiri tidak membedakan kategori vs tag di dalam `termIds`.

Lifecycle action (`submit-review`/`publish`/`schedule`/`archive`/`restore`/`purge`) masing-masing dirender hanya kalau `isValidStatusTransition`/`canRestorePost`/`canPurgePost` (fungsi murni yang sama yang dipakai endpoint) mengizinkan transisi itu dari status post saat ini **dan** caller memegang permission aksi itu — cek ini UI-nicety saja, endpoint tetap re-validasi identik. Publish/schedule/archive/restore/purge semuanya: `window.confirm` dulu, lalu `Idempotency-Key` baru (`crypto.randomUUID()`, `lib/ui/admin-form-client.ts`'s `newIdempotencyKey`) per percobaan. Revision history (`blog_content.revisions.read`) menampilkan tabel revisi + tombol "Restore" per baris (`blog_content.revisions.restore`, guard eksplisit terpisah — TIDAK ada ownership override, sama seperti endpoint-nya), juga confirm dulu.

Field "author" (post list + editor) diresolusi lewat `author-lookup.ts`'s `fetchAuthorDisplayNames`, bukan `identity-access`'s user-directory penuh (lihat §Application untuk alasannya).

### Page editor — tanpa lifecycle, tanpa revision UI

Sengaja tidak ada tombol status/publish sama sekali — `UpdateBlogPageInput` tidak punya field `status` (README §Admin API — Blog Pages: page selalu `draft` sejak dibuat, tidak ada endpoint yang mengubahnya). Tidak ada panel revision history untuk page juga — `createBlogRevision` tetap terpanggil dari `PATCH /api/v1/blog/pages/{id}` (baris tersimpan di `awcms_blog_revisions`), tapi tidak ada rute `GET .../revisions` untuk `resource_type='page'` yang bisa dipanggil UI ini (lihat §Belum tersedia — backlog issue lain, bukan sesuatu yang bisa "ditambahkan" cukup dari sisi UI).

### Category/Tag manager — pemisahan file yang disengaja

`admin/blog/categories.astro` dan `admin/blog/tags.astro` adalah dua file terpisah (bukan satu layar param `?type=`) justru supaya larangan "tag tidak boleh punya parent" bisa ditegakkan secara struktural di level markup — `tags.astro` tidak pernah merender elemen form `parentId` sama sekali (bukan field yang disembunyikan lewat kondisi), jadi tidak ada jalur UI yang bisa mengirim `parentId` untuk tag. Keduanya memanggil `/api/v1/blog/terms` yang sama, hanya body `taxonomyType` yang beda. Slug conflict (`409 SLUG_CONFLICT`, tidak ada entry i18n khusus) tampil apa adanya dari pesan server via action banner — sama seperti setiap kode error tak-terpetakan lain di admin UI.

### Templates/Widgets/Ads/Menus — sub-array kompleks via JSON textarea berlabel

`layoutJson` template cukup sederhana (`{columns, sidebarPosition}`) untuk dua `<select>` biasa. `items` menu dan `placements` ads jauh lebih kompleks (array objek, dan `menu items` butuh id ber-UUID client-supplied yang saling mereferensi dalam satu payload, lihat README §Menus) — membangun editor tree/drag-drop khusus untuk itu di luar proporsi anggaran issue ini dan tetap harus menghasilkan bentuk JSON yang sama persis. Kedua form itu memakai textarea JSON berlabel + teks bantuan, pola yang sama seperti `admin/modules/[moduleKey].astro`'s settings panel sudah pakai untuk config terstruktur — tombol "Copy new id" di layar menu menyalin `crypto.randomUUID()` baru ke clipboard (bukan menyisipkannya ke textarea, supaya tidak pernah merusak JSON yang sedang diedit).

### Theme mode masuk ke Settings, bukan layar sendiri

`GET`/`PATCH /api/v1/blog/theme` (Issue #542) digabung ke `/admin/blog/settings` sebagai section tambahan, bukan `/admin/blog/theme` terpisah — ini konfigurasi tenant-wide sekelas field lain di layar itu, dan daftar layar issue #543 sendiri tidak menyebut layar theme terpisah.

### Yang sengaja di-skip: layar Media/Gallery murni

Issue #543's daftar layar opsional menyebut "Media/Gallery" — di-skip sebagai layar tersendiri karena tidak ada media library nyata untuk dikelola (README §Media/Gallery — Issue #542: galeri adalah bagian dari block `content_json`, bukan tabel/endpoint media terpisah). Mengelola galeri berarti mengedit array block `gallery` di dalam `contentJson` post/page — sudah bisa dilakukan lewat textarea `contentJson` yang ada di post/page editor, tidak butuh layar terpisah.

### Aksesibilitas dan UX (doc 14)

Setiap layar admin punya empat state eksplisit — loading (SSR, bukan spinner klien), empty (`p.empty-state`/pesan "belum ada ..."), error (`StateNotice kind="error"` dengan retry-link, dipisah dari `kind="denied"` untuk permission), dan ready (konten). Setiap aksi mutasi men-disable tombol submit-nya sendiri selama request in-flight (`lib/ui/admin-form-client.ts`'s `lockElement`, `aria-busy="true"`) supaya klik ganda/double-Enter tidak pernah mengirim dua request — bukan pengganti idempotency server-side, keduanya berlapis. Aksi high-risk (publish/schedule/archive/restore/purge/delete/purge-config/revision-restore) selalu `window.confirm` dulu. Semua `<label>` terasosiasi eksplisit dengan input-nya (markup `<label>teks<input/></label>`, bukan `aria-label` terpisah, kecuali untuk kontrol icon-only yang memang tidak punya teks visual). Fokus keyboard terlihat lewat `:focus-visible` (bukan `:focus` polos, supaya klik mouse tidak memicu outline yang tidak perlu) di setiap file `<style>` layar. Semua string tampil lewat `t()` (katalog `.po` gettext, `en`+`id`, lihat §Internationalization).

### Internationalization

Seluruh string UI (~300 key baru, namespace `admin.blog.*`) ditambahkan ke `i18n/en.po` **dan** `i18n/id.po` (skill `awcms-i18n`, katalog gettext flat `namespace.key` di root `i18n/`, bukan per-modul) — tidak ada string hardcoded di file `.astro`. Client `<script>` tidak bisa membaca katalog `.po` langsung (server-only, `Bun.file`), jadi tiap layar menyuntikkan string yang sudah diterjemahkan lewat blob `<script type="application/json" id="i18n-strings">` (`readClientStrings()`), pola yang sama seperti `admin/access-users.astro`/`admin/modules/[moduleKey].astro` sudah pakai. `admin.layout.nav_blog` (label sidebar) dan beberapa `common.*` (`filter_all`/`previous_page`/`next_page`) baru — sisanya (`common.error_title`, `common.network_error`, dst.) memakai ulang key yang sudah ada.

### Security notes (ringkasan Issue #543)

- Tidak ada secret hardcoded ditambahkan — layar admin ini murni UI + panggilan ke endpoint yang sudah ada; tidak ada koneksi database langsung dari klien, tidak ada token/API key baru.
- Tidak ada eksposur PostgreSQL publik — semua akses data tetap lewat `withTenant`/aplikasi backend yang sudah ada, SSR read di frontmatter Astro berjalan server-side (sama seperti `admin/index.astro`/`admin/sync.astro` yang sudah ada sebelum issue ini).
- Least-privilege runtime DB access — tidak berubah; halaman admin tetap terikat koneksi role `awcms_app` yang sama yang dipakai seluruh app (lihat `docs/awcms/18_configuration_env_reference.md`).
- RLS isolation — diuji ulang eksplisit di `tests/integration/blog-content-admin-ui.integration.test.ts` untuk dua fungsi baru (`listBlogPostsForAdmin` tenant-isolation test); fungsi lain yang dipanggil layar admin (`listBlogPages`, `listBlogTerms`, dst.) sudah punya cakupan RLS dari test suite Issue #538-#542.
- Aksi admin high-risk wajib confirm + audit — lifecycle action posts sudah audit sejak Issue #538/#541 (`recordAuditEvent`, action `blog.post.<verb>`); layar admin menambah lapisan `window.confirm` di atasnya, tidak menggantikannya.
- Rendering publik tetap aman dari XSS — tidak diubah oleh issue ini; `content_json`/`content_text`/widget `bodyText`/ad `imageUrl`/`linkUrl` tetap lewat whitelist renderer yang sama (`content-block-rendering.ts`, `ads-directory.ts`'s `renderAdHtml`). Editor admin (`contentJson` textarea) mengizinkan penulis mengetik apa pun, tapi validasi server (`validateContentJsonField`'s `containsUnsafeHtml`) tetap menolak `<script>`/`<iframe>`/`<embed>`/`<object>`/inline handler/`javascript:` sebelum tersimpan — editor tidak melonggarkan aturan itu.
- Pesan error tidak membocorkan stack trace — action banner admin selalu menampilkan `error.message` dari respons API (yang sendiri sudah aman, doc 10) atau string generik `common.network_error`, tidak pernah `error.stack`/exception mentah dari `console.error` (yang hanya dicatat server-side).

### Testing commands

```bash
bun run db:migrate                     # skema tidak berubah di issue ini (0 applied, 30 skipped)
bun run api:spec:check                 # OpenAPI/AsyncAPI baseline (26 channel blog-content, semua terpakai)
bun run typecheck                      # tsc --noEmit, termasuk seluruh .astro admin/blog/*
bun test                               # unit + integration; DATABASE_URL wajib untuk suite integration
bun test tests/integration/blog-content-admin-ui.integration.test.ts  # test baru khusus Issue #543
bun run build                          # Astro build, termasuk seluruh layar admin/blog/*
bun run check                          # lint + check:docs + api:spec:check + typecheck + test + build
bun run production:preflight           # gate go-live penuh (lihat §Known limitations soal env sandbox)
```

### Operational checklist (Issue #543)

- [ ] Sebelum deploy: `bun run db:migrate` (idempoten, aman dijalankan berkali-kali).
- [ ] `bun run check` hijau di CI sebelum merge.
- [ ] Setelah deploy, verifikasi manual: login sebagai role dengan `blog_content.posts.read` -> `/admin/blog` tampil di sidebar -> buat post draft -> publish -> cek muncul di `/blog/{tenantCode}` (kalau visibility `public`).
- [ ] Verifikasi `rssEnabled`/`sitemapEnabled` di `/admin/blog/settings`: matikan salah satu -> `feed.xml`/`sitemap-blog.xml` tenant itu mengembalikan 404.
- [ ] `bun run blog:publish:scheduled` tetap dijadwalkan cron/systemd timer terpisah (Issue #541, tidak berubah oleh issue ini) — bukan dipicu dari UI mana pun.
- [ ] Audit log (`/admin` -> module audit summary atau `GET /api/v1/logs/audit`) menunjukkan `blog.post.*`/`blog.settings.updated` setelah aksi lifecycle/settings dari UI baru ini.

## Belum tersedia (backlog eksplisit, bukan kelalaian)

- Public page (halaman statis) rendering — hanya post yang punya rute publik di Issue #540, lihat §Public routes.
- Page revision list/detail/restore endpoints — `createBlogRevision` sudah dipanggil dari `PATCH /api/v1/blog/pages/{id}` (baris tersimpan), tapi tidak ada rute baca/restore untuk `resource_type = 'page'`, hanya post (lihat §Revisions). Admin UI (§Admin UI di atas) karena itu juga tidak punya panel revision untuk page.
- Rute publik untuk widget/ads rendering (header/sidebar/footer placement nyata di halaman publik) — `listActiveAdsForPlacement`/`renderAdHtml`/`listWidgets({ activeOnly: true })` sudah ada dan teruji, belum dipasang ke rute publik manapun.
- Rute revisi/`translationGroupId` untuk pages — `setPostTranslationGroup` hanya untuk posts di issue ini.
- Page lifecycle-action endpoints (`submit-review`/`publish`/`schedule`/`archive`/`restore`/`purge` untuk pages) — permission-nya sudah diseed (Issue #537) tapi tidak ada issue yang eksplisit membangun endpoint-nya; backlog terbuka, bukan bagian #539. Konsekuensinya, editor page (§Admin UI) juga tidak punya tombol status apa pun.
- Optimistic-concurrency check yang membaca kolom `version` — kolom sudah di-increment tiap write, tapi belum ada endpoint yang menolak write berdasarkan `version` mismatch.
- Search relevance ranking (`ts_rank`) dan text search config per-locale (`english`/`indonesian`) — `search_vector` sudah weighted (A/B/C) untuk kebutuhan ini di masa depan, tapi `GET /api/v1/blog/search` (admin) dan search publik saat ini hanya mengurutkan `created_at DESC`.
- Locale-aware negotiation untuk pengunjung publik (mis. header `Accept-Language`) — index/detail publik saat ini menampilkan semua post tanpa filter locale; `<html lang>` memakai locale post/tenant, bukan preferensi pengunjung.
- `robots.txt` dan referensi sitemap dari `robots.txt` — hanya sitemap XML-nya sendiri yang ada, belum ada yang mereferensikannya secara otomatis.
- Rich block editor visual untuk `content_json` — admin UI (Issue #543) memakai textarea JSON berlabel untuk `contentJson`/menu items/ad placements, bukan editor visual/drag-drop; membangun itu tetap backlog terbuka kalau suatu saat dianggap perlu.
- Layar admin murni untuk media/gallery — tidak ada (dan tidak akan ada tanpa base media library nyata); galeri dikelola lewat block `content_json` di editor post/page yang ada.
- `publicBasePath` (Issue #564) hanya mengubah URL yang DIHASILKAN (canonical link, RSS/sitemap, cross-link internal) — path fisik yang benar-benar dilayani Astro untuk `/news/**` tetap tetap di `/news` (file-based static routing, lihat §Public route settings §`publicBasePath`). Membuat path fisik itu sendiri bisa dikonfigurasi per-tenant (catch-all dynamic route) tetap backlog terbuka, di luar scope issue ini.
- Visual settings editor khusus untuk `publicRouteMode`/`publicBasePath`/`legacyTenantRouteEnabled`/`publicLabel` (Issue #564) — sengaja tidak dibangun; layar generik `/admin/modules/blog_content` (Module Management, sudah ada) cukup untuk mengedit keempat key ini lewat JSON textarea yang sudah ada.
