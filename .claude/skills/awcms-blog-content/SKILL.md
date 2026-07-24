---
name: awcms-blog-content
description: Modul blog_content SUDAH di-port ke repo ini (PR #214; `src/modules/blog-content`, migrasi `sql/035`–`sql/040`, 15 tabel `awcms_blog_*` FORCE RLS). Panduan untuk MENGUBAH/menambah ke `src/modules/blog-content`, `src/pages/blog`, mengubah schema blog, atau mengerjakan issue susulan. CATATAN adaptasi awcms (beda dari spesifikasi mini di bawah): rute publik PATH-based `/blog/{tenantCode}` (ADR-0009), BUKAN `/news/**` host-resolved (itu butuh `tenant_domain`, belum di-port dan DI-DROP saat port); capability media kini `media_library` (INVERSI ADR-0036 — dulu `news_media` dari news_portal; kini modul `media_library` sendiri, adapter NYATA `mediaLibraryPortAdapter`, method `isManagedMediaEnforcementActiveForTenant`); hook `social_publishing` masih no-op (modul itu belum di-port); admin UI blog (`src/pages/admin/blog`) TIDAK di-port. Nomor `sql/NNN` di badan skill memakai penomoran awcms-mini — migrasi nyata di awcms adalah `sql/035`–`sql/040` (lihat README modul + `sql/` nyata). Gunakan saat menambah endpoint/logic blog, mengubah schema, atau issue lanjutan.
---

# AWCMS — Blog Content Module

<!-- sql-refs: awcms-mini — nomor `sql/NNN` di badan skill ini memakai penomoran awcms-mini; modul SUDAH di-port ke awcms sebagai `sql/035`–`sql/040` (lihat README modul + `sql/` nyata untuk nomor sebenarnya) -->

> **STATUS — SUDAH di-port ke repo ini (PR #214).**
> `blog_content` kini nyata di sini: `src/modules/blog-content`, migrasi
> `sql/035_awcms_blog_content_schema.sql`–`sql/040_awcms_blog_content_internal_tag_links_permissions.sql`,
> 15 tabel `awcms_blog_*` (semua `FORCE ROW LEVEL SECURITY`). Skill ini kini
> **panduan mengubah/menambah kode nyata**, bukan spesifikasi target port.
> Baca `src/modules/blog-content/README.md` + `sql/` untuk detail nomor/tabel
> yang akurat.
>
> **DELTA PORT AWCMS (beda dari spesifikasi mini di badan skill — WAJIB diperhatikan):**
>
> - Rute publik **path-based `/blog/{tenantCode}`** (ADR-0009): index, detail,
>   arsip kategori/tag, search, RSS `feed.xml`, `sitemap-blog.xml`. Keluarga
>   rute **host-resolved `/news/**` TIDAK di-port** (butuh modul `tenant_domain`
>   yang belum ada) — jangan bangun/rujuk `/news/**` sebagai ada di sini.
> - Capability `news_media` kini **adapter NYATA** (`news_portal` sudah di-port,
>   PR #214) — bukan lagi no-op. Hook `social_publishing` **masih no-op**
>   (`social_publishing` belum di-port).
> - **Admin UI blog (`src/pages/admin/blog`) TIDAK di-port** — base ini hanya
>   punya layar admin yang sudah ada di `src/pages/admin/*`. Modul blog di sini
>   API-first + rute publik.
> - Blok konten `video_news` (YouTube iframe) ter-render tapi diblokir CSP
>   sampai deployment menambah `frame-src` sendiri (jaminan "zero third-party
>   CSP origin" tidak dilonggarkan) — lihat header `_shared/rendering/video-news-block-renderer.ts`.
> - Nomor `sql/NNN` di badan skill = penomoran awcms-mini; nyata di awcms
>   `sql/035`–`sql/040`.

`blog_content` (`src/modules/blog-content`) adalah **modul domain pertama
yang didaftarkan langsung di repo base ini** (epic #536, bukan di aplikasi
turunan terpisah — lihat `AGENTS.md` §Peta modul dan
`docs/adr/0009-public-tenant-scoped-routes.md`). Epic #536 (Issue #537-#543)
**sudah selesai** — modul terdaftar `status: "active"` (bukan lagi
`experimental`). Skill ini merangkum keputusan yang sudah dibuat supaya
issue susulan (di luar epic ini) **wajib** memakai ulang, bukan
mendesain ulang — baca `src/modules/blog-content/README.md` untuk detail
lengkap tiap tabel dan endpoint.

## Kapan pakai skill ini vs skill generik

Skill ini melengkapi (bukan menggantikan) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-testing`, dll. — itu tetap dipakai
untuk cara **membangun** endpoint/migration/test. Skill ini menyediakan
konteks **domain blog_content spesifik** yang tidak jelas dari sekadar
membaca satu file migration.

## Status per issue (jangan bangun ulang yang sudah ada)

| Issue | Scope                                                     | Status                                                                           |
| ----- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| #537  | Schema, domain validation, permission seed                | **Selesai** (migration 026/027)                                                  |
| #538  | Admin API + lifecycle actions (posts)                     | **Selesai** (`/api/v1/blog/posts`, lihat README)                                 |
| #539  | Pages, taxonomi, post-term relation, search               | **Selesai** (`/api/v1/blog/pages`, `/terms`, `/search`)                          |
| #540  | Rute publik, RSS, sitemap, SEO                            | **Selesai** (`/blog/{tenantCode}/...`, lihat README)                             |
| #541  | Revisions + scheduled publishing + AsyncAPI               | **Selesai** (`/posts/{id}/revisions`, `blog:publish:scheduled`, lihat README)    |
| #542  | Template/menu/widget/media/multilingual/ads               | **Selesai** (`/templates`, `/menus`, `/widgets`, `/ads`, `/theme`, lihat README) |
| #543  | Admin UI, blog settings API, dokumentasi akhir, hardening | **Selesai** (14 layar `/admin/blog/...`, `/api/v1/blog/settings`, lihat README)  |

**Di luar epic #536 — TAPI DI-DROP saat port ke awcms (lihat DELTA PORT di
atas):** di awcms-mini `blog_content` juga punya rute publik kedua `/news/...`
(Issue #560, epic #555 "online public tenant routing"). Rute `/news/**` itu
**TIDAK di-port ke awcms** karena butuh modul `tenant_domain` (resolusi tenant
via custom-domain) yang belum ada di sini — jangan bangun/rujuk `/news/**`
sebagai ada. Rute publik yang NYATA ada di awcms hanya `/blog/{tenantCode}`
(ADR-0009, epic #536). Bagian bawah skill ini yang membahas `/news`/resolusi
lintas-mode adalah spesifikasi awcms-mini, bukan kode awcms.

**Juga di luar epic #536**: Issue #636 (epic `news_portal` #631-#642/#649)
menambah validasi KONDISIONAL — hanya aktif ketika full-online R2-only
mode aktif UNTUK TENANT PEMANGGIL (`isNewsPortalFullOnlineR2ModeActiveForTenant`,
`application/news-portal-r2-mode-gate.ts`) — yang mewajibkan
`featuredMediaId` dan item gallery bertipe image mereferensikan baris
`verified`/`attached` di media registry `news_portal` (#633), bukan lagi
UUID/URL bebas TANPA verifikasi. **Rule #18 di bawah ("tidak ada base
media library") TETAP BENAR untuk mode non-R2-only** (mayoritas
deployment hari ini) — hanya mode R2-only yang menambah lapisan
verifikasi di atasnya, bukan mengganti aturan itu. Detail teknis lengkap
(file baru, og:image, resolusi render-time) ada di
`.claude/skills/awcms-news-portal/SKILL.md` §636 — baca DI SANA
sebelum menyentuh `featuredMediaId`/gallery lagi, jangan re-derive di
sini.

**Juga di luar epic #536**: Issue #640 (content quality checklist preview)
menambah `GET /api/v1/blog/posts/{id}/quality-checklist` dan
`GET /api/v1/blog/pages/{id}/quality-checklist` — endpoint baca-saja,
menghitung sinyal kualitas konten (mis. panjang judul/excerpt, kelengkapan
SEO) dari data yang sudah ada, tidak menulis apa pun, tidak ada permission
baru di luar `<posts|pages>.read` yang sudah ada.

**Juga di luar epic #536**: Issue #641 (automatic internal tag linking)
menambah transform render-time yang menautkan nama tag yang cocok di body
post published ke URL arsip tag-nya — lihat `domain/internal-tag-linking*.ts`,
`application/internal-tag-link-*.ts`, migration `sql/052` (tabel
`awcms_blog_internal_tag_link_settings`, per-tenant policy), gated
deployment-wide config `BLOG_AUTO_INTERNAL_TAG_LINKS_*` + kolom per-post
`auto_internal_tag_links_disabled` (opt-out). Endpoint baru:
`GET/PATCH /api/v1/blog/internal-tag-links/settings` (policy tenant),
`GET /api/v1/blog/posts/{id}/internal-links/preview` (preview read-only,
permission `preview` — bukan `configure`, lihat aturan §Rule pada skill
`awcms-abac-guard` untuk kenapa `preview` dipisah dari `configure`).
Admin UI: `src/pages/admin/blog/internal-tag-links.astro` (layar ke-15).

## Yang sudah ada — pakai ulang, jangan re-derive

- **Tabel** (migration `026_awcms_blog_content_schema.sql`): `awcms_blog_posts`, `_pages`, `_terms`, `_post_terms`, `_revisions` (append-only), `_redirects`, `_settings` (1 row/tenant, `tenant_id` = PK). Semua `ENABLE`+`FORCE ROW LEVEL SECURITY`, tanpa `GRANT` eksplisit (migration 013's `ALTER DEFAULT PRIVILEGES` sudah meng-cover). Migration `028` (Issue #539) mengubah `search_vector` di posts/pages jadi `GENERATED ALWAYS ... STORED` (weighted title/excerpt/content_text, config `simple`) — PostgreSQL sendiri yang menjaganya sinkron, tidak ada trigger/application code. Migration `029` (Issue #542) menambah `awcms_blog_templates`, `_menus`+`_menu_items`, `_widgets`, `_ads`+`_ad_placements`, `_theme_settings` (semua RLS FORCE juga) plus kolom `translation_group_id` di posts/pages — lihat README §Presentation extensions untuk detail tiap tabel.
- **Permission seed** (migration `027`, `030`): 26 permission `blog_content.<posts|pages|taxonomies|revisions|settings|seo|search>.<action>` dari migration 027, plus 10 permission `<templates|menus|widgets|ads|theme>.<read|configure>` dari migration 030 (Issue #542) — kalau endpoint baru butuh permission di luar daftar ini, itu berarti scope-nya salah atau butuh migration permission baru, bukan improvisasi module_key/activity_code baru.
- **Domain validation** (`src/modules/blog-content/domain/`): `content-validation.ts` (field inti + penolakan HTML tak aman via `containsUnsafeHtml`, diekspor sejak #542 + `validateDeleteReasonInput` bersama, dipakai ulang oleh create/update/delete post/page/term/widget), `post-status.ts` (`isValidStatusTransition`, `canRestorePost`, `canPurgePost`), `page-type.ts` (`isPageType`), `slug-policy.ts`, `seo-validation.ts` (`isAbsoluteHttpUrl`, dipakai ulang untuk URL menu/ad), `taxonomy-policy.ts` (`validateTermParent`), `content-access-policy.ts` (`evaluateContentUpdateAccess` — logic ABAC ownership generik, lihat di bawah), `post-access-policy.ts`/`page-access-policy.ts` (thin wrapper resource-specific), `blog-post-validation.ts`, `blog-page-validation.ts`, `blog-term-validation.ts`, `revision-policy.ts` (`isSignificantContentChange`), `template-policy.ts`/`menu-policy.ts`/`widget-policy.ts`/`ad-policy.ts`/`theme-policy.ts` (Issue #542). **Panggil fungsi-fungsi ini**, jangan tulis ulang regex/aturan yang sama di endpoint handler.
- **Application** (`src/modules/blog-content/application/`): `blog-post-directory.ts` (CRUD + lifecycle posts, plus konsumsi `syncPostTermAssignments`/`fetchPostTermIds`/`countExistingTerms` dari `blog-taxonomy-directory.ts` untuk `termIds`), `blog-page-directory.ts` (CRUD pages saja — **tanpa** lifecycle transition/restore/purge), `blog-taxonomy-directory.ts` (CRUD term + relasi post-term), `blog-search.ts` (`searchBlogContentAdmin`, `searchPublicBlogContent`), `blog-revision-directory.ts` (`createBlogRevision`/`listBlogRevisions`/`fetchBlogRevisionById`, INSERT-only), `blog-scheduled-publish.ts` (`publishDueScheduledPosts`, satu `UPDATE` set-based per tenant), `template-directory.ts`/`menu-directory.ts`/`widget-directory.ts`/`ads-directory.ts`/`theme-settings-directory.ts` (Issue #542, CRUD directory per resource, pola sama `blog-taxonomy-directory.ts`), `localized-content-directory.ts` (Issue #542 — `setPostTranslationGroup`/`fetchPostTranslations`, satu kolom `UPDATE`/`SELECT` yang **sengaja berdiri sendiri**, tidak menyentuh `blog-post-directory.ts`'s query besar — lihat §Aturan #13).
- **API admin posts** (`src/pages/api/v1/blog/posts/`): CRUD + 5 lifecycle action + `termIds`/`translationGroupId` di body create/update + revisions sub-resource. **API admin pages** (`src/pages/api/v1/blog/pages/`): CRUD saja, tanpa lifecycle action; PATCH signifikan tetap memicu `createBlogRevision` (`resource_type='page'`) walau tidak ada rute baca/restore untuk page revision. **API admin terms** (`src/pages/api/v1/blog/terms/`): list/create/update/delete, tanpa `GET /{id}`. **API search** (`src/pages/api/v1/blog/search/`): admin only, keyset-paginated. Baca `src/modules/blog-content/README.md` untuk pola guard/idempotency/audit lengkap tiap endpoint (termasuk nama action audit literal `blog.<resource>.<verb>`).
- **API revisions** (`src/pages/api/v1/blog/posts/[id]/revisions/`, Issue #541): `GET` list, `GET /{revisionId}` detail (guard `blog_content.revisions.read`, tanpa ownership override), `POST /{revisionId}/restore` (guard `blog_content.revisions.restore` eksplisit, Idempotency-Key wajib, append-only — restore = tulis konten balik ke post + insert revisi baru, tidak pernah `UPDATE`/`DELETE` baris revisi manapun).
- **Scheduled publishing** (`scripts/blog-scheduled-publish.ts`, Issue #541): `bun run blog:publish:scheduled`, worker internal (bukan endpoint HTTP) dijadwalkan cron/systemd timer, satu `UPDATE` idempoten per tenant untuk post `status='scheduled' AND scheduled_at<=now()`.
- **Rute publik** (`src/pages/blog/[tenantCode]/`, Issue #540): index, detail post, arsip kategori/tag, search, `feed.xml`, `sitemap-blog.xml` — 7 `APIRoute` (`.ts`, bukan `.astro`, lihat §Aturan #7). Semua anonim, resolusi tenant lewat `src/lib/tenant/public-tenant-resolver.ts`'s `resolvePublicTenantByCode` (ADR-0009). Query publik ada di `public-blog-directory.ts` (**bukan** `blog-post-directory.ts` yang admin-only), rendering aman di `content-block-rendering.ts`/`seo-rendering.ts`/`public-page-rendering.ts`. **Hanya post**, tidak ada rute publik untuk pages, widget, atau ads (helper-nya `listActiveAdsForPlacement`/`renderAdHtml`/`listWidgets({activeOnly:true})` sudah ada dan teruji, belum ada rute yang memasangnya). **Ini masih akurat untuk `/news` juga** — Issue #560 (epic #555) menambah `src/pages/news/` (7 `APIRoute` paralel: index, `{slug}`, `category/{slug}`, `tag/{slug}`, `search`, `feed.xml`, `sitemap-news.xml`) yang me-reuse persis service yang sama (`public-blog-directory.ts`/`public-page-rendering.ts`/`seo-rendering.ts`/`content-block-rendering.ts`/`searchPublicBlogContent`) — juga **hanya post**, masih tidak ada rute publik untuk pages/widget/ads di `/news` baik. Satu-satunya perbedaan `/news` dari `/blog/{tenantCode}`: resolusi tenant lewat `resolvePublicTenantFromRequest` (Issue #559, `src/lib/tenant/public-host-tenant-resolver.ts`) via helper `withNewsTenant` (`application/public-news-tenant-resolution.ts`), bukan `resolvePublicTenantByCode` dari path segment — dan `/news` menambahkan cek module-disabled eksplisit yang **belum** ada di `/blog/{tenantCode}` (pre-existing gap, didokumentasikan, sengaja tidak diretrofit di Issue #560 — lihat skill `awcms-tenant-domain-routing`).
- **API presentasi** (Issue #542): `src/pages/api/v1/blog/{templates,menus,widgets,ads}/` (CRUD, satu permission `configure` menggerbangi create/update/delete, pola sama taxonomies) dan `src/pages/api/v1/blog/theme/` (`GET`/`PATCH`, satu baris per tenant, fallback ke `awcms_tenants.default_theme`). Menu items dan ad placements full-replace via sub-array di payload (`items`/`placements`), sama seperti `termIds`.
- **Gallery block** (Issue #542, `content-block-rendering.ts`): tipe block baru `{ type: "gallery", items: GalleryItem[] }` (image/video, whitelist render, `<img>`/`<video controls>` saja) — **bukan** tabel/endpoint media terpisah, karena tidak ada base media library nyata untuk diintegrasikan (`featuredMediaId` cuma UUID longgar tanpa FK).
- **API settings** (Issue #543, `src/pages/api/v1/blog/settings/`): `GET`/`PATCH`, satu baris per tenant (`awcms_blog_settings`, migration 026 — kolom typed `default_locale`/`default_visibility`/`posts_per_page`/`seo_default_title`/`seo_default_description` ditulis/dibaca lewat route untuk pertama kali di #543; `blogTitle`/`blogDescription`/`rssEnabled`/`sitemapEnabled` di kolom jsonb `settings` catch-all). Directory `blog-settings-directory.ts` (`fetchBlogSettings`/`upsertBlogSettings`, merge-patch upsert), policy `blog-settings-policy.ts` (`validateUpdateBlogSettingsInput`). Guard `blog_content.settings.{read,configure}`, audit `blog.settings.updated`, terdaftar di OpenAPI (`paths./api/v1/blog/settings`) dan closing gap AsyncAPI `settings.updated` (lihat di bawah). `feed.xml.ts`/`sitemap-blog.xml.ts` (#540) sekarang membaca `rssEnabled`/`sitemapEnabled` dari sini — tenant yang mematikannya dapat `404` identik dengan tenant tak dikenal (sama seperti aturan #5, tidak ada sinyal pembeda).
- **Admin UI** (Issue #543, `src/pages/admin/blog/`): 15 layar Astro (`+ vanilla JS`, tanpa framework baru), reuse `AdminLayout` + design token existing, pola SSR-read-lewat-application-layer + mutasi-lewat-fetch-ke-endpoint-terguard **identik** dengan `src/pages/admin/modules/[moduleKey].astro` (referensi utama) — dashboard (`index.astro`), posts (`posts/index.astro`, `/new`, `/[id]` — termasuk lifecycle action + revision history), pages (`pages/index.astro`, `/new`, `/[id]` — **tanpa** lifecycle action, sesuai README §Belum tersedia), `categories.astro`, `tags.astro` (tag structural tidak punya field `parentId` sama sekali, bukan cuma disembunyikan), `settings.astro`, layar opsional `templates.astro`/`widgets.astro`/`menus.astro`/`ads.astro` (disertakan karena #542 sudah merged), dan `internal-tag-links.astro` (Issue #641, layar ke-15 — konfigurasi policy internal tag linking). Semua aksi high-risk (publish/schedule/archive/restore/purge/revision-restore/delete) wajib `window.confirm` + `Idempotency-Key` baru per attempt (`newIdempotencyKey()` di `src/lib/ui/admin-form-client.ts`) + tombol submit terkunci selama in-flight. `module.ts`'s `navigation` array (satu entry `/admin/blog`, guard `blog_content.posts.read`) dan `permissions` array (39 entry, mirror migration 027+030+052) baru dideklarasikan di #543 — sebelumnya kosong meski permission-nya sudah lama ada di DB.
- **AsyncAPI domain events** (`asyncapi/awcms-domain-events.asyncapi.yaml`): 27 channel `awcms.blog-content.*` (13 dari #541 + 13 dari #542 + 1 dari Issue #641 — `internal-tag-linking-policy.updated`), terdaftar juga di `module.ts`'s `events.publishes`. **Dokumentasi kontrak saja** — produser nyatanya structured JSON logger (`log()`), bukan event bus, konvensi sama sejak Issue 0.3 (lihat pola `email.*` sebagai precedent). Sejak #543 **semua channel punya produser nyata** — `settings.updated` (yang sebelumnya reserved-tanpa-produser) sekarang di-log dari `PATCH /api/v1/blog/settings`.

## Aturan lintas-issue yang wajib diikuti

1. **Slug uniqueness**: posts/pages unik per `(tenant_id, locale, slug)` selama `deleted_at IS NULL`; terms unik per `(tenant_id, taxonomy_type, slug)`. Jangan tambah constraint unik baru yang lebih longgar/ketat tanpa migration baru + update README.
2. **Tag tidak boleh punya `parent_id`** — sudah di-enforce di constraint DB (`awcms_blog_terms_tag_no_parent_check`) dan aplikasi (`validateTermParent`). Endpoint create/update term wajib panggil `validateTermParent` sebelum insert/update — untuk update, gabungkan field yang dikirim dengan baris existing dulu (lihat `blog-term-validation.ts` docblock), jangan cek isolated terhadap body saja.
3. **Revisions append-only** — tidak pernah `UPDATE`/`DELETE` baris `awcms_blog_revisions`. "Restore revisi" (Issue #541, `POST /api/v1/blog/posts/{id}/revisions/{revisionId}/restore`) = tulis konten revisi lama balik ke baris post aktif (`updateBlogPost`), lalu insert revisi baru lagi mencatat state hasil restore itu (`changeNote: "Restored from revision {n}."`) — dua langkah, keduanya lewat `blog-revision-directory.ts`/`blog-post-directory.ts` yang sudah ada, jangan tulis SQL `UPDATE ... SET` langsung ke tabel revisi. Revisi baru dibuat hanya kalau `PATCH` menyertakan `title`/`contentJson`/`contentText` (`domain/revision-policy.ts`'s `isSignificantContentChange`) — field kosmetik (`seoTitle`, `slug`, `visibility`, dll.) tidak memicu revisi. Berlaku untuk posts DAN pages (dipanggil dari kedua `PATCH` handler), tapi rute baca/restore revisi baru ada untuk posts.
4. **`search_vector` sudah `GENERATED ALWAYS ... STORED`** sejak migration `028` (Issue #539) — jangan pernah menulis ke kolom ini secara manual (Postgres menolaknya), dan jangan menambah trigger/`recomputeSearchVector` semacamnya, itu sudah beres di level kolom.
5. **Rute publik tenant-scoped wajib ikuti ADR-0009**: resolusi tenant lewat segmen path `tenant_code` (`/blog/{tenantCode}/...`) via `resolvePublicTenantByCode` (`src/lib/tenant/public-tenant-resolver.ts`), **bukan** subdomain/header — base ini LAN-first, tidak boleh berasumsi ada DNS/TLS publik. `tenantCode` tidak ditemukan ATAU tenant tidak `active` → `404` yang identik (jangan bocorkan keberadaan tenant). Pakai `searchPublicBlogContent` (`blog-search.ts`, Issue #539) langsung untuk search publik, jangan tulis ulang predikat visibilitasnya.
6. **Dua predikat visibilitas publik berbeda** (Issue #540, `public-blog-directory.ts`): LISTING (index/kategori/tag/search/feed/sitemap) pakai `visibility = 'public'` ketat; DETAIL (`fetchPublicBlogPostBySlug`) pakai `visibility IN ('public', 'unlisted')` — unlisted bisa diakses link langsung tapi tidak muncul di listing manapun, private tidak pernah publik sama sekali di kedua konteks. Jangan menyamakan keduanya.
7. **Rute publik = `APIRoute` `.ts`, bukan `.astro`** — supaya testable lewat `tests/integration/harness.ts`'s `invoke()`/`invokeRaw()` (pola test satu-satunya yang ada di repo ini). `invokeRaw()` (bukan `invoke()`) untuk handler yang me-return HTML/XML, bukan JSON — `invoke()` selalu `JSON.parse` dan akan throw untuk body non-JSON.
8. **`content_json` sekarang punya schema konkret** (Issue #540, sebelumnya "opaque"): `{ blocks: ContentBlock[] }`, 4 tipe (`paragraph`/`heading`/`list`/`quote`). Rendering SELALU lewat `content-block-rendering.ts`'s `renderContentJsonToHtml` (whitelist, escape semua teks) — jangan pernah `set:html`/render mentah `content_json`/`content_text` di rute mana pun.
9. **Idempotency**: posts punya scope `blog_post_publish`/`_schedule`/`_archive`/`_restore`/`_purge` (Issue #538); revisi-restore punya scope `blog_revision_restore` (Issue #541) — pola `blog_<resource>_<action>` yang sama. Pages/terms CRUD (#539), scheduled-publishing job (#541 — idempoten by construction lewat `WHERE` clause, bukan lewat `Idempotency-Key`), dan seluruh rute publik (#540, GET-only, tidak mutasi apa pun) **tidak** idempotency-gated — jangan tambahkan tanpa alasan baru.
10. **Audit**: `action` memakai string literal `blog.<resource>.<verb>` (bukan verb generik singkat seperti modul lain) — `blog.post.*` (#538), `blog.page.*`/`blog.term.*` (#539), `blog.post.revision_restored`/`blog.post.scheduled_publish_executed`/`blog.post.scheduled_publish_skipped` (#541, reuse `blog.post.published` juga untuk publish via scheduled job) sudah konsisten. Rute publik (#540) tidak menulis audit event (baca-saja, anonim, tidak ada `actorTenantUserId`); scheduled-publishing job juga tidak set `actorTenantUserId` (aktor sistem/background, bukan user).
11. **ABAC ownership override generik**: `content-access-policy.ts`'s `evaluateContentUpdateAccess` dipakai posts DAN pages (author boleh edit konten sendiri yang belum published, tanpa permission `update`). Kalau menambah resource baru dengan pola serupa, panggil fungsi generik ini dengan guard baru — jangan copy-paste logic `evaluatePostUpdateAccess`/`evaluatePageUpdateAccess` lagi. **Restore revisi TIDAK punya override ini** — `blog_content.revisions.restore` wajib eksplisit meski pemanggil adalah author post itu sendiri (beda sengaja dari `update`).
12. **Error handling publik tidak boleh bocorkan stack trace**: setiap rute publik dibungkus `try/catch`, error asli di-`log()`, respons ke klien selalu string generik dari `src/lib/html/error-responses.ts`. Reuse fungsi itu untuk rute publik baru, jangan bikin pesan error ad-hoc.
13. **Multilingual** (Issue #542, keputusan final — bukan lagi terbuka): kolom `locale` di posts/pages **sudah cukup** untuk "locale-based storage/retrieval" + slug uniqueness tenant+locale-aware (sejak #537) — jangan desain ulang jadi JSONB per-locale. Yang ditambahkan #542 hanyalah `translation_group_id` (nullable, tanpa FK/trigger) buat menautkan beberapa post locale-variant, lewat fungsi berdiri sendiri `localized-content-directory.ts`'s `setPostTranslationGroup` — **jangan** tambahkan kolom ini ke `INSERT`/`UPDATE`/`RETURNING` di `blog-post-directory.ts` (file itu sudah disentuh 7+ tempat berbeda; satu fungsi sempit terpisah jauh lebih rendah risiko).
14. **AsyncAPI domain events**: kalau menambah lifecycle action baru ke `blog_content`, tambahkan channel+operation baru di `asyncapi/awcms-domain-events.asyncapi.yaml` **dan** entry di `module.ts`'s `events.publishes` (divalidasi `scripts/api-spec-check.ts`'s `checkModuleEventChannels` — module.ts tanpa channel yang cocok = `api:spec:check` gagal). Produser event = tambahkan `log("info", "blog-content.<aggregate>.<verb>", {...})` di titik kode yang sama tempat `recordAuditEvent` dipanggil — **jangan** bangun dispatcher pub/sub baru, kontrak ini dokumentasi-saja sejak Issue 0.3 (lihat precedent `email.*` di README `email` module).
15. **Master/config data admin (templates/menus/widgets/ads/theme) pakai satu permission `configure`** untuk create+update+delete, bukan permission per-aksi seperti posts — pola sama `taxonomies.configure`. Jangan tambah `templates.create`/`templates.delete` terpisah tanpa alasan baru yang kuat.
16. **`/news` (Issue #560, epic #555) me-reuse rute publik `/blog/{tenantCode}` apa adanya** — jangan tulis ulang query/rendering/predikat visibilitas untuk `/news`; satu-satunya kode baru yang boleh ditambah adalah lapisan resolusi tenant (`withNewsTenant`, `application/public-news-tenant-resolution.ts`) dan basePath link building (`renderPostSummaryListHtmlAtBasePath` di `public-page-rendering.ts`, `/blog/{tenantCode}`'s wrapper lama tetap byte-for-byte sama). Perubahan pada `/blog/{tenantCode}` existing untuk mendukung `/news` wajib nol-behavior-change (pure refactor/extraction saja) — lihat skill `awcms-tenant-domain-routing`'s §Rute publik `/news` untuk detail lengkap termasuk cek module-disabled yang `/news` punya tapi `/blog/{tenantCode}` belum.
17. **Sub-resource full-replace butuh `id` client-supplied kalau ada hierarki/self-reference dalam satu payload** (`menu items`' `parentItemId`, lihat `menu-directory.ts`'s `syncMenuItems` docblock) — karena `DELETE`-lalu-`INSERT` membuang id lama sebelum baris baru ditulis, referensi ke sibling di payload yang sama HANYA bisa diselesaikan kalau klien sendiri yang menyuplai id-nya (bukan `gen_random_uuid()` DB). Sub-resource _tanpa_ hierarki (ad placements) tetap boleh pakai id DB-generated biasa.
18. **Tidak ada base media library** — jangan bangun tabel/endpoint media baru untuk kebutuhan galeri/attachment. Tambahkan tipe block baru di `content-block-rendering.ts`'s whitelist (pola `gallery`, Issue #542) atau simpan sebagai UUID/URL longgar (pola `featuredMediaId`), tergantung kebutuhan — jangan re-derive konsep "media library" dari nol. **Sejak Issue #636** (lihat catatan "Di luar epic #536" di atas): saat full-online R2-only mode aktif untuk tenant, UUID/URL longgar itu WAJIB divalidasi menunjuk baris registry `news_portal` (#633) yang aman — tetap bukan media library baru di `blog_content` sendiri, hanya validasi referensi ke registry modul lain.
19. **Theme mode adalah override, bukan engine baru** — `awcms_tenants.default_theme` (migration 002) tetap satu-satunya sumber default. Tabel/endpoint theme modul manapun (blog atau modul lain di masa depan) harus fallback ke situ saat tidak ada override, sama seperti `theme-settings-directory.ts`'s `fetchBlogThemeSettings`.
20. **Kolaborasi dengan `news_portal` lewat capability port, BUKAN import langsung** (Issue #681, epic #679 — lihat ADR-0011 dan skill `awcms-news-portal`'s §681 untuk detail penuh). `application`/`domain` file `blog_content` DILARANG `import ... from` tree `application`/`domain` milik `news_portal` — kapabilitas apa pun yang dibutuhkan dari `news_portal` (mis. validasi/resolusi media R2) diterima lewat parameter port (`_shared/ports/news-media-port.ts`'s `NewsMediaPort`), disuntikkan pemanggil (route handler). Dijaga otomatis oleh `tests/unit/module-boundary.test.ts` — PR yang menambah import lintas-modul baru akan gagal test ini.

## Belum ada — jangan asumsikan sudah dikerjakan

Epic #536 (Issue #537-#543) sudah selesai seluruhnya, tapi beberapa hal
tetap **di luar scope epic ini secara sengaja** — jangan asumsikan sudah
dikerjakan hanya karena epic-nya "selesai":

- Rute publik untuk pages (hanya post yang punya rute publik, #540), dan rute baca/restore revisi untuk pages (hanya post punya rute revisi, #541 — page tetap mengumpulkan revisi lewat `PATCH`, hanya tidak ada endpoint baca/restore-nya).
- Page lifecycle-action endpoints (`publish`/`schedule`/`archive`/`restore`/`purge` untuk pages) — permission-nya sudah diseed sejak #537, tapi endpoint-nya tidak pernah dibangun di issue manapun (#538-#543). Jangan asumsikan itu selesai hanya karena posts sudah punya lifecycle lengkap dan admin UI post editor punya panel lifecycle.
- Locale-aware negotiation untuk pengunjung publik (mis. `Accept-Language`) — rute publik tidak memfilter berdasarkan preferensi bahasa pengunjung.
- Optimistic-concurrency check yang membaca kolom `version`.
- Rute publik untuk widget/ads rendering (header/sidebar/footer nyata di halaman publik) — helper-nya (`listActiveAdsForPlacement`/`renderAdHtml`/`listWidgets({activeOnly:true})`) sudah ada dan teruji sejak #542, admin CRUD-nya (`/admin/blog/widgets`, `/admin/blog/ads`) sudah ada sejak #543, tapi belum ada satu rute publik pun yang memasangnya di halaman blog.
- Layar admin dedicated untuk media/gallery — tidak ada base media library (lihat aturan #18), jadi gallery block tetap diedit lewat textarea `content_json` di post/page editor, bukan picker visual.
- Visual/WYSIWYG editor untuk `content_json`, dan editor visual (tree/drag-drop) untuk menu items/ad placements — admin UI #543 memakai textarea JSON berlabel untuk semuanya, keputusan scope yang disengaja (lihat README §Known limitations).

`src/modules/blog-content/README.md` §Belum tersedia berisi daftar lengkap dan detail per item.
