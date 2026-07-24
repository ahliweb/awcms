---
name: awcms-media-library
description: Modul media_library ADA di repo ini (INVERSI ADR-0036, migrasi `sql/052`–`sql/054`). System Foundation (`type: system`, `isCore: false`, deps `[tenant_admin, identity_access]`) yang MEMILIKI registry media per-tenant `awcms_news_media_objects` (tabel TIDAK di-rename — FK komposit keras dari `awcms_news_portal_ad_placements`), presigned direct-to-R2 upload/finalize/cancel (`/api/v1/media/news-images/upload-sessions/*`, magic-byte MIME sniff + SHA-256), verifikasi, lifecycle orphan, job `news-media:reconcile`, dan penyalaan enforcement (`GET/POST /api/v1/media/enforcement`, satu arah). Menyediakan capability `media_library` (`_shared/ports/media-library-port.ts`) yang dikonsumsi `blog_content` (opsional) & `news_portal` (wajib). Gunakan saat mengubah/menambah upload media, registry, R2 config (`NEWS_MEDIA_R2_*`), reconcile, atau enforcement. Env var `NEWS_MEDIA_R2_*` + nama tabel + command `news-media:reconcile` DIPERTAHANKAN (ADR-0036 §3/§4). Step 5b/5c/5d micro (`/admin/media`, srcset, PDF) BELUM di-port.
---

# AWCMS — Media Library (registry media per-tenant, ADR-0036 ownership inversion)

<!-- sql-refs: awcms — nomor `sql/NNN` di skill ini adalah penomoran awcms NYATA -->

> **STATUS — modul `media_library` ADA (inversi ADR-0036).** Ia lahir dari
> pemindahan registry media KELUAR dari `news_portal` (bukan port aditif). Baca
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
  import `news-portal`/`blog-content`, itu inversi ADR-0013 §1 yang dihapus).

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
6. Jangan sentuh `news_portal`/`blog_content` untuk urusan media kecuali rewire
   composition-root (mereka konsumen via port).

## Belum di-port (aditif, gelombang lanjutan)

Step 5d media lifecycle/browser (`/api/v1/media/objects/*`, `/admin/media`),
step 5b `srcset` render, step 5c tipe PDF. Modul menyatakannya PORT DROP; MIME
tetap empat tipe raster; `navigation` belum dideklarasikan.
