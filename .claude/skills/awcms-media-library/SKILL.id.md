---
name: awcms-media-library
description: Modul media_library ADA di repo ini (INVERSI ADR-0036, migrasi `sql/052`–`sql/054`). System Foundation (`type: system`, `isCore: false`, deps `[tenant_admin, identity_access]`) yang MEMILIKI registry media per-tenant `awcms_news_media_objects` (tabel TIDAK di-rename — FK komposit keras dari `awcms_news_portal_ad_placements`), presigned direct-to-R2 upload/finalize/cancel (`/api/v1/media/news-images/upload-sessions/*`, magic-byte MIME sniff + SHA-256), verifikasi, lifecycle orphan, job `news-media:reconcile`, dan penyalaan enforcement (`GET/POST /api/v1/media/enforcement`, satu arah). Menyediakan capability `media_library` (`_shared/ports/media-library-port.ts`) yang dikonsumsi `blog_content` — konsumen kedua `news_portal` DILEBUR ke `blog_content` (ADR-0044/#300), jadi nama tabel `awcms_news_*` di sini bukan lagi petunjuk modul mana pun. Gunakan saat mengubah/menambah upload media, registry, R2 config (`NEWS_MEDIA_R2_*`), reconcile, atau enforcement. Env var `NEWS_MEDIA_R2_*` + nama tabel + command `news-media:reconcile` DIPERTAHANKAN (ADR-0036 §3/§4). Layar `/admin/media` SUDAH ADA (ADR-0056, PR #345 — `src/pages/admin/media.astro`): browse ber-filter + delete/restore/purge, tiap mutasi ber-`Idempotency-Key`. ADR-0056 SELESAI SELURUHNYA — `attach`/`detach` DICABUT (`sql/087`), `delete`/`restore`/`purge` diberi permukaan, dan rute daftar sendiri `GET /api/v1/media/objects/list` (keyset, kursor TEKS presisi mikrodetik) ditambahkan karena `?ids=` adalah resolver batch, bukan browse. Modul kini mendeklarasikan **9 permission** (7 `media.*` + 2 `enforcement.*`), nol di antaranya tak-tergerbangi. Formulir unggah ADA di layar (Issue #595) dan mengompres JPEG/PNG/WebP yang melebihi batas default 2 MiB di peramban sebelum mengirim (Issue #1221; GIF tidak pernah di-encode ulang, server tetap menegakkan batas). Yang sengaja TIDAK ada di layar: `enforcement.*` (saklar kebijakan tenant, tempatnya `/admin/security`) dan pratinjau `<img>`. Step 5c/5d micro (srcset, PDF) belum ada.
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:724f9c927404f1732d0fd725b468cfc3322cdcf98b4a5b0c55e20dd8b5f120b8 -->

# AWCMS — Media Library (registry media per-tenant, ADR-0036 ownership inversion)

<!-- sql-refs: awcms — nomor `sql/NNN` di skill ini adalah penomoran awcms NYATA -->

> **STATUS — modul `media_library` ADA (inversi ADR-0036).** Ia lahir dari
> pemindahan registry media KELUAR dari `news_portal` (bukan port aditif); modul
> asal itu sendiri kemudian DILEBUR ke `blog_content` (ADR-0044/#300), jadi
> konsumen `media_library` untuk ad placement kini `blog_content`. Baca
> `docs/adr/0036-media-library-module-admission-ownership-inversion.md` +
> `src/modules/media-library/README.md` + `sql/` nyata sebelum mengubah.

## Apa yang dimiliki modul ini

- **Registry** `awcms_news_media_objects` (`sql/041`, FORCE RLS; tabel **tidak
  di-rename** — dirujuk `sql/041`/`042`/`045` + FK komposit keras dari
  `awcms_news_portal_ad_placements`). Application: `media-object-directory.ts`
  (symbol internal DIPERTAHANKAN: `fetchNewsMediaObjectById`,
  `fetchNewsMediaObjectsByIds`, `NewsMediaObjectView`,
  `isNewsMediaObjectSafeForPublicReference`).
- **Upload flow** presigned direct-to-R2: `POST /api/v1/media/news-images/upload-sessions`
  (create), `.../{id}/finalize` (R2 GET nyata + magic-byte MIME sniff + SHA-256,
  high-risk + `Idempotency-Key`), `.../{id}/cancel`. Guard: `media_library.media.*`.
- **Domain**: `media-r2-config.ts` (`NEWS_MEDIA_R2_*` — nama env DIPERTAHANKAN,
  wajib TERPISAH dari `R2_*` milik sync-storage), `media-mime-sniffer.ts`,
  `media-object-key.ts` (prefix objek `news-media/{tenantId}/...` DIPERTAHANKAN),
  `media-finalize-decision.ts`, `media-upload-session-validation.ts`,
  `media-reconciliation-categorization.ts`, `managed-media-readiness.ts`.
- **Infrastructure**: `media-r2-client.ts`. **Job**: `news-media:reconcile`
  (`scripts/news-media-r2-reconcile.ts` — nama command DIPERTAHANKAN, hanya
  meng-import `media_library`).
- **Port** `_shared/ports/media-library-port.ts` (`MediaLibraryPort`, 3 method):
  `isManagedMediaEnforcementActiveForTenant`, `isMediaReferenceSafe`,
  `resolveMediaReferences`. Adapter `media-library-port-adapter.ts`
  (`mediaLibraryPortAdapter`, import HANYA dari `media_library` — jangan pernah
  import `blog-content`, itu inversi ADR-0013 §1 yang dihapus; direktori
  `news-portal/` sendiri sudah tidak ada — ADR-0044/#300).

## Enforcement per-tenant (step 5a) — SATU ARAH, jangan "lengkapi API"

- Flag di `awcms_media_library_tenant_state` (`sql/053`, PK tenant_id, RLS
  ENABLE+FORCE). Penulis SATU-SATUNYA = `markManagedMediaEnforced`
  (`media-library-tenant-state.ts`), dipanggil HANYA dari entry point tersanksi
  `enable-managed-media-enforcement.ts` (gate readiness dulu + audit).
- Endpoint `GET/POST /api/v1/media/enforcement` (`sql/054`:
  `media_library.enforcement.{read,enable}` — activity code TERPISAH dari
  `media`). POST hanya bisa MENYALAKAN.
- **DILARANG menambah**: action `enforcement.disable`, fungsi unmark/clear/
  disable, atau DELETE terhadap `awcms_media_library_tenant_state`. Itu
  mengembalikan eksploit yang dicatat header `sql/043` (tenant mematikan
  validasi medianya sendiri). Dijaga `tests/media-enforcement-one-way.test.ts`.
- `isManagedMediaEnforcementActiveForTenant` = readiness deployment
  (`evaluateManagedMediaReadiness`, pure) **DAN** flag per-tenant. Kedua paruh
  wajib; readiness gagal → fail-closed tanpa query DB.

## Batas ukuran upload dan kompresi di peramban (Issue #1221)

- Batas default per gambar adalah **2 MiB** (`NEWS_MEDIA_R2_DEFAULTS.maxUploadBytes`,
  `domain/media-r2-public-config.ts`; override `NEWS_MEDIA_R2_MAX_UPLOAD_BYTES`).
  Server menegakkannya tanpa berubah saat pembuatan sesi (`byteSize` yang
  diklaim) dan saat finalize (objek nyata) — **jangan pernah melonggarkan
  keduanya menjadi "percaya peramban"**.
- Pengunggah admin mengompres JPEG/PNG/WebP yang melebihi batas di peramban lebih
  dulu (`src/lib/ui/media-image-compression-plan.ts` perencana murni,
  `media-image-compression.ts` runner, `media-image-compression-browser.ts`
  adaptor `createImageBitmap` + canvas, dikabelkan oleh `uploadMediaFile` di
  `media-upload-client.ts`). GIF TIDAK PERNAH di-encode ulang (animasi) — bila
  melebihi batas ia ditolak. Encode ulang membuang EXIF/GPS (terdokumentasi,
  disengaja).
- Aturan saat menyentuhnya: `byteSize`/`mimeType` yang diklaim ke server adalah
  milik byte yang benar-benar dikirim (hasil kompresi), dan kegagalan bersifat
  eksplisit (`step: "compress"`), tidak pernah unggahan berukuran berlebih. Tanpa
  pustaka gambar di sisi server.
- String baru yang terlihat pengguna lewat katalog dan sampai ke klien sebagai
  atribut `data-msg-*` pada `#media-upload-form`; penjaga
  `tests/admin-media-upload-compression-contract.test.ts` menjaga pesan halaman
  dan cadangan Inggris klien tetap identik.

## Aturan saat mengubah

1. Migrasi terapan immutable — koreksi via migrasi baru (skill `awcms-new-migration`).
2. Tabel tenant-scoped → RLS FORCE + tenant_id; uji di bawah role `awcms_app`
   LOGIN (`tests/integration/media-library-tenant-state.integration.test.ts`).
3. Perubahan port/kapabilitas → update `_shared/capability-contract-versions.ts`
   (`media_library`) + manifest `awcms-family-compatibility.yaml` (harus cocok
   key-for-key — `family:conformance:check`).
4. Perubahan endpoint → OpenAPI fragment `openapi/modules/media-library.openapi.yaml`
   - `bun run openapi:bundle` (skill `awcms-new-endpoint`).
5. High-risk (finalize/enforcement) → audit log (moduleKey `media_library`).
6. Jangan sentuh `blog_content` untuk urusan media kecuali rewire
   composition-root (ia konsumen via port; `news_portal` sudah dilebur ke
   dalamnya).

## Belum di-port (aditif, gelombang lanjutan)

Step 5d media lifecycle/browser (`/api/v1/media/objects/*`, `/admin/media`),
step 5b `srcset` render, step 5c tipe PDF. Modul menyatakannya PORT DROP; MIME
tetap empat tipe raster; `navigation` belum dideklarasikan.
